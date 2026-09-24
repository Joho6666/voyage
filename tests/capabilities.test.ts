import { describe, expect, it } from "vitest";
import { getProviderCapabilities } from "@/services/offers/capabilities";
import { classifyFliggyError, FliggyTopError } from "@/services/booking/fliggy-top";

describe("provider capability diagnostics", () => {
  it("reports personal-developer configuration without exposing secrets", () => {
    const capabilities = getProviderCapabilities({ AMAP_SERVER_KEY: "private-amap-key-123", MEITUAN_HT_TOKEN: "private-meituan-key-456" });
    expect(capabilities.find((item) => item.provider === "amap" && item.capability === "weather")).toMatchObject({ status: "AVAILABLE" });
    expect(capabilities.find((item) => item.provider === "meituan" && item.capability === "train")).toMatchObject({ status: "AVAILABLE" });
    expect(capabilities.find((item) => item.provider === "fliggy" && item.capability === "flight")).toMatchObject({ status: "NOT_CONFIGURED" });
    expect(JSON.stringify(capabilities)).not.toContain("private-amap-key-123");
    expect(JSON.stringify(capabilities)).not.toContain("private-meituan-key-456");
  });

  it("classifies TOP permission failures explicitly", () => {
    expect(classifyFliggyError(new FliggyTopError("permission denied", "isv.permission-denied"))).toMatchObject({ status: "PERMISSION_REQUIRED" });
    expect(classifyFliggyError(new Error("network down"))).toMatchObject({ status: "UNAVAILABLE" });
  });
});
