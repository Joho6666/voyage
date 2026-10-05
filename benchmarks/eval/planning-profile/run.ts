/**
 * Eval runner for extractPlanningProfile — the deterministic Chinese
 * travel-utterance -> profile-patch extractor.
 *
 * Dataset: benchmarks/eval/planning-profile/dataset.json
 *   { id, utterance, expected, note?, knownFailure? }
 *
 * Scoring (field level):
 *   recall    = matched expected fields / expected fields
 *   precision = matched expected fields / (matched + over-extracted fields)
 * A case passes iff recall = 1 and precision = 1. `knownFailure: true` cases
 * document ground truth the current extractor gets WRONG: they "pass" while
 * still failing (so the baseline stays green) and celebrate when fixed.
 *
 * Usage: npm run eval:profile [-- --verbose]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { extractPlanningProfile } from "@/services/planning/conversation-planner";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
const RESULTS_DIR = path.join(ROOT, "benchmarks", "results");
const VERBOSE = process.argv.includes("--verbose");

interface EvalCase {
  id: string;
  utterance: string;
  expected: Record<string, unknown>;
  note?: string;
  knownFailure?: boolean;
}

interface CaseResult {
  id: string;
  passed: boolean;
  knownFailure: boolean;
  recall: number;
  precision: number;
  failures: string[];
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function scoreCase(spec: EvalCase): CaseResult {
  const actual = extractPlanningProfile(spec.utterance) as Record<string, unknown>;
  const failures: string[] = [];
  let matched = 0;
  const expectedFields = Object.entries(spec.expected);

  for (const [field, expectedValue] of expectedFields) {
    if (deepEqual(actual[field], expectedValue)) matched += 1;
    else failures.push(`${field}: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actual[field])}`);
  }
  const overExtracted = Object.keys(actual).filter((field) => !(field in spec.expected));
  for (const field of overExtracted) {
    failures.push(`over-extracted ${field}: ${JSON.stringify(actual[field])}`);
  }
  const recall = expectedFields.length ? matched / expectedFields.length : 1;
  const precision = matched + overExtracted.length ? matched / (matched + overExtracted.length) : 1;
  return {
    id: spec.id,
    passed: recall === 1 && precision === 1,
    knownFailure: Boolean(spec.knownFailure),
    recall,
    precision,
    failures,
  };
}

function main() {
  const datasetPath = path.join(ROOT, "benchmarks", "eval", "planning-profile", "dataset.json");
  const parsed = JSON.parse(readFileSync(datasetPath, "utf8")) as EvalCase[] | { cases: EvalCase[] };
  const dataset = Array.isArray(parsed) ? parsed : parsed.cases;
  const results = dataset.map(scoreCase);

  const realPassed = results.filter((result) => result.passed && !result.knownFailure).length;
  const realFailed = results.filter((result) => !result.passed && !result.knownFailure).length;
  const stillBroken = results.filter((result) => result.knownFailure && !result.passed).length;
  const fixed = results.filter((result) => result.knownFailure && result.passed).length;

  const avgRecall = results.reduce((sum, result) => sum + result.recall, 0) / results.length;
  const avgPrecision = results.reduce((sum, result) => sum + result.precision, 0) / results.length;

  for (const result of results) {
    const flag = result.passed ? "PASS" : "FAIL";
    if (VERBOSE || !result.passed) {
      const tag = result.knownFailure ? " (known failure)" : "";
      console.log(`${flag}  ${result.id}${tag}  recall=${result.recall.toFixed(2)} precision=${result.precision.toFixed(2)}`);
      for (const failure of result.failures) console.log(`    ${failure}`);
    }
  }

  console.log(`\ncases: ${dataset.length}`);
  console.log(`active: ${realPassed} passed, ${realFailed} failed`);
  console.log(`known failures: ${stillBroken} still broken, ${fixed} FIXED (remove the flag + update expectations)`);
  console.log(`avg recall=${avgRecall.toFixed(3)} avg precision=${avgPrecision.toFixed(3)}`);

  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(
    path.join(RESULTS_DIR, "eval-planning-profile.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), dataset: dataset.length, realPassed, realFailed, stillBroken, fixed, avgRecall, avgPrecision, results }, null, 2),
  );
  process.exitCode = realFailed === 0 && fixed === 0 ? 0 : 1;
}

main();
