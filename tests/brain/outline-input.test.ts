// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const llm = vi.hoisted(() => ({
  getLlmConfig: vi.fn(),
  chatJson: vi.fn(),
}));

vi.mock("@/services/ai/llm", () => llm);

import { planOutline } from "@/services/planning/outline-planner";

describe("outline planner world-state input (Travel Brain 4.1)", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VOYAGE_LLM_ENABLED", "1");
    llm.getLlmConfig.mockReset();
    llm.chatJson.mockReset();
    llm.getLlmConfig.mockReturnValue({ baseUrl: "https://llm.example.com/v1/", model: "test-model" });
    llm.chatJson.mockResolvedValue({
      title: "测试行程",
      dayPlans: [{ title: "Day 1", summary: "", stops: [{ placeId: "p-1", startTime: "09:00", durationMinutes: 90 }] }],
      tasks: [],
    });
  });

  it("forwards route intel, route summary and weather summary to the model", async () => {
    await planOutline({
      prompt: "两天重庆",
      destination: "重庆",
      candidates: [{
        id: "p-1",
        name: "洪崖洞",
        category: "attraction",
        lat: 29.5627,
        lng: 106.5791,
        rating: 4.6,
        reviewCount: 10,
        image: "",
        priceLevel: 0,
        address: "渝中区",
        openingStatus: "unknown",
        stayMinutes: 90,
        description: "山城夜景",
        tags: [],
        district: "渝中区",
        openingHours: "09:00-23:00",
        estimatedCost: 0,
      }],
      startDate: "2030-05-01",
      endDate: "2030-05-01",
      budget: 2500,
      travelers: 2,
      vibes: [],
      candidateIntel: { "p-1": "最近：长江索道 1.2km/13min[实测]" },
      routeSummary: "路线情报（[实测]=高德路线，[估算]=直线距离推算；排同一天的地点应尽量相邻）：\n洪崖洞 最近：长江索道 1.2km/13min[实测]",
      weatherSummary: "2030-05-01 多云 24°C；2030-05-02 中雨 21°C [有雨]",
    });

    expect(llm.chatJson).toHaveBeenCalledTimes(1);
    const call = llm.chatJson.mock.calls[0][0] as { messages: Array<{ role: string; content: string }> };
    const userMessage = call.messages.find((message) => message.role === "user")!.content;
    // Candidate lines now carry scheduling-relevant facts, not just names.
    expect(userMessage).toContain("营业:09:00-23:00");
    expect(userMessage).toContain("建议停留:90分");
    expect(userMessage).toContain("估价:¥0/人");
    expect(userMessage).toContain("评分:4.6");
    expect(userMessage).toContain("最近：长江索道 1.2km/13min[实测]");
    expect(userMessage).toContain("路线情报");
    expect(userMessage).toContain("2030-05-02 中雨 21°C [有雨]");
    // The ordering rule must tell the model to use the route intel.
    const systemMessage = call.messages.find((message) => message.role === "system")!.content;
    expect(systemMessage).toContain("路线情报");
  });

  it("stays backward compatible without the brain fields", async () => {
    await planOutline({
      prompt: "一天重庆",
      destination: "重庆",
      candidates: [{
        id: "p-1",
        name: "洪崖洞",
        category: "attraction",
        lat: 29.5627,
        lng: 106.5791,
        rating: 4.6,
        reviewCount: 10,
        image: "",
        priceLevel: 0,
        address: "渝中区",
        openingStatus: "unknown",
        stayMinutes: 90,
        description: "山城夜景",
        tags: [],
        district: "渝中区",
      }],
      startDate: "2030-05-01",
      endDate: "2030-05-01",
      budget: 2500,
      travelers: 2,
      vibes: [],
    });

    const call = llm.chatJson.mock.calls[0][0] as { messages: Array<{ role: string; content: string }> };
    const userMessage = call.messages.find((message) => message.role === "user")!.content;
    expect(userMessage).toContain("营业:未知");
    expect(userMessage).not.toContain("路线情报");
    expect(userMessage).not.toContain("行程期间天气");
  });
});
