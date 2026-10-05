/**
 * Voyage benchmark runner — deterministic, zero-cost behavioral baselines.
 *
 * Executes JSON case files (benchmarks/cases/*.bench.json) against the real
 * VoyageSkillRuntime with the fixture provider (no network, no paid API), and
 * records pass/fail, determinism (every case runs twice and both runs are
 * compared after normalizing volatile fields), and latency.
 *
 * Usage:
 *   npm run bench               run all cases, write benchmarks/results/latest.json
 *   npm run bench:compare       diff latest.json against results/baseline.json
 *   npm run bench:baseline      promote latest.json to baseline.json
 *
 * Case file format (see benchmarks/README.md): every case is a sequence of
 * runtime steps; each step either succeeds (optional `assert` list) or is
 * expected to fail with a stable error code (`expectError`). Inputs can
 * reference earlier envelopes with "{{steps.<i>.<path>}}".
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

import { createRuntime } from "@/skill/runtime";
import { SkillError } from "@/skill/errors";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CASES_DIR = path.join(ROOT, "benchmarks", "cases");
const RESULTS_DIR = path.join(ROOT, "benchmarks", "results");

/** Keys whose values legitimately change between identical runs. */
const VOLATILE_KEYS = new Set([
  "generatedAt", "proposalToken", "proposalId", "occurredAt", "appliedAt",
  "fetchedAt", "createdAt", "updatedAt", "expiresAt", "tripHash", "shareToken",
  "asOf", "computedAt",
]);
const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** Keys whose string values are generated identifiers ("id", "tripId", "fromItemId"...). */
const ID_KEY = /^(id|.*ids?)$/i;
const RANDOM_SUFFIX = /^(.*?)[a-z0-9]{8}$/i;

function maskIdentifier(value: string): string {
  const withUuid = value.replace(UUID_ANYWHERE, "<uuid>");
  const match = withUuid.match(RANDOM_SUFFIX);
  // "seg_jm6p1egg" -> "seg_<rand>"; static prefixes like "p-hongya" survive
  // because the underscore/dash in the last 8 chars defeats the match.
  return match && match[1] ? `${match[1]}<rand>` : withUuid;
}

function normalize(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) return value.map((item) => normalize(item, key));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
      if (VOLATILE_KEYS.has(childKey)) continue;
      // Maps keyed BY generated ids ("estimatedWalkingMetersByDay") leak the
      // random trip uuid through the key itself, so keys get masked too.
      const stableKey = childKey.replace(UUID_ANYWHERE, "<uuid>");
      out[stableKey] = normalize(child, stableKey);
    }
    return out;
  }
  if (typeof value === "string") {
    if (key && ID_KEY.test(key)) return maskIdentifier(value);
    return value.replace(UUID_ANYWHERE, "<uuid>");
  }
  return value;
}

interface StepSpec {
  command: string;
  input?: Record<string, unknown>;
  assert?: Array<{ path: string; op: "equals" | "exists" | "absent" | "lengthEquals" | "gte" | "lte" | "contains"; value?: unknown }>;
  expectError?: string;
}

interface CaseSpec {
  id: string;
  category: "golden" | "edge" | "adversarial";
  description: string;
  steps: StepSpec[];
}

interface CaseResult {
  id: string;
  category: string;
  ok: boolean;
  deterministic: boolean;
  ms: number;
  failures: string[];
}

function setBenchEnv() {
  process.env.VOYAGE_PROVIDER_FIXTURE = path.join(ROOT, "tests", "fixtures", "voyage-provider.json");
  process.env.VOYAGE_ALLOW_MOCK = "1";
  // Determinism + zero-cost: no LLM, no demo regex bypass, no host credentials.
  delete process.env.VOYAGE_LLM_ENABLED;
  delete process.env.VOYAGE_DEMO_MODE;
  delete process.env.VOYAGE_BRAIN;
  delete process.env.AMAP_SERVER_KEY;
  process.env.VOYAGE_SKIP_LOCAL_CREDENTIALS = "1";
}

function getPath(root: unknown, pathSpec: string): { found: boolean; value: unknown } {
  let current: unknown = root;
  for (const segment of pathSpec.split(".")) {
    if (current === null || current === undefined) return { found: false, value: undefined };
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index >= current.length) return { found: false, value: undefined };
      current = current[index];
      continue;
    }
    if (typeof current !== "object") return { found: false, value: undefined };
    current = (current as Record<string, unknown>)[segment];
  }
  return { found: current !== undefined, value: current };
}

function checkAssertion(assertion: { path: string; op: string; value?: unknown }, envelope: unknown): string | null {
  const { found, value } = getPath(envelope, assertion.path);
  switch (assertion.op) {
    case "exists": return found ? null : `${assertion.path} is missing`;
    case "absent": return found ? `${assertion.path} should be absent` : null;
    case "equals": return value === assertion.value ? null : `${assertion.path}: ${JSON.stringify(value)} !== ${JSON.stringify(assertion.value)}`;
    case "lengthEquals": return Array.isArray(value) && value.length === assertion.value ? null : `${assertion.path}: length ${Array.isArray(value) ? value.length : "n/a"} !== ${assertion.value}`;
    case "gte": return typeof value === "number" && value >= (assertion.value as number) ? null : `${assertion.path}: ${value} < ${assertion.value}`;
    case "lte": return typeof value === "number" && value <= (assertion.value as number) ? null : `${assertion.path}: ${value} > ${assertion.value}`;
    case "contains": return typeof value === "string" && value.includes(String(assertion.value)) ? null : `${assertion.path} does not contain ${JSON.stringify(assertion.value)}`;
    default: return `unknown op ${assertion.op}`;
  }
}

/** Replaces "{{steps.<i>.<path>}}" strings with values from earlier envelopes. */
function resolveTemplate(input: unknown, envelopes: unknown[]): unknown {
  if (typeof input === "string") {
    const match = input.match(/^\{\{steps\.(\d+)\.(.+)\}\}$/);
    if (match) {
      const { found, value } = getPath(envelopes[Number(match[1])], match[2]);
      if (!found) throw new Error(`template reference ${input} resolved to nothing`);
      return value;
    }
    return input.replace(/\{\{steps\.(\d+)\.(.+?)\}\}/g, (original, index: string, pathSpec: string) => {
      const { found, value } = getPath(envelopes[Number(index)], pathSpec);
      return found ? String(value) : original;
    });
  }
  if (Array.isArray(input)) return input.map((item) => resolveTemplate(item, envelopes));
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(input)) out[key] = resolveTemplate(child, envelopes);
    return out;
  }
  return input;
}

function errorCode(error: unknown): string {
  if (error instanceof SkillError) return error.code;
  const zodName = (error as { name?: string })?.name;
  if (zodName === "ZodError") return "INVALID_INPUT";
  return `UNEXPECTED:${zodName ?? typeof error}`;
}

async function runCaseOnce(spec: CaseSpec): Promise<{ ok: boolean; ms: number; normalized: unknown[]; failures: string[] }> {
  const dataDir = await mkdtemp(path.join(tmpdir(), "voyage-bench-"));
  const failures: string[] = [];
  const normalized: unknown[] = [];
  const started = performance.now();
  try {
    const runtime = createRuntime(dataDir);
    const envelopes: unknown[] = [];
    for (const step of spec.steps) {
      const stepStart = performance.now();
      try {
        const envelope = await runtime.execute(step.command as never, resolveTemplate(step.input ?? {}, envelopes));
        envelopes.push(envelope);
        normalized.push(normalize(envelope));
        if (step.expectError) failures.push(`${step.command}: expected error ${step.expectError}, got success`);
        for (const assertion of step.assert ?? []) {
          const problem = checkAssertion(assertion, envelope);
          if (problem) failures.push(`${step.command}: ${problem}`);
        }
        void stepStart;
      } catch (error) {
        envelopes.push(null);
        normalized.push(null);
        const code = errorCode(error);
        if (step.expectError) {
          if (code !== step.expectError) failures.push(`${step.command}: expected error ${step.expectError}, got ${code}`);
        } else {
          failures.push(`${step.command}: unexpected error ${code}`);
        }
      }
    }
    return { ok: failures.length === 0, ms: performance.now() - started, normalized, failures };
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
}

async function runCase(spec: CaseSpec): Promise<CaseResult> {
  const first = await runCaseOnce(spec);
  const second = await runCaseOnce(spec);
  const deterministic = JSON.stringify(first.normalized) === JSON.stringify(second.normalized);
  const failures = [...first.failures];
  if (!deterministic) failures.push("non-deterministic: two identical runs diverged");
  return {
    id: spec.id,
    category: spec.category,
    ok: first.ok,
    deterministic,
    ms: Math.round((first.ms + second.ms) / 2),
    failures,
  };
}

function loadCases(): CaseSpec[] {
  const files = readdirSync(CASES_DIR).filter((name) => name.endsWith(".bench.json")).sort();
  const cases: CaseSpec[] = [];
  for (const file of files) {
    const parsed = JSON.parse(readFileSync(path.join(CASES_DIR, file), "utf8")) as { cases?: CaseSpec[] } | CaseSpec[];
    const list = Array.isArray(parsed) ? parsed : parsed.cases ?? [];
    cases.push(...list);
  }
  if (!cases.length) throw new Error(`no benchmark cases found in ${CASES_DIR}`);
  return cases;
}

interface LatestReport {
  generatedAt: string;
  cases: CaseResult[];
  summary: { total: number; passed: number; failed: number; nondeterministic: number };
}

async function runAll(): Promise<LatestReport> {
  setBenchEnv();
  const cases = loadCases();
  const results: CaseResult[] = [];
  for (const spec of cases) {
    results.push(await runCase(spec));
  }
  const report: LatestReport = {
    generatedAt: new Date().toISOString(),
    cases: results,
    summary: {
      total: results.length,
      passed: results.filter((result) => result.ok).length,
      failed: results.filter((result) => !result.ok).length,
      nondeterministic: results.filter((result) => !result.deterministic).length,
    },
  };
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(path.join(RESULTS_DIR, "latest.json"), JSON.stringify(report, null, 2));
  return report;
}

function printReport(report: LatestReport) {
  console.log("case                                     category     ok      det     ms");
  for (const result of report.cases) {
    const flag = result.ok ? "PASS" : "FAIL";
    const det = result.deterministic ? "yes" : "NO";
    console.log(`${result.id.padEnd(40)} ${result.category.padEnd(12)} ${flag.padEnd(7)} ${det.padEnd(7)} ${result.ms}`);
    for (const failure of result.failures) console.log(`  -> ${failure}`);
  }
  const { total, passed, failed, nondeterministic } = report.summary;
  console.log(`\n${passed}/${total} passed, ${failed} failed, ${nondeterministic} nondeterministic`);
}

function compare() {
  const latestPath = path.join(RESULTS_DIR, "latest.json");
  const baselinePath = path.join(RESULTS_DIR, "baseline.json");
  if (!existsSync(latestPath)) throw new Error("no latest.json — run `npm run bench` first");
  if (!existsSync(baselinePath)) throw new Error("no baseline.json — run `npm run bench:baseline` to seed one");
  const latest = JSON.parse(readFileSync(latestPath, "utf8")) as LatestReport;
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as LatestReport;
  const baselineById = new Map(baseline.cases.map((result) => [result.id, result]));
  let regressions = 0;
  for (const result of latest.cases) {
    const before = baselineById.get(result.id);
    if (!before) {
      console.log(`+ ${result.id}: new case (${result.ok ? "pass" : "FAIL"})`);
      if (!result.ok) regressions += 1;
      continue;
    }
    if (before.ok && !result.ok) {
      console.log(`- ${result.id}: REGRESSED (was pass, now fail)`);
      result.failures.forEach((failure) => console.log(`    ${failure}`));
      regressions += 1;
    } else if (!before.ok && result.ok) {
      console.log(`* ${result.id}: improved (was fail, now pass)`);
    } else if (before.deterministic && !result.deterministic) {
      console.log(`- ${result.id}: lost determinism`);
      regressions += 1;
    } else {
      const delta = result.ms - before.ms;
      console.log(`  ${result.id}: ok (${delta >= 0 ? "+" : ""}${delta}ms)`);
    }
  }
  console.log(`\n${regressions === 0 ? "no regressions" : `${regressions} regression(s) vs baseline`}`);
  process.exitCode = regressions === 0 ? 0 : 1;
}

function diffNormalized(a: unknown, b: unknown, prefix: string, out: string[]) {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (a && b && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b)) {
    if (!Array.isArray(a) && !Array.isArray(b)) {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const key of keys) diffNormalized((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${prefix}.${key}`, out);
      return;
    }
    const left = a as unknown[];
    const right = b as unknown[];
    if (left.length !== right.length) {
      out.push(`${prefix}: length ${left.length} vs ${right.length}`);
      return;
    }
    for (let i = 0; i < left.length; i += 1) diffNormalized(left[i], right[i], `${prefix}.${i}`, out);
    return;
  }
  out.push(`${prefix}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
}

async function main() {
  const mode = process.argv[2];
  if (mode === "--debug-diff") {
    // Runs one case twice and prints the first diverging paths of the
    // NORMALIZED envelopes — the tool for chasing false nondeterminism.
    const caseId = process.argv[3];
    setBenchEnv();
    const spec = loadCases().find((candidate) => candidate.id === caseId);
    if (!spec) throw new Error(`unknown case ${caseId}`);
    const first = await runCaseOnce(spec);
    const second = await runCaseOnce(spec);
    const out: string[] = [];
    diffNormalized(first.normalized, second.normalized, "$", out);
    console.log(out.slice(0, 25).join("\n") || "normalized outputs identical");
    return;
  }
  if (mode === "--compare") {
    compare();
  } else if (mode === "--update-baseline") {
    const latestPath = path.join(RESULTS_DIR, "latest.json");
    if (!existsSync(latestPath)) throw new Error("no latest.json — run `npm run bench` first");
    const report = JSON.parse(readFileSync(latestPath, "utf8")) as LatestReport;
    if (report.summary.failed > 0) throw new Error(`refusing to baseline a run with failures (${report.summary.failed})`);
    writeFileSync(path.join(RESULTS_DIR, "baseline.json"), JSON.stringify(report, null, 2));
    console.log(`baseline updated: ${report.summary.passed}/${report.summary.total} passed`);
  } else {
    const report = await runAll();
    printReport(report);
    process.exitCode = report.summary.failed === 0 ? 0 : 1;
  }
}

void main();
