/**
 * Eval runner for the deterministic modification chain:
 *   instruction -> planActionsWithRules -> executeActions -> computeTripChangeSet
 *
 * Each case runs the whole chain against the demo Chongqing trip and scores:
 *   - which TravelActions the rule NLU emitted (type + dayId, in order)
 *   - that nothing was silently rejected (unless expected)
 *   - quantitative diff invariants (walking/cost deltas, item changes)
 *
 * knownFailure cases document ground truth the current rule NLU gets wrong.
 * Usage: npm run eval:nlu [-- --verbose]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { chongqingTrip } from "@/data/demo/chongqing";
import { planActionsWithRules } from "@/services/ai/actions/rule-planner";
import { executeActions } from "@/services/ai/actions/executor";
import { computeTripChangeSet } from "@/services/ai/diff";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
const RESULTS_DIR = path.join(ROOT, "benchmarks", "results");
const VERBOSE = process.argv.includes("--verbose");

interface ExpectedAction {
  type: string;
  dayId?: string;
}

interface DiffExpectation {
  /** Assert walkDistanceDiffMeters is <= this (negative = walking saved). */
  walkSavedAtLeast?: number;
  /** Assert walkDistanceDiffMeters sign. */
  walkDeltaSign?: "negative" | "zero" | "positive";
  costDeltaSign?: "negative" | "zero" | "positive";
  minItemChanges?: number;
  summaryNonEmpty?: boolean;
}

interface EvalCase {
  id: string;
  instruction: string;
  dayId?: string;
  expectedActions: ExpectedAction[];
  allowRejected?: boolean;
  diff?: DiffExpectation;
  note?: string;
  knownFailure?: boolean;
}

interface CaseResult {
  id: string;
  passed: boolean;
  knownFailure: boolean;
  failures: string[];
}

function dayIdOf(trip: typeof chongqingTrip, index: number): string | undefined {
  return trip.days[index]?.id;
}

function scoreCase(spec: EvalCase): CaseResult {
  const failures: string[] = [];
  const plan = planActionsWithRules(chongqingTrip, spec.instruction, spec.dayId);
  const actualActions = plan.actions.map((action) => ({
    type: action.type,
    ...(action.payload && typeof action.payload === "object" && "dayId" in action.payload
      ? { dayId: String((action.payload as { dayId: unknown }).dayId) }
      : {}),
  }));
  if (JSON.stringify(actualActions) !== JSON.stringify(spec.expectedActions)) {
    failures.push(`actions: expected ${JSON.stringify(spec.expectedActions)}, got ${JSON.stringify(actualActions)}`);
  }

  const result = executeActions(chongqingTrip, plan.actions);
  if (!spec.allowRejected && result.rejected.length) {
    failures.push(`unexpected rejections: ${result.rejected.map((entry) => `${entry.action.type}: ${entry.reason}`).join("; ")}`);
  }

  const diff = computeTripChangeSet(chongqingTrip, result.trip, result.applied);
  const walk = diff.metrics.walkDistanceDiffMeters;
  const expectation = spec.diff ?? {};
  if (expectation.walkSavedAtLeast !== undefined && walk > -expectation.walkSavedAtLeast) {
    failures.push(`walking delta ${walk} should be <= -${expectation.walkSavedAtLeast}`);
  }
  if (expectation.walkDeltaSign === "negative" && walk >= 0) failures.push(`walking delta should be negative, got ${walk}`);
  if (expectation.walkDeltaSign === "zero" && walk !== 0) failures.push(`walking delta should be zero, got ${walk}`);
  if (expectation.walkDeltaSign === "positive" && walk <= 0) failures.push(`walking delta should be positive, got ${walk}`);
  if (expectation.costDeltaSign && expectation.costDeltaSign !== (diff.metrics.costDiff === 0 ? "zero" : diff.metrics.costDiff > 0 ? "positive" : "negative")) {
    failures.push(`cost delta sign should be ${expectation.costDeltaSign}, got ${diff.metrics.costDiff}`);
  }
  if (expectation.minItemChanges !== undefined && diff.itemChanges.length < expectation.minItemChanges) {
    failures.push(`itemChanges ${diff.itemChanges.length} < ${expectation.minItemChanges}`);
  }
  if (expectation.summaryNonEmpty !== false && !diff.summary) failures.push("diff summary is empty");

  return { id: spec.id, passed: failures.length === 0, knownFailure: Boolean(spec.knownFailure), failures };
}

function main() {
  const datasetPath = path.join(ROOT, "benchmarks", "eval", "nlu-diff", "dataset.json");
  const parsed = JSON.parse(readFileSync(datasetPath, "utf8")) as EvalCase[] | { cases: EvalCase[] };
  const dataset = Array.isArray(parsed) ? parsed : parsed.cases;
  const results = dataset.map(scoreCase);

  const realPassed = results.filter((result) => result.passed && !result.knownFailure).length;
  const realFailed = results.filter((result) => !result.passed && !result.knownFailure).length;
  const stillBroken = results.filter((result) => result.knownFailure && !result.passed).length;
  const fixed = results.filter((result) => result.knownFailure && result.passed).length;

  for (const result of results) {
    if (VERBOSE || !result.passed) {
      const tag = result.knownFailure ? " (known failure)" : "";
      console.log(`${result.passed ? "PASS" : "FAIL"}  ${result.id}${tag}`);
      for (const failure of result.failures) console.log(`    ${failure}`);
    }
  }

  console.log(`\ncases: ${dataset.length}`);
  console.log(`active: ${realPassed} passed, ${realFailed} failed`);
  console.log(`known failures: ${stillBroken} still broken, ${fixed} FIXED`);
  console.log(`demo day ids: ${dayIdOf(chongqingTrip, 0)}, ${dayIdOf(chongqingTrip, 1)}, ${dayIdOf(chongqingTrip, 2)}`);

  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(
    path.join(RESULTS_DIR, "eval-nlu-diff.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), dataset: dataset.length, realPassed, realFailed, stillBroken, fixed, results }, null, 2),
  );
  process.exitCode = realFailed === 0 && fixed === 0 ? 0 : 1;
}

main();
