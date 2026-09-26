"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Hotel, Plane, Tag, Ticket, TrainFront, Utensils, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTripStore } from "@/store/trip-store";
import type { OfferKind, TravelOffer } from "@/types/offers";
import { TravelImage } from "@/components/travel/TravelImage";
import type {
  CapabilityEvidence,
  CapabilityStatus,
  ProviderCapability,
} from "@/services/offers/capabilities";
import type { OfferProviderLevel, OfferProviderStatus } from "@/types/offers";

const groups: Array<{ kind: OfferKind; label: string; icon: typeof Hotel }> = [
  { kind: "hotel", label: "酒店", icon: Hotel }, { kind: "train", label: "高铁", icon: TrainFront },
  { kind: "flight", label: "机票", icon: Plane }, { kind: "ticket", label: "门票", icon: Ticket },
  { kind: "restaurant", label: "美食", icon: Utensils }, { kind: "coupon", label: "优惠", icon: Tag },
];

export type TransportCapabilityKey = "train" | "flight" | "urban";
type CapabilityTone = "positive" | "warning" | "muted" | "negative";

export interface TransportCapabilityRow {
  key: TransportCapabilityKey;
  title: string;
  sourceLabel: string;
  resultLabel: string;
  description: string;
  note: string;
  tone: CapabilityTone;
}

export interface VerificationEntry extends ProviderCapability {
  evidence: "official-link";
  homepageUrl: string;
  actionLabel: string;
}

const RESULT_LABEL: Record<OfferProviderLevel, { label: string; tone: CapabilityTone }> = {
  REAL: { label: "结构化报价", tone: "positive" },
  UNSTRUCTURED: { label: "文本提取", tone: "warning" },
  ESTIMATED: { label: "估算参考", tone: "warning" },
  PERMISSION_REQUIRED: { label: "权限不足", tone: "negative" },
  UNAVAILABLE: { label: "无结果", tone: "muted" },
  UNKNOWN: { label: "尚未查询", tone: "muted" },
};

function capabilityFor(
  capabilities: ProviderCapability[],
  provider: ProviderCapability["provider"],
  capability: ProviderCapability["capability"],
) {
  return capabilities.find((item) => item.provider === provider && item.capability === capability);
}

function capabilityConfigured(status?: CapabilityStatus) {
  return status === "AVAILABLE";
}

function trainDescription(configured: boolean, level: OfferProviderLevel) {
  if (!configured) {
    return level === "UNKNOWN" || level === "UNAVAILABLE"
      ? "美团未配置，当前没有可刷新铁路报价的 provider。"
      : `美团当前未配置；已保存的${RESULT_LABEL[level].label}不代表当前仍可查询。`;
  }
  if (level === "REAL") return "美团本次返回结构化交通报价；只有明确的余票字段才是供应商库存声明。";
  if (level === "UNSTRUCTURED") return "美团本次只返回文本结果；字段为保守提取，不能当作实时余票。";
  if (level === "PERMISSION_REQUIRED") return "美团查询权限不足，本次没有可核实的铁路报价。";
  if (level === "UNAVAILABLE") return "美团已配置，但本次没有获得可展示的铁路结果。";
  if (level === "ESTIMATED") return "当前只有估算参考，不是供应商报价或库存。";
  return "美团查询已配置，尚未取得本次铁路结果。";
}

function flightDescription(configured: boolean, level: OfferProviderLevel) {
  if (!configured) {
    if (level === "REAL" || level === "UNSTRUCTURED") {
      return `飞猪未配置；本次${RESULT_LABEL[level].label}来自其他 provider，来源请查看结果卡。`;
    }
    if (level === "PERMISSION_REQUIRED") {
      return "飞猪当前未配置；最近一次查询记录为鉴权或航班接口权限不足。";
    }
    return "未配置飞猪 TOP 凭据，无法发起飞猪航班报价查询。";
  }
  if (level === "PERMISSION_REQUIRED") return "飞猪凭据已配置，但本次鉴权或航班接口权限不足。";
  if (level === "REAL") return "本次有结构化航班报价；具体来源与库存声明请查看结果卡。";
  if (level === "UNSTRUCTURED") return "本次只有文本提取结果；可作参考，不能当作实时库存。";
  if (level === "UNAVAILABLE") return "飞猪已配置，但本次没有获得可展示的航班报价。";
  if (level === "ESTIMATED") return "当前只有估算参考，不是航班供应商报价或库存。";
  return "飞猪凭据已配置；接口权限与结果需以实际查询响应为准。";
}

export function buildTransportCapabilityRows(
  capabilities: ProviderCapability[],
  offerStatus?: OfferProviderStatus,
): TransportCapabilityRow[] {
  const meituanTrain = capabilityFor(capabilities, "meituan", "train");
  const fliggyFlight = capabilityFor(capabilities, "fliggy", "flight");
  const amapRoute = capabilityFor(capabilities, "amap", "route");
  const trainLevel = offerStatus?.train ?? "UNKNOWN";
  const flightLevel = offerStatus?.flight ?? "UNKNOWN";
  const trainResult = RESULT_LABEL[trainLevel];
  const flightResult = RESULT_LABEL[flightLevel];
  const trainConfigured = capabilityConfigured(meituanTrain?.status);
  const flightConfigured = capabilityConfigured(fliggyFlight?.status);
  const routeConfigured = capabilityConfigured(amapRoute?.status);

  return [
    {
      key: "train",
      title: "铁路 / 高铁",
      sourceLabel: trainConfigured ? "美团查询已配置" : "美团未配置",
      resultLabel: trainResult.label,
      description: trainDescription(trainConfigured, trainLevel),
      note: "无专用铁路实时库存 provider。结构化报价和文本提取都必须到 12306 核实。",
      tone: trainResult.tone,
    },
    {
      key: "flight",
      title: "飞机",
      sourceLabel: flightLevel === "PERMISSION_REQUIRED"
        ? "飞猪权限不足"
        : flightConfigured ? "飞猪凭据已配置" : "飞猪未配置",
      resultLabel: flightResult.label,
      description: flightDescription(flightConfigured, flightLevel),
      note: "结构化报价与文本提取均不自动代表实时库存；未返回库存字段时不能推断有票。",
      tone: flightResult.tone,
    },
    {
      key: "urban",
      title: "市内交通",
      sourceLabel: routeConfigured ? "高德路线已配置" : "高德路线未配置",
      resultLabel: routeConfigured ? "实时路线能力" : "仅估算回退",
      description: routeConfigured
        ? "可请求高德路线、耗时与步骤；费用仍按结果字段标注为实时或估算。"
        : "智能对比会明确标注 haversine / 估算结果，不会把估算写成实时路线。",
      note: "市内路线能力用于交通方案对比，不属于票务报价或库存。",
      tone: routeConfigured ? "positive" : "warning",
    },
  ];
}

const DEFAULT_VERIFICATION_ENTRIES: Record<Extract<OfferKind, "hotel" | "flight" | "train">, VerificationEntry> = {
  train: {
    provider: "official-link",
    capability: "train",
    status: "AVAILABLE",
    evidence: "official-link",
    homepageUrl: "https://www.12306.cn/index/",
    actionLabel: "打开 12306 官网首页",
    message: "只打开 12306 官网首页，不带查询参数；请手动填写条件核实，不代表实时库存。",
  },
  flight: {
    provider: "official-link",
    capability: "flight",
    status: "AVAILABLE",
    evidence: "official-link",
    homepageUrl: "https://flights.ctrip.com/",
    actionLabel: "打开航班平台首页",
    message: "只打开航班平台首页，不带查询参数；请手动填写条件核实，不代表实时库存。",
  },
  hotel: {
    provider: "official-link",
    capability: "hotel",
    status: "AVAILABLE",
    evidence: "official-link",
    homepageUrl: "https://hotels.ctrip.com/",
    actionLabel: "打开酒店平台首页",
    message: "只打开酒店平台首页，不带查询参数；请手动填写条件核实，不代表实时库存。",
  },
};

export function getVerificationEntries(
  capabilities: ProviderCapability[],
  kinds: Array<Extract<OfferKind, "hotel" | "flight" | "train">>,
): VerificationEntry[] {
  return kinds.map((kind) => {
    const entry = capabilityFor(capabilities, "official-link", kind);
    return entry?.evidence === "official-link" && entry.homepageUrl && entry.actionLabel
      ? { ...DEFAULT_VERIFICATION_ENTRIES[kind], ...entry, evidence: "official-link" as const, homepageUrl: entry.homepageUrl, actionLabel: entry.actionLabel }
      : DEFAULT_VERIFICATION_ENTRIES[kind];
  });
}

export function useProviderCapabilities() {
  const [capabilities, setCapabilities] = useState<ProviderCapability[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void fetch("/api/voyage/capabilities", { signal: controller.signal, cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("能力状态接口不可用");
        return response.json();
      })
      .then((result: { capabilities?: ProviderCapability[] }) => {
        if (active) setCapabilities(result.capabilities ?? []);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        if (active) setError(cause instanceof Error ? cause.message : "能力状态接口不可用");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  return { capabilities, loading, error };
}

export function getOfferEvidenceLabel(offer: Pick<TravelOffer, "structured">) {
  return offer.structured ? "结构化报价" : "文本提取";
}

export function getOfferPriceDescriptor(offer: Pick<TravelOffer, "structured" | "priceLabel">) {
  if (!offer.priceLabel) return "价格未提供";
  return offer.structured ? "报价（需核实）" : "文本中提取的参考价";
}

export function getOfferInventoryLabel(offer: Pick<TravelOffer, "availability" | "inventoryLabel"> & { structured?: boolean }) {
  if (offer.structured === false) {
    if (offer.inventoryLabel) return `文本提取：${offer.inventoryLabel}（需核实）`;
    if (offer.availability === "available") return "文本提取显示可售（需核实）";
    if (offer.availability === "unavailable") return "文本提取显示不可售（需核实）";
    return "文本未明确库存，不代表有票";
  }
  if (offer.inventoryLabel) return offer.inventoryLabel;
  if (offer.availability === "available") return "供应商明确显示可售";
  if (offer.availability === "unavailable") return "供应商明确显示不可售";
  return "库存未明确，不代表有票";
}

export function getOfferVerificationLabel(offer: Pick<TravelOffer, "bookingUrl" | "kind" | "structured">) {
  if (offer.bookingUrl) return offer.structured ? "打开供应商核实" : "打开来源核实";
  if (offer.kind === "train") return "打开 12306 官网首页";
  if (offer.kind === "flight") return "打开航班平台首页";
  return "暂无直达入口";
}

function evidenceLabel(evidence?: CapabilityEvidence) {
  if (evidence === "structured") return "结构化报价";
  if (evidence === "structured-or-text") return "结构化 / 文本";
  if (evidence === "route") return "路线结果";
  if (evidence === "official-link") return "官方核实入口";
  return "能力说明";
}

function providerLabel(provider: ProviderCapability["provider"]) {
  if (provider === "fliggy") return "飞猪";
  if (provider === "meituan") return "美团";
  if (provider === "amap") return "高德";
  return "官方入口";
}

function capabilityKindLabel(capability: ProviderCapability["capability"]) {
  if (capability === "hotel") return "酒店";
  if (capability === "flight") return "机票";
  if (capability === "train") return "铁路";
  if (capability === "route") return "市内交通";
  if (capability === "ticket") return "门票";
  if (capability === "restaurant") return "美食";
  if (capability === "weather") return "天气";
  return capability;
}

function capabilityStatusLabel(status: CapabilityStatus) {
  if (status === "AVAILABLE") return "已配置";
  if (status === "NOT_CONFIGURED") return "未配置";
  if (status === "PERMISSION_REQUIRED") return "权限不足";
  return "不可用";
}

function offerStatusLabel(level?: OfferProviderLevel) {
  return level ? RESULT_LABEL[level].label : "尚未查询";
}

export function CapabilityStatusPanel({
  capabilities,
  offerStatus,
}: {
  capabilities: ProviderCapability[];
  offerStatus?: OfferProviderStatus;
}) {
  if (!capabilities.length) return null;
  return (
    <section className="mt-3 rounded-xl border border-border bg-muted/20 p-3">
      <h2 className="text-xs font-semibold">数据源能力</h2>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {capabilities.filter((item) => ["hotel", "flight", "train", "ticket", "route"].includes(item.capability)).map((item) => {
          const resultLevel = item.capability === "route" ? undefined : offerStatus?.[item.capability as "hotel" | "flight" | "train" | "ticket"];
          return (
            <div key={`${item.provider}-${item.capability}`} className="text-[11px]">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium">{capabilityKindLabel(item.capability)}</span>
                <span className="text-muted-foreground">{providerLabel(item.provider)} · {capabilityStatusLabel(item.status)}</span>
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{evidenceLabel(item.evidence)}</span>
                {resultLevel ? <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${toneClass(RESULT_LABEL[resultLevel].tone)}`}>{offerStatusLabel(resultLevel)}</span> : null}
              </div>
              <p className="text-muted-foreground">{item.message}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function toneClass(tone: CapabilityTone) {
  if (tone === "positive") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (tone === "negative") return "bg-destructive/10 text-destructive";
  if (tone === "warning") return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "bg-muted text-muted-foreground";
}

export function TransportCapabilitySummary({
  capabilities,
  offerStatus,
  loading = false,
  error = "",
}: {
  capabilities: ProviderCapability[];
  offerStatus?: OfferProviderStatus;
  loading?: boolean;
  error?: string;
}) {
  if (loading) {
    return <section className="rounded-[14px] border border-border bg-muted/20 p-4 text-xs text-muted-foreground">正在读取交通能力状态…</section>;
  }
  if (error || capabilities.length === 0) {
    return <section className="rounded-[14px] border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">无法读取 provider 能力状态；当前不能确认实时数据源可用。</section>;
  }

  const rows = buildTransportCapabilityRows(capabilities, offerStatus);
  return (
    <section className="rounded-[14px] border border-border bg-surface p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">当前交通能力状态</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">配置能力与最近一次查询结果分开显示；参考信息不等于实时库存。</p>
        </div>
        {offerStatus?.fetchedAt ? <p className="text-[10px] text-muted-foreground">最近查询 {new Date(offerStatus.fetchedAt).toLocaleString("zh-CN")}</p> : null}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {rows.map((row) => (
          <article key={row.key} data-testid={`transport-capability-${row.key}`} className="rounded-xl border border-border bg-muted/20 p-3">
            <h3 className="text-xs font-semibold">{row.title}</h3>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
              <span className="rounded-full bg-muted px-2 py-1 text-muted-foreground">{row.sourceLabel}</span>
              <span className={`rounded-full px-2 py-1 ${toneClass(row.tone)}`}>{row.resultLabel}</span>
            </div>
            <p className="mt-2 text-[11px] leading-4 text-foreground/80">{row.description}</p>
            <p className="mt-2 text-[10px] leading-4 text-muted-foreground">{row.note}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function OfferCard({ offer }: { offer: TravelOffer }) {
  return (
    <article className="rounded-[16px] border border-border bg-surface p-4 shadow-xs">
      {offer.imageUrl ? <TravelImage src={offer.imageUrl} alt={offer.title} className="mb-3 h-40 w-full rounded-lg object-cover" /> : null}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="outline" className="text-[10px]">{offer.provider === "fliggy" ? "飞猪" : offer.provider === "amap" ? "高德" : "美团"}</Badge>
            <span className="text-[10px] text-muted-foreground">{getOfferEvidenceLabel(offer)}</span>
          </div>
          <h3 className="text-[14px] font-semibold">{offer.title}</h3>
        </div>
        {offer.priceLabel ? <span className="shrink-0 text-sm font-semibold">{offer.priceLabel}</span> : null}
      </div>
      {offer.description ? <p className="mt-2 text-[12px] text-muted-foreground">{offer.description}</p> : null}
      {offer.departureTime || offer.arrivalTime ? <p className="mt-2 text-[12px] text-muted-foreground">{offer.departureTime ?? "出发时间未知"} → {offer.arrivalTime ?? "到达时间未知"}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
        <span>{getOfferInventoryLabel(offer)}</span>
        <span>来源 ID：{offer.sourceId ?? "未提供"}</span>
        <span>查询于 {new Date(offer.fetchedAt).toLocaleString("zh-CN")}</span>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-border/70 pt-3">
        <span className="text-[10px] text-muted-foreground">{getOfferPriceDescriptor(offer)}；库存变化请以供应商页面为准</span>
        {offer.bookingUrl ? <Button asChild size="sm"><a href={offer.bookingUrl} target="_blank" rel="noreferrer">{getOfferVerificationLabel(offer)} <ExternalLink className="ml-1 size-3" /></a></Button> : <span className="text-[10px] text-muted-foreground">{getOfferVerificationLabel(offer)}</span>}
      </div>
    </article>
  );
}

export function OfferHub() {
  const trip = useTripStore((state) => state.trip);
  const revision = useTripStore((state) => state.revision);
  const setTrip = useTripStore((state) => state.setTrip);
  const [origin, setOrigin] = useState(trip.origin);
  const [destination, setDestination] = useState(trip.destination);
  const [startDate, setStartDate] = useState(trip.startDate);
  const [endDate, setEndDate] = useState(trip.endDate);
  const [travelers, setTravelers] = useState(trip.travelers);
  const [budget, setBudget] = useState(trip.budget);
  const [categories, setCategories] = useState<OfferKind[]>(groups.map((group) => group.kind));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { capabilities, error: capabilityError } = useProviderCapabilities();
  const offers = trip.offers ?? [];
  const status = trip.offerProviderStatus;
  const verificationEntries = getVerificationEntries(capabilities, ["train", "flight", "hotel"]);

  const refresh = async () => {
    if (!categories.length) { setError("请至少选择一个查询类别"); return; }
    setError(""); setLoading(true);
    try {
      const response = await fetch("/api/voyage/command", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command: "refresh-travel-offers", input: { tripId: trip.id, expectedTripRevision: revision, origin, destination, startDate, endDate, travelers, budget, query: "查询酒店、高铁、机票、景点门票、美食和优惠", categories } }) });
      const result = await response.json() as { ok?: boolean; data?: { trip?: typeof trip; revision?: number }; error?: { code?: string; message?: string } };
      if (!result.ok || !result.data?.trip) throw new Error(result.error?.code === "REVISION_CONFLICT" ? "行程已在其他页面更新，请刷新页面后重试" : result.error?.message ?? "刷新失败");
      setTrip(result.data.trip, result.data.revision);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "刷新失败"); }
    finally { setLoading(false); }
  };

  return (
    <div className="h-full overflow-y-auto p-4 pb-24 scrollbar-thin">
      <header className="rounded-[18px] border border-border bg-gradient-to-br from-primary/10 via-surface to-surface p-5"><h1 className="text-xl font-semibold">外部实时数据中心</h1><p className="mt-1 text-[12px] text-muted-foreground">查询酒店、交通、门票、美食、优惠及天气；结果按供应商来源展示。</p></header>
      <section className="mt-4 rounded-[16px] border border-border bg-surface p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-xs">出发地<Input value={origin} onChange={(event) => setOrigin(event.target.value)} className="mt-1" /></label>
          <label className="text-xs">目的地<Input value={destination} onChange={(event) => setDestination(event.target.value)} className="mt-1" /></label>
          <label className="text-xs">开始日期<Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="mt-1" /></label>
          <label className="text-xs">结束日期<Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="mt-1" /></label>
          <label className="text-xs">人数<Input type="number" min={1} max={20} value={travelers} onChange={(event) => setTravelers(Number(event.target.value))} className="mt-1" /></label>
          <label className="text-xs">预算（元）<Input type="number" min={0} value={budget} onChange={(event) => setBudget(Number(event.target.value))} className="mt-1" /></label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">{groups.map((group) => <label key={group.kind} className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={categories.includes(group.kind)} onChange={() => setCategories((current) => current.includes(group.kind) ? current.filter((item) => item !== group.kind) : [...current, group.kind])} />{group.label}</label>)}</div>
        <Button className="mt-4" onClick={() => void refresh()} disabled={loading}><RefreshCw className={`mr-2 size-4 ${loading ? "animate-spin" : ""}`} />{loading ? "正在查询供应商…" : "刷新全部"}</Button>
        {error ? <p role="alert" className="mt-2 text-xs text-red-600">{error}</p> : null}
      </section>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{[...groups.map((group) => ({ key: group.kind, label: group.label })), { key: "weather", label: "天气" }].map(({ key, label }) => <div key={key} className="rounded-xl border border-border p-3 text-xs"><strong>{label}</strong><p className="mt-1 text-muted-foreground">{offerStatusLabel(status?.[key as OfferKind | "weather"])}</p></div>)}</div>
      {capabilityError ? <p role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">{capabilityError}；当前不能确认 provider 能力。</p> : <CapabilityStatusPanel capabilities={capabilities} offerStatus={status} />}
      {status?.warnings?.length ? <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">{status.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div> : null}
      {offers.length === 0 ? <p className="mt-5 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">暂无可验证的外部结果。点击“刷新全部”查询。</p> : null}
      <section className="mt-5">
        <h2 className="mb-2 text-sm font-semibold">外部核实入口</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {verificationEntries.map((entry) => (
            <article key={entry.capability} className="rounded-xl border border-border bg-surface p-3">
              <h3 className="text-xs font-semibold">{entry.capability === "train" ? "12306 官网首页" : entry.capability === "flight" ? "航班平台首页" : "酒店平台首页"}</h3>
              <p className="mt-1 text-[11px] text-muted-foreground">需要核对：{origin || "出发地未填"} → {destination || "目的地未填"} · {startDate || "日期未填"}{entry.capability === "hotel" ? ` 至 ${endDate || "离店日期未填"}` : ""}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{entry.message}</p>
              <Button asChild size="sm" variant="outline" className="mt-3"><a href={entry.homepageUrl} target="_blank" rel="noreferrer">{entry.actionLabel} <ExternalLink className="ml-1 size-3" /></a></Button>
            </article>
          ))}
        </div>
      </section>
      <div className="mt-5 space-y-6">{groups.map((group) => { const items = offers.filter((offer) => offer.kind === group.kind); if (!items.length) return null; const Icon = group.icon; return <section key={group.kind}><h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Icon className="size-4" />{group.label} · {items.length}</h2><div className="space-y-3">{items.map((offer) => <OfferCard key={offer.id} offer={offer} />)}</div></section>; })}</div>
    </div>
  );
}
