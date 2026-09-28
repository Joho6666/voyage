import { test, expect } from "@playwright/test";

test.describe("day-focused trip workspace", () => {
  test("shows one day at a time, switches days, and keeps the choice on reload", async ({ page }) => {
    await page.goto("/trip/chongqing-2026");

    // One day in focus by default, chosen from the day tabs.
    const dayTabs = page.getByRole("tablist", { name: "选择日期" });
    await expect(dayTabs).toBeVisible({ timeout: 15_000 });

    const dayOne = dayTabs.getByRole("tab", { name: "Day 1" });
    const dayTwo = dayTabs.getByRole("tab", { name: "Day 2" });
    await expect(dayOne).toHaveAttribute("aria-selected", "true");
    await expect(dayTwo).toHaveAttribute("aria-selected", "false");

    // "What do I do today" is answered up front, without reading a whole list.
    await expect(page.getByRole("region", { name: "今天做什么" })).toBeVisible();
    await expect(page.getByRole("button", { name: "开始导航" })).toBeVisible();

    // Only the focused day's timeline is rendered.
    await expect(page.getByText("Day 1", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("Day 2", { exact: false }).first()).toBeVisible();

    await dayTwo.click();
    await expect(dayTwo).toHaveAttribute("aria-selected", "true");
    await expect(dayOne).toHaveAttribute("aria-selected", "false");

    // The choice survives a reload instead of snapping back to Day 1.
    await page.reload();
    await expect(page.getByRole("tablist", { name: "选择日期" }).getByRole("tab", { name: "Day 2" }))
      .toHaveAttribute("aria-selected", "true", { timeout: 15_000 });
  });

  test("keeps a different trip's day focus out of this trip", async ({ page }) => {
    // Focus Day 2 here, then open another trip: the stale focus must not leak in.
    await page.goto("/trip/chongqing-2026");
    const tabs = page.getByRole("tablist", { name: "选择日期" });
    await tabs.getByRole("tab", { name: "Day 2" }).click();
    await expect(tabs.getByRole("tab", { name: "Day 2" })).toHaveAttribute("aria-selected", "true");

    await page.goto("/trips");
    await page.goBack();
    await expect(page.getByRole("tablist", { name: "选择日期" })).toBeVisible({ timeout: 15_000 });
    const selected = page.getByRole("tablist", { name: "选择日期" }).getByRole("tab", { selected: true });
    await expect(selected).toHaveCount(1);
  });
});
