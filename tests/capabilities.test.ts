import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getProviderCapabilities } from "@/services/offers/capabilities";
import { classifyFliggyError, FliggyTopError } from "@/services/booking/fliggy-top";
import {
  buildTransportCapabilityRows,
  getOfferEvidenceLabel,
  getOfferInventoryLabel,
  getOfferPriceDescriptor,
  getVerificationEntries,
  TransportCapabilitySummary,
} from "@/components/travel/OfferHub";

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

  it("builds an explicit no-provider state for transport capabilities", () => {
    const capabilities = getProviderCapabilities({});
    const rows = buildTransportCapabilityRows(capabilities);

    expect(rows.find((row) => row.key === "train")).toMatchObject({
      sourceLabel: "美团未配置",
      resultLabel: "尚未查询",
    });
    expect(rows.find((row) => row.key === "train")?.note).toContain("无专用铁路实时库存 provider");
    expect(rows.find((row) => row.key === "flight")?.sourceLabel).toBe("飞猪未配置");
    expect(rows.find((row) => row.key === "urban")?.sourceLabel).toBe("高德路线未配置");
  });

  it("renders structured, text and permission states without calling them inventory", () => {
    const capabilities = getProviderCapabilities({
      AMAP_SERVER_KEY: "amap-test-key",
      MEITUAN_HT_TOKEN: "meituan-test-token",
      FLIGGY_APP_KEY: "fliggy-test-key",
      FLIGGY_APP_SECRET: "fliggy-test-secret",
    });
    const rows = buildTransportCapabilityRows(capabilities, {
      overall: "UNSTRUCTURED",
      train: "UNSTRUCTURED",
      flight: "PERMISSION_REQUIRED",
    });

    expect(rows.find((row) => row.key === "train")).toMatchObject({
      sourceLabel: "美团查询已配置",
      resultLabel: "文本提取",
    });
    expect(rows.find((row) => row.key === "train")?.description).toContain("不能当作实时余票");
    expect(rows.find((row) => row.key === "flight")).toMatchObject({
      sourceLabel: "飞猪权限不足",
      resultLabel: "权限不足",
    });

    render(createElement(TransportCapabilitySummary, {
      capabilities,
      offerStatus: { overall: "UNSTRUCTURED", train: "UNSTRUCTURED", flight: "PERMISSION_REQUIRED" },
    }));
    expect(screen.getByText("无专用铁路实时库存 provider", { exact: false })).toBeTruthy();
    expect(screen.getByText("美团本次只返回文本结果", { exact: false })).toBeTruthy();
    expect(screen.getAllByText("飞猪权限不足").length).toBeGreaterThan(0);
  });

  it("models verification links as homepage entries without fake query parameters", () => {
    const entries = getVerificationEntries(getProviderCapabilities({}), ["train", "flight"]);
    expect(entries.map((entry) => entry.actionLabel)).toEqual([
      "打开 12306 官网首页",
      "打开航班平台首页",
    ]);
    for (const entry of entries) {
      const url = new URL(entry.homepageUrl);
      expect(url.search).toBe("");
      expect(entry.message).toContain("首页");
      expect(entry.message).toContain("不代表实时库存");
    }
  });

  it("keeps quote, text and inventory evidence labels distinct", () => {
    expect(getOfferEvidenceLabel({ structured: true })).toBe("结构化报价");
    expect(getOfferEvidenceLabel({ structured: false })).toBe("文本提取");
    expect(getOfferPriceDescriptor({ structured: true, priceLabel: "¥320" })).toBe("报价（需核实）");
    expect(getOfferPriceDescriptor({ structured: false, priceLabel: "¥320" })).toBe("文本中提取的参考价");
    expect(getOfferInventoryLabel({ structured: false, availability: "unknown" })).toBe("文本未明确库存，不代表有票");
    expect(getOfferInventoryLabel({ structured: true, availability: "available" })).toBe("供应商明确显示可售");
  });
});
