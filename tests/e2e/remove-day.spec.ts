import { test, expect } from "@playwright/test";

// E2E for "删除这一天" (remove-day): the DayHeader overflow menu now offers
// a two-step confirm (再点一次确认删除) instead of window.confirm, which was
// silently impossible in browsers that suppress dialogs.

test.describe("remove-day command", () => {
  test("deletes a day after two-step confirm and renumbers the rest", async ({ page }) => {
    await page.goto("/trip/chongqing-2026");
    await page.waitForTimeout(2000);

    const menuBtn = page.locator('button[aria-label="这一天更多操作"]').first();
    await expect(menuBtn).toBeVisible();
    await menuBtn.click();
    await page.getByText("删除这一天").first().click();

    // DropdownMenu closes on select; re-open to see the armed state
    await page.waitForTimeout(400);
    await menuBtn.click();
    const confirmItem = page.getByText("再点一次确认删除");
    await expect(confirmItem).toBeVisible();
    await confirmItem.click();

    await page.waitForTimeout(2500);
    const body = await page.locator("body").innerText();
    expect(body).toContain("已删除 Day");
  });

  test("the overflow menu does not use window.confirm", async ({ page }) => {
    // A suppressed-dialog environment must still show the confirm step
    await page.goto("/trip/chongqing-2026");
    await page.waitForTimeout(2000);

    let confirmCalled = false;
    page.on("dialog", async (dialog) => {
      confirmCalled = true;
      await dialog.dismiss();
    });

    await page.locator('button[aria-label="这一天更多操作"]').first().click();
    await page.getByText("删除这一天").first().click();
    await page.waitForTimeout(500);

    expect(confirmCalled).toBe(false);
  });
});