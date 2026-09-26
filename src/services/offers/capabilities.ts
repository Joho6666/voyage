import { getFliggyTopConfig } from "@/services/booking/fliggy-top";
import { runtimeConfigSync } from "@/services/config/local-credentials";

export type CapabilityProvider = "amap" | "meituan" | "fliggy" | "official-link";
export type CapabilityStatus = "AVAILABLE" | "NOT_CONFIGURED" | "PERMISSION_REQUIRED" | "UNAVAILABLE";
export type CapabilityKind = "weather" | "poi" | "route" | "hotel" | "flight" | "train" | "ticket" | "restaurant";
export type CapabilityEvidence = "structured" | "structured-or-text" | "route" | "official-link";

export interface ProviderCapability {
  provider: CapabilityProvider;
  capability: CapabilityKind;
  status: CapabilityStatus;
  message: string;
  evidence?: CapabilityEvidence;
  homepageUrl?: string;
  actionLabel?: string;
}

export function getProviderCapabilities(env: NodeJS.ProcessEnv = process.env): ProviderCapability[] {
  const source = env === process.env ? { ...env, AMAP_SERVER_KEY: runtimeConfigSync("AMAP_SERVER_KEY"), MEITUAN_HT_TOKEN: runtimeConfigSync("MEITUAN_HT_TOKEN") } : env;
  const amapConfigured = Boolean(source.AMAP_SERVER_KEY?.trim());
  const meituanConfigured = Boolean(source.MEITUAN_HT_TOKEN?.trim());
  const fliggyConfigured = Boolean(getFliggyTopConfig(env));
  const capabilities: ProviderCapability[] = [
    ...(["weather", "poi"] as const).map((capability) => ({
      provider: "amap" as const,
      capability,
      status: amapConfigured ? "AVAILABLE" as const : "NOT_CONFIGURED" as const,
      message: amapConfigured ? "高德服务端 Key 已配置" : "未配置 AMAP_SERVER_KEY",
    })),
    {
      provider: "amap",
      capability: "route",
      status: amapConfigured ? "AVAILABLE" : "NOT_CONFIGURED",
      evidence: "route",
      message: amapConfigured
        ? "高德路线能力已配置；市内结果会区分实时路线与估算"
        : "未配置 AMAP_SERVER_KEY；市内交通可退化为估算，不代表实时路线",
    },
    {
      provider: "meituan",
      capability: "ticket",
      status: meituanConfigured ? "AVAILABLE" : "NOT_CONFIGURED",
      evidence: "structured-or-text",
      message: meituanConfigured ? "美团 Travel Skill Token 已配置，结果可能是结构化或文本" : "未配置 MEITUAN_HT_TOKEN",
    },
    {
      provider: "meituan",
      capability: "train",
      status: meituanConfigured ? "AVAILABLE" : "NOT_CONFIGURED",
      evidence: "structured-or-text",
      message: meituanConfigured
        ? "可返回结构化或文本交通结果，但没有专用铁路实时库存 provider；余票只有在结果明确返回时才显示"
        : "未配置 MEITUAN_HT_TOKEN；没有专用铁路实时库存 provider，仅可打开 12306 官网首页核实",
    },
    {
      provider: "meituan",
      capability: "flight",
      status: meituanConfigured ? "AVAILABLE" : "NOT_CONFIGURED",
      evidence: "structured-or-text",
      message: meituanConfigured
        ? "可返回结构化或文本航班结果，不等同于 Voyage 持有实时库存"
        : "未配置 MEITUAN_HT_TOKEN；无法通过美团查询航班结果",
    },
    {
      provider: "meituan",
      capability: "restaurant",
      status: meituanConfigured ? "AVAILABLE" : "NOT_CONFIGURED",
      evidence: "structured-or-text",
      message: meituanConfigured ? "可尝试查询美食和优惠" : "未配置 MEITUAN_HT_TOKEN",
    },
    {
      provider: "fliggy",
      capability: "hotel",
      status: fliggyConfigured ? "AVAILABLE" : "NOT_CONFIGURED",
      evidence: "structured",
      message: fliggyConfigured ? "已配置 TOP 凭据；酒店结果仍取决于飞猪分销权限" : "未配置飞猪 TOP 凭据；无法通过飞猪查询酒店",
    },
    {
      provider: "fliggy",
      capability: "flight",
      status: fliggyConfigured ? "AVAILABLE" : "NOT_CONFIGURED",
      evidence: "structured",
      message: fliggyConfigured ? "已配置 TOP 凭据；航班接口仍可能因权限不足不可用" : "未配置飞猪 TOP 凭据；无法通过飞猪航班接口查询",
    },
  ];
  for (const capability of ["hotel", "flight", "train"] as const) capabilities.push({
    provider: "official-link",
    capability,
    status: "AVAILABLE",
    evidence: "official-link",
    homepageUrl: capability === "train"
      ? "https://www.12306.cn/index/"
      : capability === "flight" ? "https://flights.ctrip.com/" : "https://hotels.ctrip.com/",
    actionLabel: capability === "train"
      ? "打开 12306 官网首页"
      : capability === "flight" ? "打开航班平台首页" : "打开酒店平台首页",
    message: capability === "train"
      ? "仅提供 12306 官网首页核实入口；不会带入出发地、日期或车次，不代表实时库存"
      : capability === "flight"
        ? "仅提供航班平台首页核实入口；不会带入出发地、日期或航班条件，不代表实时库存"
        : "仅提供酒店平台首页核实入口；不会带入日期或住客条件，不代表实时库存",
  });
  return capabilities;
}
