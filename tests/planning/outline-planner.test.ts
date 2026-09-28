// @vitest-environment node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Place } from "@/types/travel";

const llm = vi.hoisted(() => ({
  getLlmConfig: vi.fn(),
  chatJson: vi.fn(),
}));

vi.mock("@/services/ai/llm", () => llm);

import { planOutline } from "@/services/planning/outline-planner";

describe("shared outline planner provenance", () => {
  let candidates: Place[];

  beforeEach(async () => {
    const fixture = JSON.parse(await readFile(path.resolve("tests/fixtures/voyage-provider.json"), "utf8")) as { places: Place[] };
    candidates = fixture.places;
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VOYAGE_LLM_ENABLED", "1");
    llm.getLlmConfig.mockReset();
    llm.chatJson.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function input() {
    return {
      prompt: "安排轻松的重庆夜景之旅",
      destination: "重庆",
      candidates,
      startDate: "2030-05-01",
      endDate: "2030-05-01",
      budget: 2500,
      travelers: 2,
      vibes: ["轻松", "夜景"],
    };
  }

  it("reports an explicit rules fallback when no LLM is configured", async () => {
    llm.getLlmConfig.mockReturnValue(null);

    const result = await planOutline(input());

    expect(result.source).toBe("rules");
    expect(result.llm).toBe("unavailable");
    expect(result.fallbackReason).toBe("LLM_BASE_URL 未配置");
    expect(llm.chatJson).not.toHaveBeenCalled();
    expect(result.outline.dayPlans[0].stops.every((stop) => candidates.some((place) => place.id === stop.placeId))).toBe(true);
  });

  it("reports a failed LLM call and falls back without inventing candidates", async () => {
    llm.getLlmConfig.mockReturnValue({ baseUrl: "https://llm.example.com/v1/", model: "test-model" });
    llm.chatJson.mockRejectedValue(new Error("upstream request failed"));

    const result = await planOutline(input());

    expect(result.source).toBe("rules");
    expect(result.llm).toBe("failed");
    expect(result.fallbackReason).toContain("upstream request failed");
    expect(result.outline.dayPlans[0].stops.every((stop) => candidates.some((place) => place.id === stop.placeId))).toBe(true);
  });

  it("falls back when the model invents a place id", async () => {
    llm.getLlmConfig.mockReturnValue({ baseUrl: "https://llm.example.com/v1/", model: "test-model" });
    llm.chatJson.mockResolvedValue({
      title: "重庆一日夜景",
      dayPlans: [{
        title: "山城夜景",
        summary: "模型返回了不在候选列表中的地点",
        stops: [{ placeId: "invented-place", startTime: "18:00", durationMinutes: 90 }],
      }],
      tasks: [],
    });

    const result = await planOutline(input());

    expect(result.source).toBe("rules");
    expect(result.llm).toBe("failed");
    expect(result.fallbackReason).toContain("candidate");
    expect(result.outline.dayPlans.flatMap((day) => day.stops).every((stop) => candidates.some((place) => place.id === stop.placeId))).toBe(true);
  });

  it("falls back when the model does not cover every requested day", async () => {
    llm.getLlmConfig.mockReturnValue({ baseUrl: "https://llm.example.com/v1/", model: "test-model" });
    llm.chatJson.mockResolvedValue({
      title: "重庆多日行程",
      dayPlans: [{
        title: "第一天",
        summary: "模型只返回了一天",
        stops: [{ placeId: candidates[0].id, startTime: "18:00", durationMinutes: 90 }],
      }],
      tasks: [],
    });

    const result = await planOutline({ ...input(), endDate: "2030-05-03" });

    expect(result.source).toBe("rules");
    expect(result.llm).toBe("failed");
    expect(result.fallbackReason).toContain("expected 3");
    expect(result.outline.dayPlans).toHaveLength(3);
    expect(result.outline.dayPlans.every((day) => day.stops.length > 0)).toBe(true);
  });

  it("retries once with a correction when the model miscounts the days", async () => {
    const place = candidates[0];
    llm.getLlmConfig.mockReturnValue({ baseUrl: "https://llm.example.com/v1/", model: "test-model" });
    llm.chatJson
      .mockResolvedValueOnce({
        title: "重庆多日行程",
        dayPlans: [{ title: "第一天", summary: "模型只返回了一天", stops: [{ placeId: place.id, startTime: "09:00", durationMinutes: 90 }] }],
        tasks: [],
      })
      .mockResolvedValueOnce({
        title: "重庆三日行程",
        dayPlans: [1, 2, 3].map((index) => ({
          title: `第${index}天`,
          summary: "修正后覆盖全部天数",
          stops: [{ placeId: place.id, startTime: "09:00", durationMinutes: 90 }],
        })),
        tasks: [],
      });

    const result = await planOutline({ ...input(), endDate: "2030-05-03" });

    expect(result.source).toBe("llm");
    expect(result.llm).toBe("used");
    expect(result.fallbackReason).toBeUndefined();
    expect(result.outline.dayPlans).toHaveLength(3);
    expect(llm.chatJson).toHaveBeenCalledTimes(2);
    // The correction must state the required length and the dates of record.
    const correction = JSON.stringify(llm.chatJson.mock.calls[1][0]);
    expect(correction).toContain("恰好 3 项");
    expect(correction).toContain("2030-05-03");
  });

  it("reports the day-count mismatch when the corrective retry also fails", async () => {
    const place = candidates[0];
    llm.getLlmConfig.mockReturnValue({ baseUrl: "https://llm.example.com/v1/", model: "test-model" });
    llm.chatJson.mockResolvedValue({
      title: "重庆多日行程",
      dayPlans: [{ title: "第一天", summary: "两次都只返回一天", stops: [{ placeId: place.id, startTime: "09:00", durationMinutes: 90 }] }],
      tasks: [],
    });

    const result = await planOutline({ ...input(), endDate: "2030-05-03" });

    expect(result.source).toBe("rules");
    expect(result.llm).toBe("failed");
    expect(result.fallbackReason).toContain("expected 3");
    expect(llm.chatJson).toHaveBeenCalledTimes(2);
  });

  it("records LLM use when the model returns a schema-valid candidate-only outline", async () => {
    const place = candidates[0];
    llm.getLlmConfig.mockReturnValue({ baseUrl: "https://llm.example.com/v1/", model: "test-model" });
    llm.chatJson.mockResolvedValue({
      title: "重庆一日夜景",
      dayPlans: [{
        title: "山城夜景",
        summary: "只使用供应商候选地点",
        stops: [{ placeId: place.id, startTime: "18:00", durationMinutes: 90 }],
      }],
      tasks: [],
    });

    const result = await planOutline(input());

    expect(result.source).toBe("llm");
    expect(result.llm).toBe("used");
    expect(result.fallbackReason).toBeUndefined();
    expect(result.outline.dayPlans[0].stops[0].placeId).toBe(place.id);
    expect(llm.chatJson).toHaveBeenCalledTimes(1);
  });
});
