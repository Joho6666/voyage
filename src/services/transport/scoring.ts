import type {
  ScoredTransportOption,
  TransportContext,
  TransportOption,
  TransportScoreBreakdown,
  TransportScoreWeights,
} from "@/types/transport-intelligence";

export const DEFAULT_TRANSPORT_CONTEXT: TransportContext = {
  budgetSensitivity: "medium",
  walkingTolerance: "medium",
  fatigue: "low",
  weather: "unknown",
  travelers: 1,
  hasLuggage: false,
  accessibilityNeeds: false,
};

const BASE_WEIGHTS: TransportScoreWeights = {
  time: 0.23,
  cost: 0.16,
  walking: 0.20,
  transfers: 0.10,
  weather: 0.10,
  fatigue: 0.12,
  risk: 0.09,
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function normalizeWeights(weights: TransportScoreWeights): TransportScoreWeights {
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0) || 1;
  return Object.fromEntries(
    Object.entries(weights).map(([key, value]) => [key, value / total]),
  ) as unknown as TransportScoreWeights;
}

export function weightsForContext(context: TransportContext): TransportScoreWeights {
  const next = { ...BASE_WEIGHTS };
  if (context.budgetSensitivity === "high") next.cost += 0.14;
  if (context.budgetSensitivity === "low") next.cost -= 0.06;
  if (context.walkingTolerance === "low") next.walking += 0.16;
  if (context.walkingTolerance === "high") next.walking -= 0.07;
  if (context.fatigue === "high") {
    next.fatigue += 0.16;
    next.walking += 0.08;
  }
  if (context.weather === "rain" || context.weather === "heat" || context.weather === "cold") {
    next.weather += 0.12;
  }
  if (context.hasLuggage || context.accessibilityNeeds) {
    next.walking += 0.12;
    next.transfers += 0.10;
  }
  return normalizeWeights(next);
}

function averageCost(option: TransportOption) {
  return Math.max(0, (option.cost.min + option.cost.max) / 2);
}

function riskPenalty(option: TransportOption) {
  let risk = option.estimated ? 0.38 : 0.06;
  if (option.confidence < 0.75) risk += (0.75 - option.confidence) * 0.7;
  if (option.trafficLevel === "high") risk += 0.25;
  if (option.trafficLevel === "medium") risk += 0.10;
  return clamp01(risk);
}

export function scoreTransportOption(
  option: TransportOption,
  rawContext: Partial<TransportContext> = {},
): ScoredTransportOption {
  const context = { ...DEFAULT_TRANSPORT_CONTEXT, ...rawContext };
  const weights = weightsForContext(context);
  const breakdown: TransportScoreBreakdown = {
    time: clamp01(option.durationMinutes / 75),
    cost: clamp01(averageCost(option) / Math.max(25, 35 * Math.max(1, context.travelers))),
    walking: clamp01(option.walkMeters / 2500),
    transfers: clamp01(option.transferCount / 3),
    weather: clamp01(
      option.rainExposure *
        (context.weather === "rain" || context.weather === "heat" || context.weather === "cold" ? 1 : 0.2),
    ),
    fatigue: clamp01(
      (option.walkMeters / 1800 + option.transferCount / 4) *
        (context.fatigue === "high" ? 1 : context.fatigue === "medium" ? 0.65 : 0.35),
    ),
    risk: riskPenalty(option),
  };

  if (context.hasLuggage || context.accessibilityNeeds) {
    breakdown.walking = clamp01(breakdown.walking * 1.2);
    breakdown.transfers = clamp01(breakdown.transfers * 1.25);
  }

  const penalty = (Object.keys(breakdown) as Array<keyof TransportScoreBreakdown>)
    .reduce((sum, key) => sum + breakdown[key] * weights[key], 0);
  const score = Math.round((1 - clamp01(penalty)) * 100);

  const reasons: string[] = [];
  if (option.mode === "walk") reasons.push("零交通费用");
  if (option.walkMeters <= 500) reasons.push("步行负担低");
  if (option.transferCount === 0) reasons.push("无需换乘");
  if (option.durationMinutes <= 25) reasons.push("耗时较短");
  if (context.weather === "rain" && option.rainExposure <= 0.25) reasons.push("雨天暴露较少");
  if (context.fatigue === "high" && option.walkMeters <= 700) reasons.push("更适合疲劳状态");
  if (option.estimated) reasons.push("当前含估算数据，建议出发前刷新");

  return { ...option, score, scoreBreakdown: breakdown, reasons };
}

export function rankTransportOptions(
  options: TransportOption[],
  context: Partial<TransportContext> = {},
) {
  return options
    .map((option) => scoreTransportOption(option, context))
    .sort((a, b) => b.score - a.score || a.durationMinutes - b.durationMinutes);
}
