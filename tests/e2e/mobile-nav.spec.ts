import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 375, height: 812 } });

test.describe("mobile navigation", () => {
  test("bottom bar reaches the pages only the desktop sidebar used to own", async ({ page }) => {
    await page.goto("/trip/chongqing-2026");

    const nav = page.getByRole("navigation", { name: "移动端主导航" });
    await expect(nav).toBeVisible({ timeout: 15_000 });
    // First paint can precede hydration; clicking before the client router
    // attaches swallows the navigation. The day tabs render from React state,
    // so they are a reliable "hydration done" signal.
    await expect(page.getByRole("tablist", { name: "选择日期" })).toBeVisible({ timeout: 15_000 });

    // Sharing must survive on phones; it used to disappear below 640px.
    await expect(page.getByRole("button", { name: "分享" })).toBeVisible();

    // The map entry reveals the real map by collapsing the trip sheet: the
    // journey preview pill only exists once the sheet stops covering that
    // corner, so it doubles as the collapse signal.
    const preview = page.getByRole("button", { name: "行程预演" });
    await expect(preview).toBeHidden();
    await nav.getByRole("link", { name: "地图" }).click();
    await expect(page).toHaveURL(/\/trip\/chongqing-2026$/, { timeout: 10_000 });
    await expect(preview).toBeVisible({ timeout: 10_000 });

    await nav.getByRole("link", { name: "今天" }).click();
    await expect(page).toHaveURL(/\/trip\/chongqing-2026\/today$/, { timeout: 10_000 });

    await nav.getByRole("button", { name: "更多" }).click();
    await page.getByRole("dialog", { name: "更多页面" }).getByRole("link", { name: "交通" }).click();
    await expect(page).toHaveURL(/\/trip\/chongqing-2026\/transport$/, { timeout: 10_000 });

    await nav.getByRole("button", { name: "更多" }).click();
    await page.getByRole("dialog", { name: "更多页面" }).getByRole("link", { name: "预订推荐" }).click();
    await expect(page).toHaveURL(/\/trip\/chongqing-2026\/offers$/, { timeout: 10_000 });

    await nav.getByRole("button", { name: "更多" }).click();
    await page.getByRole("dialog", { name: "更多页面" }).getByRole("link", { name: "设置" }).click();
    await expect(page).toHaveURL(/\/settings$/);
  });

  test("pages outside a trip get the global bottom bar", async ({ page }) => {
    await page.goto("/settings");

    const globalNav = page.getByRole("navigation", { name: "全局导航" });
    await expect(globalNav).toBeVisible();

    await globalNav.getByRole("link", { name: "我的旅行" }).click();
    await expect(page).toHaveURL(/\/trips$/);
    await expect(globalNav).toBeVisible();
  });
});
