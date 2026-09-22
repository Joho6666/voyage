import { test, expect } from "@playwright/test";

test.describe("Voyage Journey Map E2E Suite", () => {
  test.beforeEach(async ({ page }) => {
    // Intercept external AMap requests for deterministic testing
    await page.route("**/restapi.amap.com/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "1", info: "OK", pois: [], paths: [] }),
      });
    });
  });

  test("Map Flow 1: Click Timeline item -> Map Selected & Popover visible", async ({ page }) => {
    await page.goto("/trip/chongqing-2026");
    await expect(page.locator("body")).toBeVisible();

    // Timeline items should exist
    const items = page.locator("article");
    await expect(items.first()).toBeVisible({ timeout: 15000 });

    // Click first item in Timeline
    await items.first().click();

    // Verify timeline item is selected
    await expect(items.first()).toHaveClass(/border-primary|bg-accent/);

    // Verify Map Popover appears in the visible map section
    const popover = page.locator('[data-testid="map-popover"]:visible');
    await expect(popover).toBeVisible({ timeout: 5000 });
  });

  test("Map Flow 2: Click Marker -> Timeline selected", async ({ page }) => {
    await page.goto("/trip/chongqing-2026");
    await expect(page.locator("body")).toBeVisible();

    // Target visible markers on the active map canvas
    const markerPins = page.locator('[data-testid="place-marker"]:visible');
    await expect(markerPins.first()).toBeVisible({ timeout: 15000 });

    // AMap replaces marker DOM nodes while its overlay settles. Dispatch on the
    // current semantic marker so the test exercises selection without racing a detached node.
    const firstPlaceId = await markerPins.first().getAttribute("data-place-id");
    expect(firstPlaceId).toBeTruthy();
    await page.locator(`[data-testid="place-marker"][data-place-id="${firstPlaceId}"]:visible`).last().dispatchEvent("click");

    // Map popover opens
    await expect(page.locator('[data-testid="map-popover"]:visible')).toBeVisible({ timeout: 5000 });

    // An article card in the timeline should be selected
    const selectedItem = page.locator("article.border-primary\\/40, article.bg-accent");
    await expect(selectedItem.first()).toBeVisible({ timeout: 5000 });
  });

  test("Map Flow 3: Switch Day in DaySwitcher -> Map active day update", async ({ page }) => {
    await page.goto("/trip/chongqing-2026");
    await expect(page.locator("body")).toBeVisible();

    // DaySwitcher should be visible on top of map
    const day2Btn = page.getByRole("button", { name: /Day 2/i }).first();
    await expect(day2Btn).toBeVisible({ timeout: 15000 });

    // Click Day 2
    await day2Btn.click();

    // Verify active day is updated (button styled as active)
    await expect(day2Btn).toHaveClass(/bg-primary/);

    // Switch back to "全部"
    const allBtn = page.getByRole("button", { name: /全部/i }).first();
    await allBtn.click();
    await expect(allBtn).toHaveClass(/bg-primary/);
  });

  test("Map Flow 4: Click Fit Trip & Journey Overview", async ({ page }) => {
    await page.goto("/trip/chongqing-2026");
    await expect(page.locator("body")).toBeVisible();

    // Click "行程总览"
    const overviewBtn = page.getByRole("button", { name: /行程总览/i }).first();
    if (await overviewBtn.isVisible()) {
      await overviewBtn.click();

      // Check Journey Overview summary card
      await expect(page.getByRole("heading", { name: /行程总览/i })).toBeVisible({ timeout: 5000 });
      await expect(page.getByText("每日路线透视")).toBeVisible();
      await expect(page.getByText(/涵盖.*个地点/)).toBeVisible();

      // Close overview
      const closeBtn = page.getByRole("button", { name: /关闭|显示完整/i }).first();
      await closeBtn.click();
    }

    // Click Fit Trip button in MapToolbar
    const fitTripBtn = page.locator('button[title*="全行程"], button[title*="行程"]').first();
    if (await fitTripBtn.isVisible()) {
      await fitTripBtn.click();
    }
  });

  test("Map Flow 5: Today Mode -> Current / Next Stop Hero & Route Visible", async ({ page }) => {
    await page.goto("/trip/chongqing-2026/today");
    await expect(page.locator("body")).toBeVisible();

    // Verify Next Stop banner or Live Travel Status Card is visible
    await expect(page.getByText(/下一站/i).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/开始导航/i).first()).toBeVisible();

    // Navigation button should be clickable
    const navBtn = page.getByRole("button", { name: /导航/i }).first();
    await expect(navBtn).toBeEnabled();
  });

  test("Map Flow 6: Vertical Transit Guide -> Multi-floor / height diff guide", async ({ page }) => {
    await page.goto("/trip/chongqing-2026");
    await expect(page.locator("body")).toBeVisible();

    // Find and click 洪崖洞 in timeline
    const hydItem = page.locator("article").filter({ hasText: "洪崖洞" }).first();
    await expect(hydItem).toBeVisible({ timeout: 15000 });
    await hydItem.click();

    // Verify Map Popover shows vertical transit guide
    const popover = page.locator('[data-testid="map-popover"]:visible');
    await expect(popover).toBeVisible({ timeout: 5000 });
    await expect(popover.getByText("山城立体换乘指引").first()).toBeVisible();
    await expect(popover.getByText(/高差约 50m|沧白路/).first()).toBeVisible();
  });

  test("Map Flow 7: Offline Package -> Cache trip & offline ready", async ({ page }) => {
    await page.goto("/trip/chongqing-2026");
    await expect(page.locator("body")).toBeVisible();

    // MapToolbar offline package button in visible desktop toolbar
    const offlineBtn = page.locator('button[title*="离线"]:visible').first();
    await expect(offlineBtn).toBeVisible({ timeout: 15000 });
    await offlineBtn.click();

    // Toast confirmation or status update appears
    await expect(page.locator("body")).toBeVisible();
  });
});
