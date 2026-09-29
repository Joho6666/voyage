import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 375, height: 812 } });

test.describe("mobile navigation", () => {
  test("bottom bar reaches the pages only the desktop sidebar used to own", async ({ page }) => {
    await page.goto("/trip/chongqing-2026");

    const nav = page.getByRole("navigation", { name: "移动端主导航" });
    await expect(nav).toBeVisible({ timeout: 15_000 });

    // Sharing must survive on phones; it used to disappear below 640px.
    await expect(page.getByRole("button", { name: "分享" })).toBeVisible();

    await nav.getByRole("link", { name: "今天" }).click();
    await expect(page).toHaveURL(/\/trip\/chongqing-2026\/today$/);

    await nav.getByRole("button", { name: "更多" }).click();
    await page.getByRole("dialog", { name: "更多页面" }).getByRole("link", { name: "美食" }).click();
    await expect(page).toHaveURL(/\/trip\/chongqing-2026\/food$/);

    await nav.getByRole("button", { name: "更多" }).click();
    await page.getByRole("dialog", { name: "更多页面" }).getByRole("link", { name: "预算" }).click();
    await expect(page).toHaveURL(/\/trip\/chongqing-2026\/budget$/);

    await nav.getByRole("button", { name: "更多" }).click();
    await page.getByRole("dialog", { name: "更多页面" }).getByRole("link", { name: "住宿" }).click();
    await expect(page).toHaveURL(/\/trip\/chongqing-2026\/hotels$/);

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
