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

  test("transport page distinguishes provider capability from real-time inventory", async ({ page }) => {
    await page.goto("/trip/chongqing-2026/transport");

    await expect(page.getByRole("heading", { name: "交通规划与出行建议" })).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("transport-capability-train")).toContainText("美团未配置");
    await expect(page.getByTestId("transport-capability-train")).toContainText("无专用铁路实时库存 provider");
    await expect(page.getByTestId("transport-capability-flight")).toContainText("飞猪未配置");
    await expect(page.getByText("官方 / 平台首页核实")).toBeVisible();

    const railLink = page.getByRole("link", { name: "打开 12306 官网首页" });
    await expect(railLink).toHaveAttribute("href", "https://www.12306.cn/index/");
    await expect(page.locator("body")).toContainText("入口不代表 Voyage 返回实时库存");
  });
});
