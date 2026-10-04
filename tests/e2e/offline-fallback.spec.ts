import { test, expect } from "@playwright/test";

// The trip layout falls back to the cached offline package when the network
// fails. This exercises the layout's JS-level fallback; the service worker is
// blocked so Playwright's route interception actually sees the failed fetch
// (SW-initiated requests bypass page routes).
test.use({ serviceWorkers: "block" });

test.describe("offline fallback", () => {
  test("layout falls back to the cached trip when get-trip fails", async ({ page }) => {
    await page.goto("/trip/chongqing-2026");
    await page.waitForTimeout(3000);

    // Seed the offline cache exactly as OfflineJourneyCache.cacheTrip does
    await page.evaluate(async () => {
      const cache = await caches.open("voyage-journey-offline-v1");
      const response = await fetch("/api/voyage/command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command: "get-trip", input: { tripId: "chongqing-2026" } }),
      });
      const payload = await response.json();
      await cache.put(
        "/offline-trip-chongqing-2026",
        new Response(JSON.stringify({ trip: payload.data.trip, cachedAt: Date.now(), version: "1.0" })),
      );
    });

    // Break the network for the API
    await page.route("**/api/voyage/**", (route) => route.abort("failed"));
    await page.goto("/trip/chongqing-2026");
    await page.waitForTimeout(3000);

    const body = await page.locator("body").innerText();
    expect(body).toContain("离线模式");
    expect(body).toContain("重庆");
    expect(page.url()).toContain("/trip/chongqing-2026");
  });
});