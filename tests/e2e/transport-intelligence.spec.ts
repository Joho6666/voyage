import { test, expect } from "@playwright/test";

test.describe("Voyage Transport Intelligence E2E", () => {
  test("get-route-options returns ranked multimodal choices", async ({ request }) => {
    const response = await request.post("/api/voyage/command", {
      data: {
        command: "get-route-options",
        input: {
          origin: { lat: 29.5647, lng: 106.5507 },
          destination: { lat: 29.5621, lng: 106.5755 },
          city: "重庆",
          fallbackPolicy: "estimated",
          context: {
            travelers: 2,
            walkingTolerance: "low",
            fatigue: "high",
            weather: "rain",
          },
        },
      },
    });

    expect(response.ok()).toBeTruthy();
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.data.routeOptions.options.length).toBeGreaterThanOrEqual(3);
    expect(payload.data.routeOptions.options[0]).toHaveProperty("score");
    expect(payload.data.routeOptions.options.map((item: { mode: string }) => item.mode))
      .toEqual(expect.arrayContaining(["walk", "metro", "bus", "taxi"]));
  });

  test("knowledge retrieval returns provenance-aware travel rules", async ({ request }) => {
    const response = await request.post("/api/voyage/command", {
      data: {
        command: "retrieve-travel-knowledge",
        input: {
          city: "重庆",
          query: "洪崖洞 夜景 人流 步行",
          tags: ["walking"],
          limit: 5,
        },
      },
    });

    expect(response.ok()).toBeTruthy();
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.data.matches.length).toBeGreaterThan(0);
    expect(payload.data.matches[0]).toHaveProperty("source");
    expect(payload.data.retrieval).toHaveProperty("strategy");
    expect(payload.data.retrieval).toHaveProperty("vectorUsed");
    expect(payload.data.retrieval).toHaveProperty("databaseUsed");
  });
});
