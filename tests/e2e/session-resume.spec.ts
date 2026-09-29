import { test, expect } from "@playwright/test";

test.describe("planning session resume", () => {
  test("offers the last session and drops a stale pointer honestly", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "voyage-planning",
        JSON.stringify({
          state: { sessionId: "planning_stale_000000", destination: "南京", updatedAt: new Date().toISOString() },
          version: 0,
        }),
      );
    });
    await page.goto("/new-trip");

    const banner = page.getByText("继续上次规划", { exact: false }).first();
    await expect(banner).toBeVisible();

    // The server no longer knows this session; the pointer must be dropped,
    // not kept offering a dead conversation.
    await page.getByRole("button", { name: "继续" }).click();
    await expect(page.getByText("这次规划会话已失效")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("继续上次规划", { exact: false })).toHaveCount(0);

    // A reload stays clean because the pointer was cleared. (addInitScript
    // re-seeds storage on every navigation, so assert the store directly
    // instead of reloading under the seed.)
    const stored = await page.evaluate(() => window.localStorage.getItem("voyage-planning"));
    expect(stored).not.toContain("planning_stale_000000");
  });

  test("does not offer a resume when no session was ever started", async ({ page }) => {
    await page.goto("/new-trip");
    await expect(page.getByRole("button", { name: "开始对话" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("继续上次规划", { exact: false })).toHaveCount(0);
  });
});
