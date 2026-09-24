import type { TransportContext } from "@/types/transport-intelligence";
import { retrieveTravelKnowledgeHybrid } from "./hybrid-retriever";
import type { KnowledgeRetrievalResult, TravelKnowledgeMatch } from "./types";

export interface TransportKnowledgeContext {
  query: string;
  tags: string[];
  retrieval: KnowledgeRetrievalResult;
  effectiveTransportContext: Partial<TransportContext>;
  evidence: TravelKnowledgeMatch[];
  citations: Array<{
    title: string;
    source: string;
    sourceUrl?: string;
    updatedAt?: string;
  }>;
  rationale: string[];
}

function contextTags(context: Partial<TransportContext>) {
  const tags = new Set<string>(["transport"]);
  if (context.weather === "rain") tags.add("rain");
  if (context.weather === "heat") tags.add("heat");
  if (context.weather === "cold") tags.add("cold");
  if (context.fatigue === "high" || context.fatigue === "medium") tags.add("fatigue");
  if (context.hasLuggage) tags.add("luggage");
  if (context.accessibilityNeeds) tags.add("accessibility");
  if (context.walkingTolerance === "low") tags.add("walking");
  if (context.budgetSensitivity === "high") tags.add("budget");
  return [...tags];
}

function buildQuery(input: {
  city: string;
  context: Partial<TransportContext>;
  originName?: string;
  destinationName?: string;
  userQuery?: string;
}) {
  const pieces = [
    input.city,
    input.originName,
    input.destinationName,
    "市内交通 路线 地形 步行 换乘",
    input.context.weather === "rain" ? "雨天" : "",
    input.context.fatigue === "high" ? "疲劳 少走路" : "",
    input.context.hasLuggage ? "行李" : "",
    input.context.accessibilityNeeds ? "无障碍" : "",
    input.context.budgetSensitivity === "high" ? "预算敏感" : "",
    input.userQuery,
  ];
  return pieces.filter(Boolean).join(" ");
}

function deriveContext(
  context: Partial<TransportContext>,
  evidence: TravelKnowledgeMatch[],
): Partial<TransportContext> {
  const effective = { ...context };
  if (!effective.walkingTolerance) {
    const terrainOrWalkingRule = evidence.some((match) =>
      match.tags.some((tag) => ["terrain", "walking", "accessibility"].includes(tag)),
    );
    if (terrainOrWalkingRule && (
      effective.fatigue === "high" ||
      effective.hasLuggage ||
      effective.accessibilityNeeds ||
      effective.weather === "rain"
    )) {
      effective.walkingTolerance = "low";
    }
  }
  return effective;
}

export async function buildTransportKnowledgeContext(input: {
  city: string;
  context?: Partial<TransportContext>;
  originName?: string;
  destinationName?: string;
  userQuery?: string;
  limit?: number;
}): Promise<TransportKnowledgeContext> {
  const context = input.context ?? {};
  const tags = contextTags(context);
  const query = buildQuery({ ...input, context });
  const retrieval = await retrieveTravelKnowledgeHybrid({
    city: input.city,
    query,
    tags,
    limit: input.limit ?? 8,
    minConfidence: 0.55,
  });
  const evidence = retrieval.matches;
  const effectiveTransportContext = deriveContext(context, evidence);
  const citations = evidence
    .filter((match) => match.citation)
    .map((match) => match.citation!)
    .filter((citation, index, all) =>
      all.findIndex((candidate) =>
        candidate.title === citation.title &&
        candidate.source === citation.source &&
        candidate.sourceUrl === citation.sourceUrl,
      ) === index,
    );

  const rationale = evidence.slice(0, 4).map((match) =>
    `${match.title}（${match.source}，置信度 ${Math.round(match.confidence * 100)}%）`,
  );

  return {
    query,
    tags,
    retrieval,
    effectiveTransportContext,
    evidence,
    citations,
    rationale,
  };
}
