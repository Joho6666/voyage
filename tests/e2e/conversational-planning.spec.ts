import { test, expect } from "@playwright/test";

test.describe("conversation-first planning", () => {
  test("collects a profile before generating a provider-backed trip", async ({ page }) => {
    await page.goto("/new-trip?q=从桂林去重庆玩3天，2个人，预算2500，喜欢美食和夜景，不想每天走太多路");

    await page.getByRole("button", { name: "开始对话" }).click();
    await expect(page.getByRole("heading", { name: "一起把这趟旅行定下来" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "规则模式" }).first()).toBeVisible();
    await expect(page.getByLabel("目的地")).toHaveValue("重庆");
    await expect(page.getByLabel("总预算（元）")).toHaveValue("2500");

    // The planner must not invent a departure date. Confirm dates explicitly in the profile.
    await page.getByLabel("出发日期").fill("2030-05-01");
    await page.getByLabel("返程日期").fill("2030-05-03");

    await page.getByRole("button", { name: "生成路线图" }).click();
    await page.waitForURL(/\/trip\//, { timeout: 30_000 });
    await expect(page.locator("body")).toContainText("重庆");
    await expect(page.locator("body")).toContainText(/规则规划|确定性规则规划|规划来源/);
  });
});
