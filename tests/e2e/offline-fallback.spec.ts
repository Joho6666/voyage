import { test, expect } from "@playwright/test";

// Offline regression: the trip layout used to redirect to /trips on network
// failure, making the "下载行程离线包" button useless — the cache was written
// but never read. This test caches a trip, goes offline, reloads, and
// verifies the trip page renders from the cache.

test.describe("offline fallback", () => {
  test("cached trip loads when the network drops", async ({ page, context }) => {
    await page.goto("/trip/chongqing-2026");
    await page.waitForTimeout(2000);

    // Click the offline cache button in the map toolbar
    const cacheBtn = page.getByText("下载行程离线包").or(page.getByText("离线包就绪"));
    if (await cacheBtn.count() > 0) {
      await cacheBtn.first().click();
      await page.waitForTimeout(3000);
    }

    // Go offline and reload
    await context.setOffline(true);
    await page.reload();
    await page.waitForTimeout(4000);

    // Should still render the trip, not the /trips redirect
    const body = await page.locator("body").innerText();
    expect(body).toContain("重庆");
    expect(page.url()).toContain("/trip/");
    expect(body).toContain("离线模式");

    await context.setOffline(false);
  });
});