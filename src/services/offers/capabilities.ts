import { getFliggyTopConfig } from "@/services/booking/fliggy-top";
import { runtimeConfigSync } from "@/services/config/local-credentials";

export type CapabilityProvider = "amap" | "meituan" | "fliggy" | "official-link";
export type CapabilityStatus = "AVAILABLE" | "NOT_CONFIGURED" | "PERMISSION_REQUIRED" | "UNAVAILABLE";
export type CapabilityKind = "weather" | "poi" | "route" | "hotel" | "flight" | "train" | "ticket" | "restaurant";

export interface ProviderCapability {
  provider: CapabilityProvider;
  capability: CapabilityKind;
  status: CapabilityStatus;
  message: string;
}

export function getProviderCapabilities(env: NodeJS.ProcessEnv = process.env): ProviderCapability[] {
  const source = env === process.env ? { ...env, AMAP_SERVER_KEY: runtimeConfigSync("AMAP_SERVER_KEY"), MEITUAN_HT_TOKEN: runtimeConfigSync("MEITUAN_HT_TOKEN") } : env;
  const amapConfigured = Boolean(source.AMAP_SERVER_KEY?.trim());
  const meituanConfigured = Boolean(source.MEITUAN_HT_TOKEN?.trim());
  const fliggyConfigured = Boolean(getFliggyTopConfig(env));
  const capabilities: ProviderCapability[] = [
    ...(["weather", "poi", "route"] as const).map((capability) => ({ provider: "amap" as const, capability, status: amapConfigured ? "AVAILABLE" as const : "NOT_CONFIGURED" as const, message: amapConfigured ? "高德服务端 Key 已配置" : "未配置 AMAP_SERVER_KEY" })),
    { provider: "meituan", capability: "ticket", status: meituanConfigured ? "AVAILABLE" : "NOT_CONFIGURED", message: meituanConfigured ? "美团 Travel Skill Token 已配置，实际结果仍取决于权限和响应格式" : "未配置 MEITUAN_HT_TOKEN" },
    { provider: "meituan", capability: "train", status: meituanConfigured ? "AVAILABLE" : "NOT_CONFIGURED", message: meituanConfigured ? "可尝试查询；只有供应商明确返回余票时才显示可用" : "未配置 MEITUAN_HT_TOKEN" },
    { provider: "meituan", capability: "restaurant", status: meituanConfigured ? "AVAILABLE" : "NOT_CONFIGURED", message: meituanConfigured ? "可尝试查询美食和优惠" : "未配置 MEITUAN_HT_TOKEN" },
    { provider: "fliggy", capability: "hotel", status: fliggyConfigured ? "AVAILABLE" : "NOT_CONFIGURED", message: fliggyConfigured ? "已配置 TOP 凭据；仍需飞猪酒店分销权限" : "未配置飞猪 TOP 凭据；个人开发者通常无法获批酒店分销权限" },
    { provider: "fliggy", capability: "flight", status: fliggyConfigured ? "AVAILABLE" : "NOT_CONFIGURED", message: fliggyConfigured ? "已配置 TOP 凭据；仍需飞猪航班权限" : "未配置飞猪 TOP 凭据；个人开发者通常无法获批航班权限" },
  ];
  for (const capability of ["hotel", "flight", "train"] as const) capabilities.push({ provider: "official-link", capability, status: "AVAILABLE", message: "可生成官方查询入口；不代表 Voyage 拥有实时库存" });
  return capabilities;
}
