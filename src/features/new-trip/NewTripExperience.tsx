"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { ArrowRight, Check, CircleAlert, Compass, LoaderCircle, RotateCcw, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { brand } from "@/lib/brand";
import { toast } from "sonner";
import { usePlanningStore } from "@/store/planning-store";
import type { Trip } from "@/types/travel";
import { PlanningChat } from "@/components/planning/PlanningChat";
import { PlanningProfilePanel } from "@/components/planning/PlanningProfilePanel";
import { PlanningStatusCard } from "@/components/planning/PlanningStatusCard";
import type { PlanningLlmState, PlanningLlmStatus, PlanningMessage, PlanningProfileDraft } from "@/components/planning/types";
import { dateRangeWarning, generateBlockersFor, profilePatchFromDraft } from "./planning-client";

/**
 * First upcoming Saturday as an absolute date. The profile extractor only
 * reads explicit dates (20XX-M-D), so relative words like 周末 would strand
 * the traveller on the departure-date blocker after a whole conversation.
 */
function nextSaturdayIso(): string {
  const date = new Date();
  date.setDate(date.getDate() + (((6 - date.getDay()) % 7 + 7) % 7 || 7));
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

const DEFAULT_PROMPT = `${nextSaturdayIso()} 从上海出发去成都玩 3 天，喜欢美食和夜景，节奏轻松一点。`;

const QUICK_PROMPTS = [
  `${nextSaturdayIso()} 从桂林出发，去南京玩 3 天，喜欢美食，不想走太多路`,
  `${nextSaturdayIso()} 去重庆，想看夜景、吃火锅，节奏轻松一点`,
  `${nextSaturdayIso()} 带父母去厦门，4 天，少换酒店，靠近公共交通`,
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
const GENERATION_POLL_INTERVAL_MS = 3000;
// 11 minutes: past the server's 10-minute stale-generation self-heal, so a
// crashed worker unblocks the session (GET flips it to failed) before the
// client gives up — the old 8-minute cap left a 2-minute dead zone where
// every retry bounced off a LOCKED 409.
const GENERATION_POLL_TIMEOUT_MS = 11 * 60 * 1000;const LINK_URL_PATTERN = /https?:\/\/[^\s，。；！？、"'<>）)】\]]+/i;
const SUPPORTED_LINK_HOST = /(?:xiaohongshu\.com|xhslink\.com|douyin\.com|iesdouyin\.com)/i;

interface LinkImportData {
  platform: string;
  platformLabel: string;
  sourceUrl: string;
  title: string;
  resolvedCount: number;
  candidates: Array<{ name: string; resolved: boolean; place?: { name: string; district?: string; rating?: number } }>;
}

type BusyState = "idle" | "starting" | "sending" | "generating" | "restoring";
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
  { test: /NO_PROVIDER_CONFIGURED/, message: "尚未配置高德服务端 Key。请在设置页配置 AMAP_SERVER_KEY 后再生成真实路线。" },
  { test: /PROVIDER_AUTH_FAILED|AMAP_INVALID_USER_KEY/, message: "高德 Web 服务 Key 无效或未开通 POI 服务，请检查控制台的 Key 类型、服务权限和安全设置。" },
  { test: /AMAP_NETWORK_UNAVAILABLE/, message: "高德服务连接失败（不是没有地点结果）。请检查本机网络/代理后重试；如果服务刚启动，请刷新页面再试。" },
  { test: /ROUTE_PROVIDER_UNAVAILABLE/, message: "高德路线服务暂时不可用；可重试，行程中的路线会明确标记为估算。" },
  { test: /REVISION_CONFLICT/, message: "这条规划刚刚在其他页面更新了。已同步最新版本，可以再点一次生成。" },
  { test: /CONFIRMATION_REQUIRED/, message: "生成路线图需要你在页面上明确确认一次，请重新点击按钮。" },
  { test: /PLANNING_SESSION_LOCKED/, message: "这次规划正在后台生成中，完成后行程会出现在「我的旅行」，稍等片刻即可。" },
  { test: /PLANNING_SESSION_COMPLETED/, message: "这次规划已经完成，直接去「我的旅行」查看行程。" },
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
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">这是一次真实的生成请求，生成在服务端后台进行——关闭页面也不会中断，回来时会自动接上。</p>
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
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  // The prefilled example is a shortcut, not an instruction: when the
  // traveller never touched the composer, its example city/date must not
  // override the profile fields they filled by hand (direct generate).
  const [promptTouched, setPromptTouched] = useState(false);
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
  const [profileDirty, setProfileDirty] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [resumable, setResumable] = useState<{ sessionId: string; destination: string; updatedAt: string | null } | null>(null);
  const [linkImport, setLinkImport] = useState<LinkImportData | null>(null);
  const messagesRef = useRef<PlanningMessage[]>([]);
  const profileRef = useRef(profile);
  // Generation epoch: every reset()/unmount invalidates in-flight background
  // polling, so an abandoned generate can never clear a NEWER session pointer
  // or yank the user to a trip page they already walked away from.
  const generationEpochRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationEpochRef.current += 1;
    };
  }, []);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // The pointer survives a refresh; the conversation itself is re-fetched from
  // the server only when the traveller explicitly chooses to resume.
  useEffect(() => {
    const stored = usePlanningStore.getState();
    if (stored.sessionId) {
      setResumable({ sessionId: stored.sessionId, destination: stored.destination, updatedAt: stored.updatedAt });
    }
  }, []);

  useEffect(() => {
    const query = searchParams.get("q");
    if (query) { setPrompt(query); setPromptTouched(true); }
  }, [searchParams]);

  const isBusy = busy !== "idle";
  const blockers = generateBlockersFor(profile, plannerDays);
  const rangeWarning = dateRangeWarning(profile);

  const replaceMessages = (next: PlanningMessage[]) => {
    const bounded = next.slice(-80);
    messagesRef.current = bounded;
    setMessages(bounded);
  };

  const adoptPayload = (parsed: ParsedPlanningPayload, baseProfile: PlanningProfileDraft) => {
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

  const createSession = async (promptText: string | undefined, includeProfile = false) => {
    const parsed = await requestSession(promptText, includeProfile ? profileRef.current : undefined);
    setSessionId(parsed.sessionId ?? null);
    usePlanningStore.getState().setSession({ sessionId: parsed.sessionId ?? "", destination: parsed.profile.destination });
    adoptPayload(parsed, profileRef.current);
    const initialMessages = parsed.messages.some((message) => message.role === "assistant")
      ? parsed.messages
      : [...parsed.messages, welcomeMessage(promptText ?? "", parsed.profile)];
    replaceMessages(initialMessages);
    if (!parsed.messages.length) setStreamingMessageId(null);
    return parsed;
  };

  const startConversation = async () => {
    if (busy !== "idle") return;
    setBusy("starting");
    setError("");
    try {
      // Clicking 开始对话 is an explicit choice, so the prefilled example
      // counts as intent here even when untouched.
      await createSession(prompt);
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
    // A link pasted before any destination is known would otherwise be
    // swallowed into the transcript behind a dead-end error. Keep it in the
    // composer untouched and tell the traveller exactly what to send next.
    const earlyLink = text.match(LINK_URL_PATTERN)?.[0];
    if (earlyLink && SUPPORTED_LINK_HOST.test(earlyLink) && !currentProfile.destination.trim()) {
      setError("先补充目的地，我才能核实链接里的地点：发送例如「我想去重庆玩 3 天」，然后重新粘贴链接即可。");
      return;
    }
    const userMessage: PlanningMessage = { id: `planning-user-${Date.now()}`, role: "user", content: text };
    replaceMessages([...messagesRef.current, userMessage]);
    setDraft("");
    setError("");
    setWarnings([]);
    setBusy("sending");
    setStreamingMessageId(null);
    const structuredProfile = profileDirty ? profilePatchFromDraft(currentProfile) : undefined;
    try {
      // A pasted 小红书/抖音 link: resolve it server-side into verified places
      // before the conversation continues, so the planner talks about real
      // stops and the generate step can seed them into the trip.
      let plannerText = text;
      let importedNames: string[] | undefined;
      const link = text.match(LINK_URL_PATTERN)?.[0];
      if (link && SUPPORTED_LINK_HOST.test(link)) {
        if (!currentProfile.destination.trim()) {
          throw new Error("先告诉我目的地城市（例如「我想去重庆玩 3 天」），我才能用高德核实链接里的地点");
        }
        let result: { ok?: boolean; data?: LinkImportData; error?: { message?: string } };
        try {
          const response = await fetch("/api/voyage/social/extract-link", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: link, city: currentProfile.destination || "" }),
          });
          result = await response.json() as typeof result;
        } catch {
          throw new Error("链接解析请求失败，请检查网络后重试；也可以直接把攻略正文粘贴到这里");
        }
        if (!result.ok || !result.data) {
          throw new Error(result.error?.message ?? "链接解析失败；可以直接把攻略正文粘贴到这里");
        }
        const data = result.data;
        importedNames = data.candidates.filter((candidate) => candidate.resolved && candidate.place).map((candidate) => candidate.place!.name);
        setLinkImport(data);
        // Talk about the stops, not the URL: the planner cannot fetch links.
        if (importedNames.length) {
          plannerText = `${text.replace(link, "").trim()}\n（已从${data.platformLabel}攻略链接解析出这些地点，请纳入行程：${importedNames.join("、")}）`.trim();
        }
      }
      const response = await fetch(`/api/voyage/planning/session/${encodeURIComponent(sessionId)}/message`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          message: plannerText,
          expectedRevision: revision,
          ...(structuredProfile && Object.keys(structuredProfile).length ? { profile: structuredProfile } : {}),
          ...(importedNames?.length ? { importedPlaces: importedNames } : {}),
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

  const resumePlanning = async () => {
    if (!resumable || busy !== "idle") return;
    setBusy("restoring");
    setError("");
    try {
      const response = await fetch(`/api/voyage/planning/session/${encodeURIComponent(resumable.sessionId)}`, {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      const payload = await readPayload(response);
      if (!response.ok || (isRecord(payload) && payload.ok === false)) {
        // A stale pointer (expired guest, wiped data dir) must not keep coming
        // back on every visit.
        usePlanningStore.getState().clearSession();
        setResumable(null);
        throw new Error(friendlyError(payload, response.status, "这次规划会话已失效，请重新开始对话。"));
      }
      const parsed = parsePlanningPayload(payload, profileRef.current);
      if (!parsed.sessionId) throw new Error("规划服务没有返回会话 ID，请重试。浏览器没有发送或读取任何服务凭据。");
      usePlanningStore.getState().setSession({ sessionId: parsed.sessionId, destination: parsed.profile.destination });
      setSessionId(parsed.sessionId);
      setRevision(parsed.revision ?? 1);
      adoptPayload(parsed, profileRef.current);
      // A generation left running from a previous visit keeps going server-side;
      // adopt the session and follow it to the trip page instead of offering a
      // conversation that is about to be replaced.
      const resumedData = isRecord(payload) && isRecord(payload.data) ? payload.data : {};
      const resumedSession = isRecord(resumedData.session) ? resumedData.session : {};
      if (resumedSession.status === "generating") {
        setBusy("generating");
        const epoch = ++generationEpochRef.current;
        const outcome = await followGeneration(parsed.sessionId, epoch);
        if (outcome.status === "cancelled") return;
        if (outcome.status === "completed" && outcome.tripId) return;
        if (outcome.status === "timeout") return;
        setError(outcome.reason ?? "上次生成未完成，可以修改后重新生成。");
        return;
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "会话恢复失败，请重试。");
    } finally {
      setBusy("idle");
    }
  };

  /**
   * Server-side generation runs detached (closing the tab never cancels it);
   * the session record is the handoff, so poll it until it settles.
   */
  const pollGenerationOutcome = async (pollSessionId: string, epoch: number): Promise<{ status: string; tripId?: string; reason?: string }> => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < GENERATION_POLL_TIMEOUT_MS) {
      await new Promise((resolve) => window.setTimeout(resolve, GENERATION_POLL_INTERVAL_MS));
      // reset() or unmount invalidates the epoch: stop polling and leave every
      // piece of state the user is now building alone.
      if (epoch !== generationEpochRef.current || !mountedRef.current) return { status: "cancelled" };
      let payload: unknown;
      try {
        const response = await fetch(`/api/voyage/planning/session/${encodeURIComponent(pollSessionId)}`, { headers: { accept: "application/json" }, cache: "no-store" });
        payload = await readPayload(response);
      } catch {
        continue; // transient network hiccup — the server-side work continues
      }
      if (!isRecord(payload) || !isRecord(payload.data) || !isRecord(payload.data.session)) continue;
      const session = payload.data.session;
      const status = typeof session.status === "string" ? session.status : "";
      if (status === "completed" || status === "ready") {
        return { status: "completed", tripId: typeof session.tripId === "string" ? session.tripId : undefined };
      }
      if (status === "failed") {
        return { status: "failed", reason: typeof session.fallbackReason === "string" ? session.fallbackReason : undefined };
      }
    }
    return { status: "timeout" };
  };

  /** Shared tail of both generate paths: follow the background generation to
   * the trip page. Returns the outcome so each caller can phrase its error. */
  const followGeneration = async (pollSessionId: string, epoch: number): Promise<{ status: string; tripId?: string; reason?: string }> => {
    const outcome = await pollGenerationOutcome(pollSessionId, epoch);
    if (outcome.status === "cancelled") return outcome;
    if (outcome.status === "completed" && outcome.tripId) {
      // The session has served its purpose once the trip exists; keeping the
      // pointer would only offer a stale, already-generated conversation.
      // The toast is also the audible announcement for screen readers —
      // client-side navigation itself is silent.
      toast.success("生成完成，正在打开行程…");
      usePlanningStore.getState().clearSession();
      setResumable(null);
      await new Promise((resolve) => window.setTimeout(resolve, 220));
      router.push(`/trip/${encodeURIComponent(outcome.tripId)}`);
    }
    return outcome;
  };

  const generateRoute = async (sessionOverride?: ParsedPlanningPayload) => {
    if (busy !== "idle" && !sessionOverride) return;
    const blockers = generateBlockersFor(profileRef.current, sessionOverride?.days ?? plannerDays);
    if (blockers.length) {
      setError(`生成路线图前还需要确认：${blockers.join("、")}。只填天数不够，出发日期必须有真实日期。`);
      return;
    }
    setBusy("generating");
    setError("");
    setWarnings([]);
    const epoch = ++generationEpochRef.current;
    let payload: unknown;
    let currentSessionId = sessionOverride?.sessionId ?? sessionId;
    let currentRevision = sessionOverride?.revision ?? revision;
    try {
      if (!currentSessionId) {
        // Direct generate: the profile panel already holds every required
        // constraint, so the session is created transparently. The composer
        // text joins only when the traveller actually typed something — the
        // untouched example's city/date must not override the form fields.
        const created = await createSession(promptTouched ? prompt : undefined, true);
        if (!created.sessionId) throw new Error("规划服务没有返回会话 ID，请重试。浏览器没有发送或读取任何服务凭据。");
        currentSessionId = created.sessionId;
        currentRevision = created.revision ?? 1;
        setRevision(currentRevision);
      }
      const expectedRevision = sessionOverride ? currentRevision : await syncProfileBeforeGenerate(currentSessionId, currentRevision);
      const response = await fetch(`/api/voyage/planning/session/${encodeURIComponent(currentSessionId)}/generate`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        cache: "no-store",
        body: JSON.stringify({ expectedRevision, confirmed: true }),
      });
      payload = await readPayload(response);
      if (!response.ok || (isRecord(payload) && payload.ok === false)) throw new Error(friendlyError(payload, response.status, "路线生成失败，请检查信息后重试。"));

      const outcome = await followGeneration(currentSessionId, epoch);
      if (outcome.status === "cancelled") return;
      if (outcome.status === "timeout") {
        setBusy("idle");
        setWarnings(["生成仍在后台进行，行程完成后会自动出现在「我的旅行」；留在本页也可以继续等待。"]);
        return;
      }
      if (outcome.status === "failed" || !outcome.tripId) {
        setBusy("idle");
        setError(outcome.reason ?? "生成失败，会话与偏好都已保留，修改后可直接再点一次「生成路线图」。");
        const details = errorDetails(payload);
        const resynced = await resyncRevision(currentSessionId, details.revision);
        if (resynced !== undefined) setWarnings(["可以在修改信息后直接再点一次「生成路线图」，这次会话和偏好都不会丢失。"]);
        return;
      }
      return;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "路线生成失败，请稍后重试。");
      setBusy("idle");
    }
    // Keep the session retryable: adopt the revision the server actually holds.
    if (currentSessionId) {
      const details = errorDetails(payload);
      const resynced = await resyncRevision(currentSessionId, details.revision);
      if (resynced !== undefined) setWarnings(["可以在修改信息后直接再点一次「生成路线图」，这次会话和偏好都不会丢失。"]);
    }
  };

  /**
   * Removing a mis-parsed entry (extraction noise) rewrites the session's
   * imported list exactly — a list edit, not a conversation turn.
   */
  const removeImportedPlace = (name: string) => {
    if (!linkImport || !sessionId) return;
    const remaining = linkImport.candidates.filter((candidate) => (candidate.place?.name ?? candidate.name) !== name);
    setLinkImport({ ...linkImport, candidates: remaining, resolvedCount: remaining.filter((candidate) => candidate.resolved).length });
    const names = remaining.filter((candidate) => candidate.resolved).map((candidate) => candidate.place?.name ?? candidate.name);
    void fetch(`/api/voyage/planning/session/${encodeURIComponent(sessionId)}/imported-places`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ places: names, expectedRevision: revision }),
    })
      .then(async (response) => {
        const payload = await response.json() as { ok?: boolean; data?: { revision?: number }; error?: { message?: string } };
        if (!response.ok || !payload.ok) throw new Error(payload.error?.message ?? "更新导入列表失败");
        if (payload.data?.revision !== undefined) setRevision(payload.data.revision);
        toast.success(`已移除「${name}」，生成时不会再排入`);
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "更新导入列表失败，请刷新重试"));
  };

  const reset = () => {
    // Invalidate any in-flight generation polling before touching state, so
    // the abandoned poll can never clobber the fresh session below.
    generationEpochRef.current += 1;
    const fresh = createDefaultProfile();
    setSessionId(null);
    setLinkImport(null);
    usePlanningStore.getState().clearSession();
    setResumable(null);
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
    setProfileDirty(false);
    setProfile(fresh);
    profileRef.current = fresh;
  };

  return (
    <main className="relative min-h-dvh overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(circle_at_15%_0%,rgba(15,118,110,0.12),transparent_32%),radial-gradient(circle_at_90%_5%,rgba(194,65,12,0.08),transparent_26%)]" />
      <div className="relative mx-auto max-w-6xl px-4 pb-12 pt-5 sm:px-6 sm:pt-7 lg:px-8">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5" aria-label="返回首页">
            <span className="grid size-9 place-items-center rounded-xl bg-foreground text-background"><Compass className="size-4" /></span>
            <div><p className="text-[13px] font-semibold tracking-tight">{brand.name}</p><p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{brand.product}</p></div>
          </Link>
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <Link href="/trips" className="px-1 transition-colors hover:text-foreground">我的旅行</Link>
            <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-primary" />服务端规划 · 凭据不下发</span>
          </div>
        </header>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-7">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {sessionId ? (
                <button type="button" onClick={reset} className="grid size-9 place-items-center rounded-xl border border-border bg-surface text-muted-foreground transition-colors hover:bg-secondary" aria-label="重新开始"><RotateCcw className="size-4" /></button>
              ) : null}
              <div><p className="text-[10px] uppercase tracking-[0.16em] text-primary">Planning session</p><h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">一起把这趟旅行定下来</h1></div>
            </div>
            <div className="flex items-center gap-2">
              {sessionId ? <span className="hidden rounded-full border border-border bg-surface px-2.5 py-1 text-[10px] text-muted-foreground sm:inline-flex">版本 {revision}</span> : null}
              <PlanningStatusCard status={llmStatus} compact />
            </div>
          </div>
          {warnings.length ? <div className="mb-4 rounded-[14px] border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2 text-xs text-amber-900 dark:text-amber-100">{warnings.map((warning) => <p key={warning}>{warning}</p>)}</div> : null}
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
            <div className="min-w-0">
              {!sessionId ? (
                <>
                  {resumable ? (
                    <div className="mb-3 flex items-center justify-between gap-3 rounded-[18px] border border-primary/25 bg-accent/60 px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-foreground">继续上次规划{resumable.destination ? ` · ${resumable.destination}` : ""}</p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">会话保存在服务端；继续会接上之前的对话和画像，刷新也不会再丢失。</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Button size="sm" variant="ghost" disabled={isBusy} onClick={() => { usePlanningStore.getState().clearSession(); setResumable(null); }}>开新的</Button>
                        <Button size="sm" onClick={() => void resumePlanning()} disabled={isBusy}>
                          {busy === "restoring" ? <LoaderCircle className="animate-spin" /> : <RotateCcw className="size-3.5" />}继续
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  <div className="rounded-[24px] border border-border bg-surface p-4 shadow-[0_22px_70px_rgba(28,25,23,0.08)] sm:p-5">
                    <div className="flex items-start justify-between gap-3"><div><p className="text-[11px] font-medium uppercase tracking-[0.16em] text-primary">Start here</p><h2 className="mt-2 text-xl font-semibold tracking-tight">先说说这趟旅行</h2></div><Sparkles className="mt-1 size-5 text-primary" /></div>
                    <Textarea value={prompt} onChange={(event) => { setPromptTouched(true); setPrompt(event.target.value); }} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void startConversation(); }} className="mt-5 min-h-32 resize-none border-border/80 bg-background/60 px-3.5 py-3 text-[14px] leading-6 shadow-none focus-visible:ring-primary/20" placeholder="告诉我你想去哪里、玩几天、和谁一起……也可以直接粘贴小红书/抖音攻略链接" aria-label="旅行初始想法" />
                    {searchParams.get("q") ? <p className="mt-2 text-[11px] text-primary">已带入首页的旅行描述，可以继续修改。</p> : null}
                    <div className="mt-4"><p className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">灵感提示</p><div className="flex flex-wrap gap-1.5">{QUICK_PROMPTS.map((item) => <button key={item} type="button" onClick={() => { setPromptTouched(true); setPrompt(item); }} className="rounded-full border border-border bg-background px-2.5 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:border-primary/30 hover:bg-accent hover:text-accent-foreground">{item}</button>)}</div></div>
                    <div className="mt-5 flex flex-col-reverse gap-2 border-t border-border/80 pt-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-[10px] leading-4 text-muted-foreground">Enter 不会直接生成<br />你可以在对话里慢慢补充</p><Button size="lg" onClick={() => void startConversation()} disabled={isBusy}>{busy === "starting" ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}开始对话</Button></div>
                  </div>
                  {error ? <div role="alert" className="mt-3 flex items-start gap-2 rounded-[14px] border border-rose-500/25 bg-rose-500/[0.06] px-3 py-2.5 text-xs text-rose-800"><CircleAlert className="mt-0.5 size-4 shrink-0" /><span>{error}</span>{error.includes("设置页") ? <Link href="/settings" className="ml-auto shrink-0 self-center font-medium text-primary underline underline-offset-2">前往设置</Link> : null}</div> : null}
                </>
              ) : (
                <>
                  {linkImport ? (
                    <div className="mb-3 rounded-[16px] border border-primary/25 bg-accent/50 p-3.5" aria-live="polite">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[11px] font-medium text-primary">
                            已从{linkImport.platformLabel}链接解析 · 高德已核实 {linkImport.resolvedCount} 个地点
                          </p>
                          <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{linkImport.title}</p>
                        </div>
                        <button type="button" onClick={() => setLinkImport(null)} className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground">收起</button>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {linkImport.candidates.map((candidate) => (
                          <button
                            key={candidate.name}
                            type="button"
                            onClick={() => removeImportedPlace(candidate.place?.name ?? candidate.name)}
                            className={candidate.resolved
                              ? "group rounded-full border border-primary/25 bg-surface px-2.5 py-1 text-[11px] text-foreground transition-colors hover:border-rose-400/60 hover:text-rose-700"
                              : "rounded-full border border-dashed border-border px-2.5 py-1 text-[11px] text-muted-foreground line-through"}
                            title={candidate.resolved ? `高德核实：${candidate.place?.name ?? candidate.name}（点击移除）` : "未在高德找到，不会被编造"}
                          >
                            {candidate.resolved ? candidate.place?.name ?? candidate.name : `${candidate.name}（未找到）`}
                            {candidate.resolved ? <span className="ml-1 opacity-0 transition-opacity group-hover:opacity-100">×</span> : null}
                          </button>
                        ))}
                      </div>
                      <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
                        生成路线时会把这些地点按链接顺序排进每天并画到地图上；点选可移除识别错误的地点，找不到的地点不会被编造。
                      </p>
                    </div>
                  ) : null}
                  <PlanningChat messages={messages} suggestedReplies={suggestedReplies} draft={draft} onDraftChange={setDraft} onSend={(message) => void sendMessage(message)} disabled={busy === "sending" || busy === "generating"} isTyping={busy === "sending"} streamingMessageId={streamingMessageId} />
                  {error ? <div role="alert" className="mt-3 flex items-start gap-2 rounded-[14px] border border-rose-500/25 bg-rose-500/[0.06] px-3 py-2.5 text-xs text-rose-800"><CircleAlert className="mt-0.5 size-4 shrink-0" /><span>{error}</span>{error.includes("设置页") ? <Link href="/settings" className="ml-auto shrink-0 self-center font-medium text-primary underline underline-offset-2">前往设置</Link> : null}</div> : null}
                  {busy === "generating" ? <div className="mt-4"><GenerationProgress destination={profile.destination} /></div> : null}
                </>
              )}
            </div>
            <aside className="lg:sticky lg:top-5"><PlanningProfilePanel profile={profile} onChange={updateProfile} onGenerate={() => void generateRoute()} generating={busy === "generating"} disabled={busy !== "idle"} llmStatus={llmStatus} missingFields={missingFields} blockers={blockers} days={plannerDays} rangeWarning={rangeWarning} /><div className="mt-3 rounded-[14px] border border-border bg-surface/60 p-3 text-[11px] leading-5 text-muted-foreground"><div className="flex items-center gap-2 text-foreground"><Check className="size-3.5 text-primary" /><span className="font-medium">确认后才会调用路线与供应商能力</span></div><p className="mt-1">模型只负责理解偏好；地点、路线、天气和报价会在生成阶段按 provider 来源标注。</p>{missingFields.length ? <p className="mt-2">还可以补充：{missingFields.join("、")}</p> : null}</div></aside>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-[10px] text-muted-foreground"><p>会话数据只通过当前页面的相对 API 路径传输，不包含任何 API Key。</p>{sessionId ? <button type="button" onClick={reset} className="inline-flex items-center gap-1 text-foreground hover:text-primary">重新开始 <ArrowRight className="size-3" /></button> : null}</div>
        </motion.div>
      </div>
    </main>
  );
}
