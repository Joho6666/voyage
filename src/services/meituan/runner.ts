import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { OfferKind, OfferProviderStatus, TravelOffer } from "@/types/offers";
import { SkillError } from "@/skill/errors";
import { runtimeConfigSync } from "@/services/config/local-credentials";
import { reconcileTrainOffers } from "@/services/meituan/transport-fares";

export interface MeituanQueryInput {
  origin?: string;
  destination?: string;
  startDate?: string;
  endDate?: string;
  travelers?: number;
  budget?: number;
  query: string;
  city?: string;
  categories?: OfferKind[];
}

export interface MeituanQueryResult {
  offers: TravelOffer[];
  rawText?: string;
  rawJson?: unknown;
  status: OfferProviderStatus;
}

function kindFor(text: string): OfferKind {
  if (/酒店|民宿|住宿/.test(text)) return "hotel";
  if (/飞机|航班|机票/.test(text)) return "flight";
  if (/高铁|火车|车次|列车/.test(text)) return "train";
  if (/门票|景区|乐园|演出/.test(text)) return "ticket";
  if (/美食|餐厅|饭店|火锅|小吃/.test(text)) return "restaurant";
  return "coupon";
}

function textValue(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

export function mapJsonOffers(raw: unknown, input: MeituanQueryInput, fetchedAt: string): TravelOffer[] {
  const rows = Array.isArray(raw) ? raw : (raw && typeof raw === "object" ? ((raw as { offers?: unknown; data?: unknown; results?: unknown }).offers ?? (raw as { data?: unknown }).data ?? (raw as { results?: unknown }).results) : undefined);
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row, index) => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    const title = textValue(item.title ?? item.name ?? item.trainName ?? item.flightNo ?? item.hotelName);
    if (!title) return [];
    const url = textValue(item.bookingUrl ?? item.url ?? item.link ?? item.deepLink);
    const availabilityValue = item.availability ?? item.status;
    const inventoryValue = item.inventory ?? item.remaining ?? item.seatCount ?? item.roomCount;
    const inventoryNumber = typeof inventoryValue === "number"
      ? inventoryValue
      : typeof inventoryValue === "string" && /\d/.test(inventoryValue)
        ? Number(inventoryValue.match(/\d+(?:\.\d+)?/)?.[0])
        : undefined;
    const departureTime = textValue(item.departureTime ?? item.departure_time ?? item.departTime ?? item.departure);
    const arrivalTime = textValue(item.arrivalTime ?? item.arrival_time ?? item.arriveTime ?? item.arrival);
    const available = inventoryNumber !== undefined ? inventoryNumber > 0 : availabilityValue === "available" || availabilityValue === "可预订";
    const unavailable = inventoryNumber !== undefined ? inventoryNumber === 0 : availabilityValue === "unavailable" || availabilityValue === "售罄";
    return [{
      id: textValue(item.id ?? item.sourceId) ?? `meituan-${index}-${randomUUID()}`,
      kind: (textValue(item.kind) as OfferKind | undefined) ?? kindFor(`${title} ${JSON.stringify(item)}`),
      title,
      ...(textValue(item.imageUrl ?? item.image ?? item.cover) && /^https:\/\//.test(textValue(item.imageUrl ?? item.image ?? item.cover)!) ? { imageUrl: textValue(item.imageUrl ?? item.image ?? item.cover) } : {}),
      provider: "meituan" as const,
      city: input.city ?? input.destination,
      origin: input.origin,
      destination: input.destination,
      date: input.startDate,
      departureTime,
      arrivalTime,
      priceLabel: textValue(item.priceLabel ?? item.price ?? item.cost),
      availability: available ? "available" as const : unavailable ? "unavailable" as const : "unknown" as const,
      inventoryLabel: inventoryNumber !== undefined ? `余票 ${inventoryNumber}` : textValue(inventoryValue),
      ratingLabel: textValue(item.ratingLabel ?? item.rating),
      description: textValue(item.description ?? item.summary ?? item.reason),
      ...(url && /^https?:\/\//.test(url) ? { bookingUrl: url } : {}),
      sourceId: textValue(item.sourceId ?? item.id),
      fetchedAt,
      structured: true,
      rawJson: row,
    }];
  });
}

export function mapMarkdownOffers(rawText: string, input: MeituanQueryInput, fetchedAt: string): TravelOffer[] {
  const lines = rawText.split(/\r?\n/).map((line) => line.replace(/^\s*[-*#>\d.]+\s*/, "").trim()).filter(Boolean);
  const candidates = lines.filter((line) => /酒店|高铁|火车|航班|机票|门票|美食|餐厅|优惠/.test(line)).slice(0, 30);
  return candidates.flatMap((line, index) => {
    const kind = kindFor(line);
    const times = line.match(/\b(?:[01]\d|2[0-3]):[0-5]\d\b/g) ?? [];
    const hasPrice = /[¥￥]\s*\d|\d+(?:\.\d+)?\s*元/i.test(line);
    const hasInventory = /余票|剩余|库存|可售|可预订|可预约|售罄|无票/i.test(line);
    const hasTransportId = /\b(?:[GDCZTK]\d{1,5}|MU\d{2,4}|CZ\d{2,4}|CA\d{2,4}|HU\d{2,4}|9C\d{2,4})\b/i.test(line);
    const hasRoute = /[\p{L}]{2,}(?:西|东|南|北)?\s*(?:→|->|到|至)\s*[\p{L}]{2,}/u.test(line);
    // A paragraph such as “晚上出发、性价比高” is a recommendation, not a
    // ticket result. Keep it in rawText but do not render it as a fake result
    // card with empty schedule and inventory fields.
    if (/预算|往返机票总价|豪华酒店|省下的钱|如果你需要|小贴士/i.test(line) && !hasTransportId && times.length === 0) return [];
    if ((kind === "train" || kind === "flight") && !(times.length >= 2 || hasTransportId || (hasRoute && (times.length || hasPrice || hasInventory)))) return [];
    if (kind === "hotel" && !hasPrice && !hasInventory && !/\b酒店\s*[A-Za-z\u4e00-\u9fff]{2,}/u.test(line)) return [];
    const title = line.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").trim().slice(0, 160);
    if (!title) return [];
    // Markdown is not a stable schema, but travel providers commonly include
    // these human-readable fields. Extract them conservatively and keep the
    // original line as rawText so the UI can distinguish inferred fields.
    const priceLabel = line.match(/[¥￥]\s*(?:<\s*)?\d+(?:\.\d+)?(?:\s*元)?(?:起)?|\d+(?:\.\d+)?\s*元(?:起)?/i)?.[0]?.replace(/\s+/g, " ");
    const inventoryMatch = line.match(/(?:余票|剩余|库存|可售)\s*[:：]?\s*(\d+)\s*(?:张|个|间|席)?/i);
    const positiveInventory = /有票|可预订|可预约|库存充足|余票充足|立即预订|可购买/i.test(line);
    const soldOut = /售罄|无票|不可预订|已满|暂停售票/i.test(line);
    const availability = soldOut ? "unavailable" as const : (inventoryMatch && Number(inventoryMatch[1]) > 0) || positiveInventory ? "available" as const : "unknown" as const;
    const inventoryLabel = inventoryMatch
      ? `${/余票|剩余/.test(inventoryMatch[0]) ? "余票" : "库存"} ${inventoryMatch[1]}${/间/.test(inventoryMatch[0]) ? "间" : /席/.test(inventoryMatch[0]) ? "席" : "张"}`
      : positiveInventory ? "可预订" : soldOut ? "已售罄" : undefined;
    const sourceUrl = line.match(/https?:\/\/[^\s)]+/)?.[0];
    return [{
    id: `meituan-text-${index}-${randomUUID()}`,
    kind,
    title,
    provider: "meituan" as const,
    city: input.city ?? input.destination,
    origin: input.origin,
    destination: input.destination,
    date: input.startDate,
    departureTime: times[0],
    arrivalTime: times[1],
    priceLabel,
    availability,
    inventoryLabel,
    description: "美团原文提取，时间、价格和库存请以供应商页面为准",
    bookingUrl: sourceUrl,
    fetchedAt,
    structured: false,
    rawText,
  }];
  });
}

function queryText(input: MeituanQueryInput) {
  const scope = [input.origin && `从${input.origin}出发`, input.destination && `去${input.destination}`, input.startDate && `${input.startDate}${input.endDate ? `至${input.endDate}` : ""}`, input.travelers && `${input.travelers}人`, input.budget && `预算${input.budget}元`].filter(Boolean).join("，");
  const categories = input.categories?.length ? `，重点查询${input.categories.join("、")}` : "";
  return `${scope}${scope ? "，" : ""}${input.query}${categories}`;
}

export type MeituanCommandRunner = (args: string[], timeoutMs?: number) => Promise<{ code: number; stdout: string; stderr: string }>;

function runCommand(args: string[], timeoutMs = 120_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const command = process.platform === "win32" ? process.execPath : "npx";
    const commandArgs = process.platform === "win32"
      ? [path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js"), ...args]
      : args;
    const child = spawn(command, commandArgs, { env: { ...process.env, MEITUAN_HT_TOKEN: runtimeConfigSync("MEITUAN_HT_TOKEN"), MEITUAN_RAW_JSON: "1" }, shell: false });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new SkillError("MEITUAN_TIMEOUT", "Meituan query timed out")); }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString().replace(/([A-Za-z0-9_-]{24,})/g, "[REDACTED]"); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, stdout, stderr }); });
  });
}

export async function queryMeituan(input: MeituanQueryInput, execute: MeituanCommandRunner = runCommand): Promise<MeituanQueryResult> {
  if (!runtimeConfigSync("MEITUAN_HT_TOKEN")) throw new SkillError("MEITUAN_PROVIDER_NOT_CONFIGURED", "MEITUAN_HT_TOKEN is not configured");
  const fetchedAt = new Date().toISOString();
  const result = await execute(["@meituan-travel/ht-ai@latest", "query", "--query", queryText(input), "--origin-query", input.query, "--channel", "meituan-developer", ...(input.city ? ["--city", input.city] : [])]);
  if (result.code === 3 || /鉴权|token|auth/i.test(result.stderr)) throw new SkillError("MEITUAN_AUTH_FAILED", "Meituan authentication failed");
  if (result.code !== 0) throw new SkillError("TRAVEL_OFFERS_UNAVAILABLE", "Meituan query failed");
  const rawText = result.stdout.trim();
  if (!rawText) throw new SkillError("MEITUAN_EMPTY_RESULT", "Meituan returned an empty response");
  let rawJson: unknown;
  try { rawJson = JSON.parse(rawText); } catch { rawJson = undefined; }
  const envelopeText = rawJson && typeof rawJson === "object" && typeof (rawJson as { data?: unknown }).data === "string"
    ? (rawJson as { data: string }).data
    : undefined;
  const mapped = rawJson === undefined
    ? mapMarkdownOffers(rawText, input, fetchedAt)
    : envelopeText
      ? mapMarkdownOffers(envelopeText, input, fetchedAt)
      : mapJsonOffers(rawJson, input, fetchedAt);
  const offers = reconcileTrainOffers(input.categories?.length ? mapped.filter((offer) => input.categories!.includes(offer.kind)) : mapped);
  if (rawJson !== undefined && offers.length === 0) throw new SkillError("MEITUAN_EMPTY_RESULT", "Meituan returned no matching offers");
  const structured = offers.some((offer) => offer.structured);
  return { offers, rawText, rawJson, status: { overall: structured ? "REAL" : "UNSTRUCTURED", fetchedAt, ...(structured ? {} : { warnings: ["Meituan response was retained as raw text because it could not be fully structured"] }) } };
}
