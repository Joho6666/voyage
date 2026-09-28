"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { ArrowLeft, ArrowRight, Check, CircleAlert, Compass, LoaderCircle, RotateCcw, ShieldCheck, Sparkles, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { brand } from "@/lib/brand";
import { hydrateTrip } from "@/store/trip-store";
import type { Trip } from "@/types/travel";
import { PlanningChat } from "@/components/planning/PlanningChat";
import { PlanningProfilePanel } from "@/components/planning/PlanningProfilePanel";
import { PlanningStatusCard } from "@/components/planning/PlanningStatusCard";
import type { PlanningLlmState, PlanningLlmStatus, PlanningMessage, PlanningProfileDraft } from "@/components/planning/types";
import { dateRangeWarning, directPrompt, generateBlockersFor, profilePatchFromDraft } from "./planning-client";

const QUICK_PROMPTS = [
  "从桂林出发，去南京玩 3 天，喜欢美食，不想走太多路",
  "周末去重庆，想看夜景、吃火锅，节奏轻松一点",
  "带父母去厦门，4 天，少换酒店，靠近公共交通",
];

const DEFAULT_SUGGESTIONS = ["轻松一点，少走路", "我想把预算控制住", "有哪些必去但不赶的地方？", "我有一个一定要去的地方"];
const MISSING_FIELD_LABELS: Record<string, string> = {
  destination: "目的地",
  dates: "出发日期（只填天数不够）",
  startDate: "出发日期",
  endDate: "返程日期",
  travelers: "同行人数",
  budget: "预算",
  pace: "旅行节奏",
  walkingTolerance: "步行接受度",
  transportPreference: "交通偏好",
  vibes: "兴趣偏好",
  mustVisit: "必去地点",
  avoid: "避开事项",
  socialOptIn: "社区攻略授权",
};

const GENERATION_STAGES = ["读取已确认的旅行偏好", "整理候选地点与外部数据", "编排每天的行程节奏", "计算交通并保存路线"];

type View = "landing" | "conversation";
type BusyState = "idle" | "starting" | "sending" | "generating";
type UnknownRecord = Record<string, unknown>;

interface ParsedPlanningPayload {
  sessionId?: string;
  revision?: number;
  messages: PlanningMessage[];
  assistantMessage?: PlanningMessage;
  profile: PlanningProfileDraft;
  suggestedReplies: string[];
  llmStatus: PlanningLlmStatus;
  readyToGenerate?: boolean;
  /** Day count reported by the planner; a day count alone cannot date a trip. */
  days?: number;
  missingFields: string[];
  warnings: string[];
  trip?: Trip;
  tripRevision?: number;
  tripId?: string;
}

function createDefaultProfile(): PlanningProfileDraft {
  return {
    origin: "",
    destination: "",
    startDate: "",
    endDate: "",
    travelers: "",
    budget: "",
    vibes: [],
    pace: "",
    walkingTolerance: "",
    transportPreference: "",
    mustVisit: "",
    avoid: "",
    includeOffers: false,
    includeSocialEvidence: false,
  };
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown) {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text || undefined;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const number = Number(value.replace(/[,，¥￥\s]/g, ""));
    return Number.isFinite(number) ? number : undefined;
  }
  return undefined;
}

function asBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (["true", "1", "yes", "on"].includes(value.toLowerCase())) return true;
    if (["false", "0", "no", "off"].includes(value.toLowerCase())) return false;
  }
  return undefined;
}

function asStringArray(value: unknown) {
  if (Array.isArray(value)) return value.map(asString).filter((item): item is string => Boolean(item));
  const text = asString(value);
  return text ? text.split(/[,，、;/；]+/).map((item) => item.trim()).filter(Boolean) : [];
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function valueFrom(node: UnknownRecord | undefined, keys: string[]) {
  if (!node) return undefined;
  for (const key of keys) {
    if (node[key] !== undefined && node[key] !== null) return node[key];
  }
  return undefined;
}

function addNode(nodes: UnknownRecord[], value: unknown) {
  if (isRecord(value) && !nodes.includes(value)) nodes.push(value);
}

function responseNodes(payload: unknown) {
  const nodes: UnknownRecord[] = [];
  if (!isRecord(payload)) return nodes;
  const data = payload.data;
  const result = payload.result;
  const session = payload.session ?? payload.planningSession ?? payload.snapshot;
  addNode(nodes, session);
  if (isRecord(data)) {
    addNode(nodes, data.session ?? data.planningSession ?? data.snapshot);
    addNode(nodes, data.result ?? data.payload);
    addNode(nodes, data);
  }
  if (isRecord(result)) {
    addNode(nodes, result.session ?? result.planningSession ?? result.snapshot);
    addNode(nodes, result.data ?? result.payload);
    addNode(nodes, result);
  }
  addNode(nodes, payload);
  return nodes;
}

function firstValue(nodes: UnknownRecord[], keys: string[]) {
  for (const node of nodes) {
    const value = valueFrom(node, keys);
    if (value !== undefined) return value;
  }
  return undefined;
}

function firstRecord(nodes: UnknownRecord[], keys: string[]) {
  for (const node of nodes) {
    for (const key of keys) if (isRecord(node[key])) return node[key];
  }
  return undefined;
}

function firstArray(nodes: UnknownRecord[], keys: string[]) {
  for (const node of nodes) {
    for (const key of keys) if (Array.isArray(node[key])) return node[key];
  }
  return undefined;
}

function normalizeRole(value: unknown, fallback: PlanningMessage["role"]): PlanningMessage["role"] {
  const role = asString(value)?.toLowerCase();
  if (role === "user" || role === "human") return "user";
  if (role === "system") return "system";
  if (role === "assistant" || role === "agent" || role === "bot") return "assistant";
  return fallback;
}

function messageFrom(value: unknown, fallbackRole: PlanningMessage["role"], index: number): PlanningMessage | null {
  if (typeof value === "string") {
    const content = value.trim();
    return content ? { id: `planning-message-${Date.now()}-${index}`, role: fallbackRole, content } : null;
  }
  if (!isRecord(value)) return null;
  const content = asString(value.content) ?? asString(value.text) ?? asString(value.body) ?? asString(value.message);
  if (!content) return null;
  return {
    id: asString(value.id) ?? asString(value.messageId) ?? `planning-message-${Date.now()}-${index}`,
    role: normalizeRole(value.role, fallbackRole),
    content,
    createdAt: asString(value.createdAt) ?? asString(value.timestamp),
  };
}

function messageKey(message: PlanningMessage) {
  return `${message.role}:${message.content.trim()}`;
}

function mergeMessages(current: PlanningMessage[], incoming: PlanningMessage[]) {
  const next = [...current];
  const ids = new Set(next.map((message) => message.id));
  const keys = new Set(next.map(messageKey));
  for (const message of incoming) {
    if (ids.has(message.id) || keys.has(messageKey(message))) continue;
    next.push(message);
    ids.add(message.id);
    keys.add(messageKey(message));
  }
  return next.slice(-80);
}

function mapPace(value: unknown, fallback: string) {
  const text = asString(value);
  if (!text) return fallback;
  if (/relaxed|slow|轻松|慢/.test(text.toLowerCase())) return "轻松留白";
  if (/intensive|fast|特种兵|紧凑/.test(text.toLowerCase())) return "特种兵一点";
  if (/balanced|standard|normal|适中|充实/.test(text.toLowerCase())) return "刚好充实";
  return text;
}

function mapWalking(value: unknown, fallback: string) {
  const text = asString(value);
  if (!text) return fallback;
  if (/low|少走|低/.test(text.toLowerCase())) return "少走路";
  if (/high|多走|高/.test(text.toLowerCase())) return "可以多走一点";
  if (/medium|适中|中/.test(text.toLowerCase())) return "适中";
  return text;
}

function mapTransport(value: unknown, fallback: string) {
  const text = asString(value);
  if (!text) return fallback;
  if (/public|metro|bus|walk|公交|地铁|步行/.test(text.toLowerCase())) return "公共交通优先";
  if (/taxi|drive|打车|出租|自驾/.test(text.toLowerCase())) return "打车更方便";
  if (/mixed|mix|混合/.test(text.toLowerCase())) return "混合安排";
  return text;
}

/**
 * Profile facts live one level below the session root, so the same node list
 * must back every profile read. Reading only the session root silently misses
 * `profile.days`, which decides whether a day count can stand in for a return
 * date.
 */
function profileNodesOf(nodes: UnknownRecord[]) {
  const profilePatches = nodes.map((node) => node.profilePatch).filter(isRecord);
  const profiles = nodes.map((node) => valueFrom(node, ["profile", "planningProfile", "tripProfile", "preferences"])).filter(isRecord);
  return [...profilePatches, ...profiles, ...nodes];
}

function profileFrom(nodes: UnknownRecord[], base: PlanningProfileDraft) {
  const profileNodes = profileNodesOf(nodes);
  const vibes = asStringArray(firstValue(profileNodes, ["vibes", "interests", "styles"]))
    .filter((item) => !/^(relaxed|standard|intensive|轻松|适中|特种兵)$/i.test(item));
  const mustVisit = asStringArray(firstValue(profileNodes, ["mustVisit", "must_visits", "mustSee"]));
  const avoid = asStringArray(firstValue(profileNodes, ["avoid", "avoidances", "avoidList"]));
  const travelers = asNumber(firstValue(profileNodes, ["travelers", "people", "partySize"]));
  // Budget is the trip's total budget; never re-label it as per-person.
  const budget = asNumber(firstValue(profileNodes, ["budget", "budgetCny", "totalBudget"]));
  return {
    ...base,
    origin: asString(firstValue(profileNodes, ["origin", "from", "startCity"])) ?? base.origin,
    destination: asString(firstValue(profileNodes, ["destination", "to", "city"])) ?? base.destination,
    startDate: asString(firstValue(profileNodes, ["startDate", "dateFrom", "departureDate", "checkIn"])) ?? base.startDate,
    endDate: asString(firstValue(profileNodes, ["endDate", "dateTo", "returnDate", "checkOut"])) ?? base.endDate,
    travelers: travelers === undefined ? base.travelers : String(travelers),
    budget: budget === undefined ? base.budget : String(budget),
    vibes: vibes.length ? uniqueStrings(vibes) : base.vibes,
    pace: mapPace(firstValue(profileNodes, ["pace", "travelPace"]), base.pace),
    walkingTolerance: mapWalking(firstValue(profileNodes, ["walkingTolerance", "walking", "walkTolerance"]), base.walkingTolerance),
    transportPreference: mapTransport(firstValue(profileNodes, ["transportPreference", "transport"]), base.transportPreference),
    mustVisit: mustVisit.length ? uniqueStrings(mustVisit).join("、") : base.mustVisit,
    avoid: avoid.length ? uniqueStrings(avoid).join("、") : base.avoid,
    includeOffers: asBoolean(firstValue(profileNodes, ["includeOffers", "includeExternalOffers", "offersOptIn"])) ?? base.includeOffers,
    includeSocialEvidence: asBoolean(firstValue(profileNodes, ["includeSocialEvidence", "includeSocial", "socialOptIn"])) ?? base.includeSocialEvidence,
  } satisfies PlanningProfileDraft;
}

function safeStatusText(value: unknown) {
  const text = asString(value);
  if (!text || /(api[_ -]?key|secret|token|credential|authorization|password)/i.test(text)) return undefined;
  return text.slice(0, 160);
}

function llmFrom(nodes: UnknownRecord[]): PlanningLlmStatus {
  const rawNode = firstRecord(nodes, ["llmStatus", "llm", "planningMetadata", "provenance"]);
  const llmNodes = rawNode ? [rawNode, ...nodes] : nodes;
  const explicitState = rawNode
    ? firstValue([rawNode], ["state", "status", "llm", "source", "mode"])
    : firstValue(nodes, ["llmStatus", "llm", "planningSource", "source"]);
  const rawState = asString(explicitState)?.toLowerCase() ?? "";
  const reason = safeStatusText(firstValue(llmNodes, ["fallbackReason", "reason"]));
  let state: PlanningLlmState = "unknown";
  if (["used", "ready", "enabled", "llm"].includes(rawState) || rawState === "ok") state = "ready";
  else if (["failed", "error", "fallback"].includes(rawState)) state = rawState === "failed" || rawState === "error" ? "error" : "fallback";
  else if (["unavailable", "skipped", "rules", "rule"].includes(rawState)) state = rawState === "skipped" || rawState === "rules" || rawState === "rule" ? "unavailable" : "unavailable";
  return {
    state,
    label: state === "ready" ? "LLM 已启用" : state === "fallback" || state === "error" ? "本轮已降级" : state === "unavailable" ? "规则模式" : undefined,
    provider: safeStatusText(firstValue(llmNodes, ["provider", "providerName"])),
    model: safeStatusText(firstValue(llmNodes, ["model", "modelName"])),
    reason,
  };
}

function suggestionsFrom(nodes: UnknownRecord[]) {
  const raw = firstArray(nodes, ["suggestedReplies", "suggestions", "quickReplies", "nextQuestions"]);
  if (!raw) return [];
  return uniqueStrings(raw.map((item) => typeof item === "string" ? item : isRecord(item) ? asString(item.label) ?? asString(item.text) ?? asString(item.prompt) : undefined).filter((item): item is string => Boolean(item))).slice(0, 8);
}

function missingFrom(nodes: UnknownRecord[]) {
  const raw = firstArray(nodes, ["missingFields", "missing"]);
  if (!raw) return [];
  return uniqueStrings(raw.map((item) => {
    const value = typeof item === "string" ? item : isRecord(item) ? asString(item.label) ?? asString(item.field) : undefined;
    return value ? MISSING_FIELD_LABELS[value] ?? value : undefined;
  }).filter((item): item is string => Boolean(item))).slice(0, 8);
}

function warningsFrom(nodes: UnknownRecord[]) {
  const raw = firstArray(nodes, ["warnings", "warning"]);
  return raw ? uniqueStrings(raw.map(asString).filter((item): item is string => Boolean(item))).slice(0, 6) : [];
}

function parsePlanningPayload(payload: unknown, baseProfile: PlanningProfileDraft): ParsedPlanningPayload {
  const nodes = responseNodes(payload);
  const sessionNode = firstRecord(nodes, ["session", "planningSession", "snapshot"]) ?? nodes[0];
  const sessionNodes = sessionNode ? [sessionNode, ...nodes] : nodes;
  const messageValues: unknown[] = [];
  for (const node of sessionNodes) {
    for (const key of ["messages", "chatMessages", "history", "conversation"]) {
      if (Array.isArray(node[key])) messageValues.push(...node[key]);
    }
  }
  const messages = messageValues.map((value, index) => messageFrom(value, "assistant", index)).filter((item): item is PlanningMessage => Boolean(item));
  const singularAssistant = ["assistantMessage", "assistantReply", "reply", "welcomeMessage"]
    .map((key) => firstValue(sessionNodes, [key]))
    .map((value, index) => messageFrom(value, "assistant", 100 + index))
    .find((item): item is PlanningMessage => Boolean(item));
  const mergedMessages = mergeMessages([], messages);
  const assistantMessage = singularAssistant ?? [...mergedMessages].reverse().find((message) => message.role === "assistant");
  if (singularAssistant && !mergedMessages.some((message) => messageKey(message) === messageKey(singularAssistant))) mergedMessages.push(singularAssistant);
  const rawId = firstValue(sessionNodes, ["sessionId", "planningSessionId"]);
  const fallbackId = sessionNode ? firstValue([sessionNode], ["id"]) : undefined;
  const rawRevision = asNumber(firstValue(sessionNodes, ["revision", "expectedRevision", "version"]));
  const revision = rawRevision !== undefined && rawRevision >= 1 ? Math.floor(rawRevision) : undefined;
  const ready = asBoolean(firstValue(sessionNodes, ["readyToGenerate", "canGenerate", "ready"]));
  const rawDays = asNumber(firstValue(profileNodesOf(sessionNodes), ["days", "dayCount", "tripDays"]));
  const days = rawDays !== undefined && rawDays >= 1 && rawDays <= 31 ? Math.floor(rawDays) : undefined;
  const parsed = {
    sessionId: asString(rawId) ?? asString(fallbackId),
    revision,
    days,
    messages: mergedMessages,
    assistantMessage,
    profile: profileFrom(sessionNodes, baseProfile),
    suggestedReplies: suggestionsFrom(sessionNodes),
    llmStatus: llmFrom(sessionNodes),
    readyToGenerate: ready,
    missingFields: missingFrom(sessionNodes),
    warnings: warningsFrom(nodes),
  } satisfies ParsedPlanningPayload;
  return parsed;
}

function parseGenerationPayload(payload: unknown, baseProfile: PlanningProfileDraft): ParsedPlanningPayload {
  const parsed = parsePlanningPayload(payload, baseProfile);
  const nodes = responseNodes(payload);
  const rawTrip = firstRecord(nodes, ["trip", "generatedTrip", "createdTrip"]);
  const trip = rawTrip && typeof rawTrip.id === "string" && Array.isArray(rawTrip.days) && Array.isArray(rawTrip.items) ? rawTrip as unknown as Trip : undefined;
  const tripId = asString(firstValue(nodes, ["tripId", "createdTripId"])) ?? (trip ? trip.id : undefined);
  // The planning-session revision and the stored trip revision are different
  // numbers. Only the Runtime trip envelope carries the trip's own revision, so
  // read it from the node that actually holds the trip payload.
  const tripNode = nodes.find((node) => node.trip === rawTrip || (typeof node.tripHash === "string" && node.tripId !== undefined));
  const rawTripRevision = asNumber(tripNode?.revision) ?? asNumber((trip as unknown as UnknownRecord | undefined)?.revision);
  const tripRevision = rawTripRevision !== undefined && rawTripRevision >= 1 ? Math.floor(rawTripRevision) : undefined;
  return { ...parsed, trip, tripRevision, tripId };
}

/**
 * Mirrors the generate endpoint's preconditions: a destination, a real
 * departure date, and either a return date or an explicit day count. A day
 * count alone must never read as ready, because the Runtime will not invent a
 * departure date.
 */
async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    const lines = text.split(/\r?\n/).map((line) => line.replace(/^data:\s*/, "").trim()).filter(Boolean).reverse();
    for (const line of lines) {
      try { return JSON.parse(line) as unknown; } catch { /* keep looking for a JSON event */ }
    }
    return { message: text.slice(0, 240) };
  }
}

function errorDetails(payload: unknown) {
  const nodes = responseNodes(payload);
  const errorNode = firstRecord(nodes, ["error", "errors"]);
  const code = asString(valueFrom(errorNode, ["code", "type"])) ?? asString(firstValue(nodes, ["errorCode", "code"]));
  const message = safeStatusText(valueFrom(errorNode, ["message", "detail"])) ?? safeStatusText(firstValue(nodes, ["message", "errorMessage"]));
  const detailNode = firstRecord([errorNode ?? {}, ...nodes], ["details"]);
  const revision = asNumber(valueFrom(detailNode, ["revision"])) ?? asNumber(firstValue(nodes, ["revision"]));
  return { code, message, details: detailNode, revision: revision !== undefined && revision >= 1 ? Math.floor(revision) : undefined };
}

/**
 * Provider failures must read as actionable Chinese guidance. Raw provider
 * text is English and leaks no credentials, but it does not tell the traveller
 * what to do next.
 */
const PROVIDER_ERROR_COPY: Array<{ test: RegExp; message: string }> = [
  { test: /NO_PROVIDER_CONFIGURED/, message: "尚未配置高德服务端 Key。请设置 AMAP_SERVER_KEY 后再创建真实行程。" },
  { test: /PROVIDER_AUTH_FAILED|AMAP_INVALID_USER_KEY/, message: "高德 Web 服务 Key 无效或未开通 POI 服务，请检查控制台的 Key 类型、服务权限和安全设置。" },
  { test: /AMAP_NETWORK_UNAVAILABLE/, message: "高德服务连接失败（不是没有地点结果）。请检查本机网络/代理后重试；如果服务刚启动，请刷新页面再试。" },
  { test: /ROUTE_PROVIDER_UNAVAILABLE/, message: "高德路线服务暂时不可用；可重试，行程中的路线会明确标记为估算。" },
  { test: /REVISION_CONFLICT/, message: "这条规划刚刚在其他页面更新了。已同步最新版本，可以再点一次生成。" },
  { test: /CONFIRMATION_REQUIRED/, message: "生成路线图需要你在页面上明确确认一次，请重新点击按钮。" },
  { test: /PLANNING_SESSION_LOCKED/, message: "这次规划已经在生成中或已完成，请回到行程页继续调整。" },
  { test: /PLANNING_SESSION_NOT_FOUND/, message: "这次规划会话已失效，请重新开始对话。" },
  { test: /INVALID_INPUT/, message: "规划信息不完整，请补充目的地、出发日期与返程信息。" },
];

function friendlyError(payload: unknown, status: number, fallback: string) {
  const details = errorDetails(payload);
  const haystack = `${details.code ?? ""} ${details.message ?? ""}`;
  const match = PROVIDER_ERROR_COPY.find((entry) => entry.test.test(haystack));
  if (match) return match.message;
  if (status >= 500) return "规划服务暂时不可用，请稍后重试；浏览器没有接触任何服务凭据。";
  return details.message ?? fallback;
}



function welcomeMessage(prompt: string, profile: PlanningProfileDraft): PlanningMessage {
  const destination = profile.destination || "目的地";
  const opening = prompt.trim() ? `收到，我先把“${prompt.trim().slice(0, 72)}${prompt.trim().length > 72 ? "…" : ""}”记下来。` : "我们先从旅行想法开始。";
  return {
    id: `planning-welcome-${Date.now()}`,
    role: "assistant",
    content: `${opening}\n\n我会先确认目的地、日期、同行人数和节奏，再在你确认后生成路线图。现在的画像里目的地是${destination}；不确定的部分可以直接说“还没想好”。`,
  };
}

function GenerationProgress({ destination }: { destination: string }) {
  return (
    <section className="rounded-[20px] border border-primary/15 bg-accent/50 p-4 sm:p-5" aria-live="polite">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground"><LoaderCircle className="size-4 animate-spin" /></span>
        <div>
          <h2 className="text-sm font-semibold">正在生成{destination ? ` · ${destination}` : "路线图"}</h2>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">这是一次真实的生成请求，完成后会进入行程工作区。我们不会把静态动画当成 provider 已完成的证明。</p>
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        {GENERATION_STAGES.map((stage, index) => (
          <div key={stage} className="flex items-center gap-2 rounded-xl border border-border/70 bg-surface/75 px-2.5 py-2 text-[11px] text-muted-foreground">
            <span className={index === 0 ? "grid size-5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground" : "grid size-5 shrink-0 place-items-center rounded-full bg-muted"}>
              {index === 0 ? <LoaderCircle className="size-3 animate-spin" /> : <span>{index + 1}</span>}
            </span>
            <span>{stage}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function NewTripExperience() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [view, setView] = useState<View>("landing");
  const [prompt, setPrompt] = useState("喜欢美食和夜景，安排轻松一点。");
  const [profile, setProfile] = useState<PlanningProfileDraft>(() => createDefaultProfile());
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [messages, setMessages] = useState<PlanningMessage[]>([]);
  const [suggestedReplies, setSuggestedReplies] = useState(DEFAULT_SUGGESTIONS);
  const [llmStatus, setLlmStatus] = useState<PlanningLlmStatus>({ state: "unknown" });
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [plannerDays, setPlannerDays] = useState<number | undefined>(undefined);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<BusyState>("idle");
  const [error, setError] = useState("");
  const [directMode, setDirectMode] = useState(false);
  const [profileDirty, setProfileDirty] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const messagesRef = useRef<PlanningMessage[]>([]);
  const profileRef = useRef(profile);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    const query = searchParams.get("q");
    if (query) setPrompt(query);
  }, [searchParams]);

  const isBusy = busy !== "idle";
  const blockers = generateBlockersFor(profile, plannerDays);
  const rangeWarning = dateRangeWarning(profile);

  const replaceMessages = (next: PlanningMessage[]) => {
    const bounded = next.slice(-80);
    messagesRef.current = bounded;
    setMessages(bounded);
  };

  const adoptPayload = (parsed: ParsedPlanningPayload, baseProfile: PlanningProfileDraft, enterConversation = false) => {
    const nextProfile = parsed.profile ?? baseProfile;
    setProfile(nextProfile);
    profileRef.current = nextProfile;
    setProfileDirty(false);
    if (parsed.revision !== undefined) setRevision(parsed.revision);
    setSuggestedReplies(parsed.suggestedReplies.length ? parsed.suggestedReplies : DEFAULT_SUGGESTIONS);
    setLlmStatus(parsed.llmStatus);
    setMissingFields(parsed.missingFields);
    setPlannerDays(parsed.days);
    setWarnings(parsed.warnings);
    if (parsed.messages.length) {
      const nextMessages = messagesRef.current.length ? mergeMessages(messagesRef.current, parsed.messages) : parsed.messages;
      replaceMessages(nextMessages);
    }
    if (enterConversation) setView("conversation");
  };

  const requestSession = async (initialPrompt?: string, initialProfile?: PlanningProfileDraft) => {
    const profilePatch = initialProfile ? profilePatchFromDraft(initialProfile) : undefined;
    const body = {
      ...(initialPrompt?.trim() ? { prompt: initialPrompt.trim() } : {}),
      ...(profilePatch && Object.keys(profilePatch).length ? { profile: profilePatch } : {}),
    };
    const response = await fetch("/api/voyage/planning/session", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      cache: "no-store",
      body: JSON.stringify(body),
    });
    const payload = await readPayload(response);
    if (!response.ok || (isRecord(payload) && payload.ok === false)) throw new Error(friendlyError(payload, response.status, "规划会话创建失败，请重试。"));
    const parsed = parsePlanningPayload(payload, profileRef.current);
    if (!parsed.sessionId) throw new Error("规划服务没有返回会话 ID，请重试。浏览器没有发送或读取任何服务凭据。");
    return parsed.revision === undefined ? { ...parsed, revision: 1 } : parsed;
  };

  const startConversation = async () => {
    if (busy !== "idle") return;
    setBusy("starting");
    setError("");
    try {
      const parsed = await requestSession(prompt);
      setSessionId(parsed.sessionId ?? null);
      adoptPayload(parsed, profileRef.current, true);
      const initialMessages = parsed.messages.some((message) => message.role === "assistant")
        ? parsed.messages
        : [...parsed.messages, welcomeMessage(prompt, parsed.profile)];
      replaceMessages(initialMessages);
      if (!parsed.messages.length) setStreamingMessageId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "规划会话创建失败，请重试。");
    } finally {
      setBusy("idle");
    }
  };

  const updateProfile = (changes: Partial<PlanningProfileDraft>) => {
    const next = { ...profileRef.current, ...changes };
    profileRef.current = next;
    setProfile(next);
    setProfileDirty(true);
  };

  const sendMessage = async (requested?: string) => {
    const text = (requested ?? draft).trim();
    if (!text || !sessionId || busy !== "idle") return;
    const currentProfile = profileRef.current;
    const userMessage: PlanningMessage = { id: `planning-user-${Date.now()}`, role: "user", content: text };
    replaceMessages([...messagesRef.current, userMessage]);
    setDraft("");
    setError("");
    setWarnings([]);
    setBusy("sending");
    setStreamingMessageId(null);
    const structuredProfile = profileDirty ? profilePatchFromDraft(currentProfile) : undefined;
    try {
      const response = await fetch(`/api/voyage/planning/session/${encodeURIComponent(sessionId)}/message`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          message: text,
          expectedRevision: revision,
          ...(structuredProfile && Object.keys(structuredProfile).length ? { profile: structuredProfile } : {}),
        }),
      });
      const payload = await readPayload(response);
      if (!response.ok || (isRecord(payload) && payload.ok === false)) throw new Error(friendlyError(payload, response.status, "消息发送失败，请稍后重试。"));
      const parsed = parsePlanningPayload(payload, currentProfile);
      adoptPayload(parsed, currentProfile);
      const incoming = parsed.messages.length ? parsed.messages : parsed.assistantMessage ? [parsed.assistantMessage] : [{
        id: `planning-fallback-${Date.now()}`,
        role: "assistant" as const,
        content: "我先记下了这条偏好。你可以继续补充，或者打开右侧画像确认后生成路线图。",
      }];
      const nextMessages = mergeMessages(messagesRef.current, incoming);
      replaceMessages(nextMessages);
      const latestAssistant = parsed.assistantMessage ?? [...incoming].reverse().find((item) => item.role === "assistant");
      if (latestAssistant) {
        const displayed = nextMessages.find((item) => messageKey(item) === messageKey(latestAssistant));
        setStreamingMessageId(displayed?.id ?? latestAssistant.id);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "消息发送失败，请稍后重试。");
    } finally {
      setBusy("idle");
    }
  };

  const syncProfileBeforeGenerate = async (currentSessionId: string, currentRevision: number) => {
    if (!profileDirty) return currentRevision;
    const currentProfile = profileRef.current;
    const structuredProfile = profilePatchFromDraft(currentProfile);
    const response = await fetch(`/api/voyage/planning/session/${encodeURIComponent(currentSessionId)}/message`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        message: "我确认右侧旅行画像，请将它作为最终规划约束。",
        expectedRevision: currentRevision,
        profile: structuredProfile,
      }),
    });
    const payload = await readPayload(response);
    if (!response.ok || (isRecord(payload) && payload.ok === false)) throw new Error(friendlyError(payload, response.status, "旅行画像同步失败，请稍后重试。"));
    const parsed = parsePlanningPayload(payload, currentProfile);
    adoptPayload(parsed, currentProfile);
    const incoming = parsed.messages.length ? parsed.messages : parsed.assistantMessage ? [parsed.assistantMessage] : [];
    const nextMessages = mergeMessages(messagesRef.current, incoming);
    replaceMessages(nextMessages);
    const nextRevision = parsed.revision ?? currentRevision;
    setRevision(nextRevision);
    return nextRevision;
  };

  /**
   * A failed generate still bumps the session revision (generating → failed),
   * so a retry must resync before it can succeed. Without this the second
   * attempt would always fail with a revision conflict even though the session
   * is perfectly retryable.
   */
  const resyncRevision = async (currentSessionId: string, revoked?: number) => {
    if (revoked !== undefined) {
      setRevision(revoked);
      return revoked;
    }
    try {
      const response = await fetch(`/api/voyage/planning/session/${encodeURIComponent(currentSessionId)}`, {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      const payload = await readPayload(response);
      if (!response.ok || (isRecord(payload) && payload.ok === false)) return undefined;
      const parsed = parsePlanningPayload(payload, profileRef.current);
      adoptPayload(parsed, profileRef.current);
      return parsed.revision;
    } catch {
      return undefined;
    }
  };

  const generateRoute = async (sessionOverride?: ParsedPlanningPayload) => {
    const currentSessionId = sessionOverride?.sessionId ?? sessionId;
    if (!currentSessionId || (busy !== "idle" && !sessionOverride)) return;
    const blockers = generateBlockersFor(profileRef.current, sessionOverride?.days ?? plannerDays);
    if (blockers.length) {
      setError(`生成路线图前还需要确认：${blockers.join("、")}。只填天数不够，出发日期必须有真实日期。`);
      return;
    }
    setBusy("generating");
    setError("");
    setWarnings([]);
    let payload: unknown;
    try {
      const currentRevision = sessionOverride?.revision ?? revision;
      const expectedRevision = sessionOverride ? currentRevision : await syncProfileBeforeGenerate(currentSessionId, currentRevision);
      const response = await fetch(`/api/voyage/planning/session/${encodeURIComponent(currentSessionId)}/generate`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        cache: "no-store",
        body: JSON.stringify({ expectedRevision, confirmed: true }),
      });
      payload = await readPayload(response);
      if (!response.ok || (isRecord(payload) && payload.ok === false)) throw new Error(friendlyError(payload, response.status, "路线生成失败，请检查信息后重试。"));
      const parsed = parseGenerationPayload(payload, profileRef.current);
      const tripId = parsed.trip?.id ?? parsed.tripId;
      if (!tripId) throw new Error("路线服务没有返回行程 ID，请稍后重试。");
      if (parsed.trip) hydrateTrip(parsed.trip, parsed.tripRevision ?? 1);
      await new Promise((resolve) => window.setTimeout(resolve, 220));
      router.push(`/trip/${encodeURIComponent(tripId)}`);
      return;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "路线生成失败，请稍后重试。");
      setBusy("idle");
    }
    // Keep the session retryable: adopt the revision the server actually holds.
    const details = errorDetails(payload);
    const resynced = await resyncRevision(currentSessionId, details.revision);
    if (resynced !== undefined) setWarnings(["可以在修改信息后直接再点一次「生成路线图」，这次会话和偏好都不会丢失。"]);
  };

  const generateDirect = async () => {
    if (busy !== "idle") return;
    if (!profileRef.current.destination.trim()) {
      setError("请先填写目的地，或者回到对话模式让 Voyage 帮你确定。");
      return;
    }
    setBusy("starting");
    setError("");
    try {
      const parsed = await requestSession(directPrompt(prompt, profileRef.current), profileRef.current);
      setSessionId(parsed.sessionId ?? null);
      setRevision(parsed.revision ?? 1);
      adoptPayload(parsed, profileRef.current);
      await generateRoute({ ...parsed, sessionId: parsed.sessionId, revision: parsed.revision ?? 1 });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "直接生成失败，请稍后重试。");
      setBusy("idle");
    }
  };

  const reset = () => {
    const fresh = createDefaultProfile();
    setView("landing");
    setSessionId(null);
    setRevision(0);
    setMessages([]);
    messagesRef.current = [];
    setSuggestedReplies(DEFAULT_SUGGESTIONS);
    setLlmStatus({ state: "unknown" });
    setMissingFields([]);
    setPlannerDays(undefined);
    setWarnings([]);
    setDraft("");
    setError("");
    setBusy("idle");
    setDirectMode(false);
    setProfileDirty(false);
    setProfile(fresh);
    profileRef.current = fresh;
  };

  return (
    <main className="relative min-h-dvh overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(circle_at_15%_0%,rgba(15,118,110,0.12),transparent_32%),radial-gradient(circle_at_90%_5%,rgba(194,65,12,0.08),transparent_26%)]" />
      <div className="relative mx-auto max-w-6xl px-4 pb-12 pt-5 sm:px-6 sm:pt-7 lg:px-8">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl bg-foreground text-background"><Compass className="size-4" /></span>
            <div><p className="text-[13px] font-semibold tracking-tight">{brand.name}</p><p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{brand.product}</p></div>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground"><ShieldCheck className="size-3.5 text-primary" />服务端规划 · 凭据不下发</div>
        </header>

        {view === "landing" ? (
          <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1.03fr)_minmax(360px,0.97fr)] lg:items-start lg:gap-12 lg:pt-8">
            <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }} className="pt-2 lg:pt-10">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-accent/70 px-3 py-1.5 text-[11px] text-accent-foreground"><WandSparkles className="size-3.5" />先聊清楚，再生成路线</div>
              <h1 className="mt-5 max-w-xl text-[clamp(2.4rem,6vw,5.2rem)] font-medium leading-[0.98] tracking-[-0.055em] text-balance">把“想去”<br /><span className="text-primary">聊成一条</span><br />真的能走的路线。</h1>
              <p className="mt-6 max-w-lg text-[15px] leading-7 text-muted-foreground">Voyage 会先听懂你的旅行画像，再在你确认后调用真实数据生成每天的路线。你不需要一次把所有细节想完。</p>
              <div className="mt-8 grid max-w-lg grid-cols-3 gap-2 text-[11px] text-muted-foreground">
                {[{ icon: "01", title: "说出念头", text: "自然描述即可" }, { icon: "02", title: "一起校准", text: "画像随对话更新" }, { icon: "03", title: "确认生成", text: "路线可继续调整" }].map((item) => <div key={item.icon} className="border-l border-border pl-3"><span className="font-mono text-primary">{item.icon}</span><p className="mt-1 font-medium text-foreground">{item.title}</p><p className="mt-0.5 leading-4">{item.text}</p></div>)}
              </div>
            </motion.section>

            <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08, duration: 0.45 }} className="space-y-3">
              <div className="rounded-[24px] border border-border bg-surface p-4 shadow-[0_22px_70px_rgba(28,25,23,0.08)] sm:p-5">
                <div className="flex items-start justify-between gap-3"><div><p className="text-[11px] font-medium uppercase tracking-[0.16em] text-primary">Start here</p><h2 className="mt-2 text-xl font-semibold tracking-tight">先说说这趟旅行</h2></div><Sparkles className="mt-1 size-5 text-primary" /></div>
                <Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void startConversation(); }} className="mt-5 min-h-32 resize-none border-border/80 bg-background/60 px-3.5 py-3 text-[14px] leading-6 shadow-none focus-visible:ring-primary/20" placeholder="告诉我你想去哪里、玩几天、和谁一起、预算和喜好……" aria-label="旅行初始想法" />
                {searchParams.get("q") ? <p className="mt-2 text-[11px] text-primary">已带入首页的旅行描述，可以继续修改。</p> : null}
                <div className="mt-4"><p className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">灵感提示</p><div className="flex flex-wrap gap-1.5">{QUICK_PROMPTS.map((item) => <button key={item} type="button" onClick={() => setPrompt(item)} className="rounded-full border border-border bg-background px-2.5 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:border-primary/30 hover:bg-accent hover:text-accent-foreground">{item}</button>)}</div></div>
                <div className="mt-5 flex flex-col-reverse gap-2 border-t border-border/80 pt-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-[10px] leading-4 text-muted-foreground">Enter 不会直接生成<br />你可以在对话里慢慢补充</p><Button size="lg" onClick={() => void startConversation()} disabled={isBusy}>{busy === "starting" ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}开始对话</Button></div>
              </div>

              {directMode ? (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-[24px] border border-border bg-surface p-1 shadow-[0_14px_45px_rgba(28,25,23,0.05)]"><div className="flex items-center justify-between px-4 pt-3"><button type="button" onClick={() => setDirectMode(false)} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" />回到对话入口</button><span className="text-[10px] text-muted-foreground">次要路径</span></div><div className="p-3 sm:p-4"><PlanningProfilePanel profile={profile} onChange={updateProfile} onGenerate={() => void generateDirect()} generating={busy === "starting" || busy === "generating"} disabled={isBusy} showStatus={false} blockers={blockers} days={plannerDays} direct /></div></motion.div>
              ) : (
                <button type="button" onClick={() => setDirectMode(true)} className="group flex w-full items-center justify-between rounded-[18px] border border-dashed border-border bg-surface/60 px-4 py-3 text-left transition-colors hover:border-primary/35 hover:bg-surface"><span><span className="block text-xs font-medium">不想先聊天？直接填写并生成</span><span className="mt-0.5 block text-[10px] text-muted-foreground">保留原来的快速创建入口，信息会安全地交给规划会话。</span></span><ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" /></button>
              )}
              {error ? <div role="alert" className="flex items-start gap-2 rounded-[14px] border border-rose-500/25 bg-rose-500/[0.06] px-3 py-2.5 text-xs text-rose-800"><CircleAlert className="mt-0.5 size-4 shrink-0" /><span>{error}</span></div> : null}
              {busy === "generating" ? <GenerationProgress destination={profile.destination} /> : null}
            </motion.section>
          </div>
        ) : (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-7">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><button type="button" onClick={reset} className="grid size-9 place-items-center rounded-xl border border-border bg-surface text-muted-foreground transition-colors hover:bg-secondary" aria-label="重新开始"><RotateCcw className="size-4" /></button><div><p className="text-[10px] uppercase tracking-[0.16em] text-primary">Planning session</p><h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">一起把这趟旅行定下来</h1></div></div><div className="flex items-center gap-2"><span className="hidden rounded-full border border-border bg-surface px-2.5 py-1 text-[10px] text-muted-foreground sm:inline-flex">版本 {revision}</span><PlanningStatusCard status={llmStatus} compact /></div></div>
            {warnings.length ? <div className="mb-4 rounded-[14px] border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2 text-xs text-amber-900 dark:text-amber-100">{warnings.map((warning) => <p key={warning}>{warning}</p>)}</div> : null}
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
              <div className="min-w-0"><PlanningChat messages={messages} suggestedReplies={suggestedReplies} draft={draft} onDraftChange={setDraft} onSend={(message) => void sendMessage(message)} disabled={busy === "sending" || busy === "generating"} isTyping={busy === "sending"} streamingMessageId={streamingMessageId} />{error ? <div role="alert" className="mt-3 flex items-start gap-2 rounded-[14px] border border-rose-500/25 bg-rose-500/[0.06] px-3 py-2.5 text-xs text-rose-800"><CircleAlert className="mt-0.5 size-4 shrink-0" /><span>{error}</span></div> : null}{busy === "generating" ? <div className="mt-4"><GenerationProgress destination={profile.destination} /></div> : null}</div>
              <aside className="lg:sticky lg:top-5"><PlanningProfilePanel profile={profile} onChange={updateProfile} onGenerate={() => void generateRoute()} generating={busy === "generating"} disabled={busy !== "idle"} llmStatus={llmStatus} missingFields={missingFields} blockers={blockers} days={plannerDays} rangeWarning={rangeWarning} /><div className="mt-3 rounded-[14px] border border-border bg-surface/60 p-3 text-[11px] leading-5 text-muted-foreground"><div className="flex items-center gap-2 text-foreground"><Check className="size-3.5 text-primary" /><span className="font-medium">确认后才会调用路线与供应商能力</span></div><p className="mt-1">模型只负责理解偏好；地点、路线、天气和报价会在生成阶段按 provider 来源标注。</p>{missingFields.length ? <p className="mt-2">还可以补充：{missingFields.join("、")}</p> : null}</div></aside>
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-[10px] text-muted-foreground"><p>会话数据只通过当前页面的相对 API 路径传输，不包含任何 API Key。</p><button type="button" onClick={reset} className="inline-flex items-center gap-1 text-foreground hover:text-primary">重新开始 <ArrowRight className="size-3" /></button></div>
          </motion.div>
        )}
      </div>
    </main>
  );
}
