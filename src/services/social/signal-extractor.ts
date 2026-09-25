import { createHash } from "node:crypto";
import type { SocialObservation, SocialSignal, SocialSignalType, SocialSignalValue } from "./types";

const DAY = 86_400_000;
type Candidate = { observation: SocialObservation; signalType: SocialSignalType; value: SocialSignalValue; groupValue: string };

function candidates(observation: SocialObservation): Candidate[] {
  const content = observation.content;
  const result: Candidate[] = [];
  const add = (signalType: SocialSignalType, value: SocialSignalValue, groupValue = "") =>
    result.push({ observation, signalType, value, groupValue });

  if (/排队|拥堵|拥挤|人山人海|人很多|crowded|long queue/i.test(content)) {
    add("crowd_risk", { risk: 0.8 });
  }
  const times = content.match(/\b([01]?\d|2[0-3]):([0-5]\d)\s*[-~至到]\s*([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (times && /人多|人很多|排队|拥挤|热门|高峰|crowd|queue/i.test(content)) {
    const start = `${times[1].padStart(2, "0")}:${times[2]}`;
    const end = `${times[3].padStart(2, "0")}:${times[4]}`;
    add("popular_time", { start, end }, `${start}-${end}`);
  }
  if (/封闭|关闭|施工|停业|危险|绕行|closed|warning/i.test(content)) {
    const message = content.slice(0, 160);
    add("travel_warning", { message }, message);
  }
  const likes = observation.metrics.likes ?? 0;
  const views = observation.metrics.views ?? 0;
  if (likes >= 100 || views >= 1000) {
    add("trend_score", { score: Math.min(1, Math.log10(likes + views + 1) / 5) });
  }
  const price = content.match(/(?:[¥￥]\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*元)/);
  const amount = Number(price?.[1] ?? price?.[2]);
  if (price && Number.isFinite(amount) && amount > 0 && amount <= 10_000) {
    add("price_signal", { amount, currency: "CNY", reported: true }, String(amount));
  }
  return result;
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Deterministic extraction. Social prices and warnings remain unverified reports. */
export function extractSocialSignals(observations: SocialObservation[], now = new Date()): SocialSignal[] {
  const unique = new Map<string, SocialObservation>();
  for (const observation of observations) {
    const date = Date.parse(observation.publishedAt ?? observation.fetchedAt);
    if (!observation.city || !observation.sourceId || !Number.isFinite(date) ||
      !Number.isFinite(Date.parse(observation.expiresAt)) || Date.parse(observation.expiresAt) <= now.getTime()) continue;
    const key = `${observation.provider}|${observation.platform}|${observation.sourceId}`;
    if (!unique.has(key)) unique.set(key, observation);
  }
  const grouped = new Map<string, Candidate[]>();
  for (const observation of unique.values()) {
    for (const candidate of candidates(observation)) {
      const key = [observation.city, observation.entityId ?? "*", candidate.signalType, candidate.groupValue].join("|");
      grouped.set(key, [...(grouped.get(key) ?? []), candidate]);
    }
  }

  return [...grouped.values()].flatMap((group): SocialSignal[] => {
    const first = group[0];
    const observedAtMs = Math.max(...group.map((item) => Date.parse(item.observation.publishedAt ?? item.observation.fetchedAt)));
    const ttl = first.signalType === "popular_time" ? 7 * DAY : DAY;
    const expiresAtMs = Math.min(observedAtMs + ttl, ...group.map((item) => Date.parse(item.observation.expiresAt)));
    if (expiresAtMs <= now.getTime()) return [];
    const platformCount = new Set(group.map((item) => item.observation.platform)).size;
    const confidence = Math.min(0.85, 0.3 + Math.min(group.length, 3) * 0.1 + Math.min(platformCount - 1, 2) * 0.1);
    let value = first.value;
    if (first.signalType === "crowd_risk") value = { risk: average(group.map((item) => "risk" in item.value ? item.value.risk : 0)) };
    if (first.signalType === "trend_score") value = { score: average(group.map((item) => "score" in item.value ? item.value.score : 0)) };
    return [{
      id: createHash("sha256").update(JSON.stringify([
        first.observation.city, first.observation.entityId ?? null, first.signalType,
        first.groupValue, group.map(({ observation }) =>
          `${observation.provider}|${observation.platform}|${observation.sourceId}`).sort(),
      ])).digest("hex").slice(0, 32).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5"),
      city: first.observation.city,
      entityId: first.observation.entityId,
      signalType: first.signalType,
      value,
      confidence,
      sampleSize: group.length,
      platformCount,
      observedAt: new Date(observedAtMs).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      sources: group.map(({ observation }) => ({
        provider: observation.provider, platform: observation.platform, sourceId: observation.sourceId,
        sourceUrl: observation.sourceUrl, publishedAt: observation.publishedAt,
      })),
    }];
  });
}
