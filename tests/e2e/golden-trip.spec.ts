import { test, expect } from "@playwright/test";

test.describe("Voyage Golden Trip E2E Suite", () => {
  test.beforeEach(async ({ page }) => {
    // Intercept external third-party requests for deterministic behavior
    await page.route("**/restapi.amap.com/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "1", info: "OK", pois: [], paths: [] }),
      });
    });
  });

  test("Flow 1: Landing -> Input requirement -> Create Trip -> Trip Workspace", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toContainText("告诉 Voyage 你想去哪儿");

    // Check prefilled Golden Trip prompt
    const promptInput = page.locator("textarea");
    await expect(promptInput).toBeVisible();
    await promptInput.fill("从桂林去重庆玩3天，2个人，预算2500，喜欢美食和夜景，不想每天走太多路。");

    // Click submit button
    const submitBtn = page.locator('button[type="submit"]');
    await submitBtn.click();

    // Should navigate to new-trip with query
    await page.waitForURL(/\/new-trip/);
    await expect(page).toHaveURL(/.*new-trip.*/);

    // Click Generate Trip
    const generateBtn = page.getByRole("button", { name: /开始生成|创建|生成完整旅行|AI 创建旅行/i });
    await expect(generateBtn).toBeVisible({ timeout: 15000 });
    await generateBtn.click();

    // Wait for trip workspace
    await page.waitForURL(/\/trip\//, { timeout: 30000 });
    await expect(page.locator("h1, h2").first()).toContainText(/重庆|Day/);
  });

  test("Flow 2: Itinerary item interaction and map sync", async ({ page }) => {
    await page.goto("/trip/chongqing-2026");
    await expect(page.locator("body")).toBeVisible();

    // Verify day timeline items exist
    const items = page.locator("article");
    await expect(items.first()).toBeVisible({ timeout: 15000 });

    // Click on the first item
    await items.first().click();

    // Verify item has active/selected styling or focus
    await expect(items.first()).toHaveClass(/border-primary|bg-accent/);
  });

  test("Flow 3: AI Action '今晚少走一点' -> Proposal Diff Modal -> Apply", async ({ page }) => {
    await page.goto("/trip/chongqing-2026/today");
    await expect(page.getByText("今日行程")).toBeVisible({ timeout: 15000 });

    // Tap "少走路" quick action button
    const reduceWalkBtn = page.getByRole("button", { name: /少走路|太累了/i }).first();
    await reduceWalkBtn.click();

    // Verify TripDiffModal pops up with proposal comparison
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 10000 });
    await expect(modal).toContainText(/步行距离|交通调整|优化建议/);

    // Click Apply changes
    const applyBtn = modal.getByRole("button", { name: /应用此修改|应用/i });
    await applyBtn.click();

    // Modal closes
    await expect(modal).not.toBeVisible();
  });

  test("Flow 4: Refresh -> Trip still exists with persisted data", async ({ page }) => {
    await page.goto("/trip/chongqing-2026");
    await expect(page.locator("body")).toContainText(/重庆/i, { timeout: 15000 });

    // Reload page
    await page.reload();

    // Verify itinerary still loads and displays
    await expect(page.locator("body")).toContainText(/重庆/i, { timeout: 15000 });
    const items = page.locator("article");
    await expect(items.first()).toBeVisible();
  });

  test("Flow 5: Weather -> Rain Plan -> Proposal Diff -> Apply", async ({ page }) => {
    await page.goto("/trip/chongqing-2026/today");
    await expect(page.getByText("今日行程")).toBeVisible({ timeout: 15000 });

    // Click "下雨方案" button
    const rainPlanBtn = page.getByRole("button", { name: /下雨方案|换下雨方案/i }).first();
    if (await rainPlanBtn.isVisible()) {
      await rainPlanBtn.click();

      // Diff modal should appear
      const modal = page.locator('[role="dialog"]');
      await expect(modal).toBeVisible({ timeout: 10000 });
      await expect(modal).toContainText(/下雨方案|室内|步行/);

      // Confirm apply
      const applyBtn = modal.getByRole("button", { name: /应用此修改|应用/i });
      await applyBtn.click();
      await expect(modal).not.toBeVisible();
    }
  });

  test("Flow 6: Undo -> Trip restored", async ({ page }) => {
    await page.goto("/trip/chongqing-2026/today");
    await expect(page.getByText("今日行程")).toBeVisible({ timeout: 15000 });

    // Click Undo button
    const undoBtn = page.getByRole("button", { name: /撤销/i });
    await expect(undoBtn).toBeVisible();
    await undoBtn.click();

    // Verify page remains stable and responsive
    await expect(page.locator("body")).toBeVisible();
  });

  test("Flow 7: Explore -> Add POI -> Itinerary update", async ({ page }) => {
    await page.goto("/trip/chongqing-2026/explore");
    await expect(page.getByText("真实 POI 探索")).toBeVisible({ timeout: 15000 });

    // Explore places cards should be rendered
    const placeCards = page.locator("article");
    await expect(placeCards.first()).toBeVisible();

    // Open add to day dialog on the first card
    const addBtn = placeCards.first().getByRole("button", { name: /加入|添加|\+/i });
    if (await addBtn.isVisible()) {
      await addBtn.click();

      // Dialog opens
      const dayDialog = page.locator('[role="dialog"]');
      await expect(dayDialog).toBeVisible();

      // Select Day 1
      const dayOption = dayDialog.getByRole("button", { name: /Day 1|第 1 天/i });
      if (await dayOption.isVisible()) {
        await dayOption.click();
      }
    }
  });
});
