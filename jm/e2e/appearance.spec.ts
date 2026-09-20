import fs from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { installTauriMock } from "./support/tauriMock";

/**
 * Rounder surfaces, the user-selectable accent, and the frosted-glass bottom
 * bar. The accent is expressed as `data-accent` on <html> and resolved through
 * the `--jm-accent*` custom properties in src/index.css, so these assertions
 * pin down the resolved values rather than the implementation.
 */

test.use({ viewport: { width: 412, height: 915 } });

const shotDir = process.env.JM_SHOT_DIR;
async function shot(page: Page, name: string, fullPage = false) {
  if (!shotDir) return;
  fs.mkdirSync(shotDir, { recursive: true });
  await page.screenshot({ path: path.join(shotDir, `${name}.png`), fullPage });
}

/** Light-mode fill values from src/index.css. */
const ACCENT_LIGHT = {
  blue: "rgb(37, 99, 235)",
  purple: "rgb(124, 58, 237)",
  default: "rgb(24, 24, 27)",
};
/** Dark mode flips to a bright fill with near-black text. */
const ACCENT_DARK = {
  purple: "rgb(167, 139, 250)",
  default: "rgb(244, 244, 245)",
};
const ACCENT_FG_LIGHT = "rgb(255, 255, 255)";
const ACCENT_FG_DARK = "rgb(9, 9, 11)";

function appearanceCard(page: Page) {
  return page.locator("div.rounded-lg.border.bg-white").first();
}

async function css(page: Page, selector: string, prop: string) {
  return page.locator(selector).first().evaluate(
    (el, p) => getComputedStyle(el).getPropertyValue(p as string),
    prop,
  );
}

/**
 * The segmented control animates colours (`transition-colors`), so computed
 * values have to be polled until the transition settles.
 */
async function expectStyle(locator: ReturnType<Page["locator"]>, prop: string, expected: string) {
  await expect
    .poll(() => locator.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p as string), prop))
    .toBe(expected);
}

test("强调色切换作用于主按钮与滑块，并可持久化", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/#/home/settings");

  const html = page.locator("html");

  // Defaults to blue. Pick an explicit light theme first so the segmented
  // control has an active segment to probe (the default mode is "system",
  // where no segment is highlighted).
  await expect(html).toHaveAttribute("data-accent", "blue");
  await page.getByRole("button", { name: "浅色", exact: true }).click();
  const primary = page.getByRole("button", { name: "浅色", exact: true });

  await expectStyle(primary, "background-color", ACCENT_LIGHT.blue);
  await expectStyle(primary, "color", ACCENT_FG_LIGHT);

  // Native controls follow the accent too.
  const range = page.locator('input[type="range"]:visible').first();
  expect(await range.evaluate((el) => getComputedStyle(el).accentColor)).toBe(ACCENT_LIGHT.blue);

  await shot(page, "accent-blue-light");

  await page.getByRole("button", { name: "主题色 紫" }).click();
  await expect(html).toHaveAttribute("data-accent", "purple");
  await expectStyle(primary, "background-color", ACCENT_LIGHT.purple);
  expect(await range.evaluate((el) => getComputedStyle(el).accentColor)).toBe(ACCENT_LIGHT.purple);
  await shot(page, "accent-purple-light");

  // The monochrome option reproduces the original look.
  await page.getByRole("button", { name: "主题色 默认" }).click();
  await expectStyle(primary, "background-color", ACCENT_LIGHT.default);

  // Survives a reload, and flips to the dark variant with the dark theme.
  await page.getByRole("button", { name: "主题色 紫" }).click();
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await expect(html).toHaveClass(/dark/);
  // 深色 is the active segment now, so that is what carries the accent fill.
  const darkPrimary = page.getByRole("button", { name: "深色", exact: true });
  await expectStyle(darkPrimary, "background-color", ACCENT_DARK.purple);
  await expectStyle(darkPrimary, "color", ACCENT_FG_DARK);
  await shot(page, "accent-purple-dark");

  await page.reload();
  await expect(html).toHaveAttribute("data-accent", "purple");
  await expect(html).toHaveClass(/dark/);
  expect(await page.evaluate(() => localStorage.getItem("jm_accent"))).toBe("purple");

  await page.getByRole("button", { name: "主题色 默认" }).click();
  await expectStyle(darkPrimary, "background-color", ACCENT_DARK.default);
});

test("圆角尺度：卡片 16px、控件 12px", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/#/home/settings");

  // Cards use `rounded-lg`, controls `rounded-md`.
  expect(await css(page, "div.rounded-lg.border.bg-white", "border-top-left-radius")).toBe("16px");
  expect(await css(page, "button.rounded-md, input.rounded-md", "border-top-left-radius")).toBe(
    "12px",
  );
  expect(await css(page, ".mobile-bottom-nav > div", "border-top-left-radius")).toBe("24px");
});

test("底部导航是悬浮的液态玻璃", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/#/home/home");

  const bar = page.locator(".mobile-bottom-nav > div").first();
  const style = await bar.evaluate((el) => {
    const s = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return {
      backdrop: s.backdropFilter || s.webkitBackdropFilter,
      background: s.backgroundColor,
      bottom: rect.bottom,
      viewport: window.innerHeight,
      left: rect.left,
      width: rect.width,
    };
  });

  // Blurred, translucent, and inset from the screen edges.
  expect(style.backdrop).toContain("blur");
  expect(style.background).toMatch(/rgba\(/);
  expect(style.bottom).toBeLessThan(style.viewport);
  expect(style.left).toBeGreaterThan(0);
  expect(style.width).toBeLessThan(412);

  // Nav labels stay readable: the bar's own labels use the app's text tokens.
  await expect(page.locator(".mobile-bottom-nav").getByText("设置")).toBeVisible();
  await shot(page, "glass-nav-light");
});

test("悬浮导航栏让内容从玻璃后穿过，且不遮挡页面底部", async ({ page }) => {  await installTauriMock(page, {
    searchItems: Array.from({ length: 24 }, (_, i) => {
      const idx = String(i + 1).padStart(3, "0");
      return { id: `91${idx}`, name: `玻璃 ${idx}`, author: `Author ${idx}` };
    }),
    searchPageSize: 24,
  });
  await page.goto("/#/home/search");
  await page.getByPlaceholder("输入关键词 / JM12345").click();
  await page.getByPlaceholder("输入关键词 / JM12345").fill("glass");
  await page.getByRole("button", { name: "搜索", exact: true }).click();

  const rows = page.getByRole("button", { name: "详情", exact: true });
  await expect(rows).toHaveCount(20);
  const bar = page.locator(".mobile-bottom-nav > div").first();

  // Mid-scroll: the results card sits behind the bar, which is what makes the
  // frosted effect visible at all.
  await page.evaluate(() => {
    window.scrollTo(0, Math.round((document.documentElement.scrollHeight - window.innerHeight) * 0.55));
  });
  const spansBar = await page
    .locator("div.rounded-lg.border.bg-white")
    .last()
    .evaluate((el) => {
      const bar = document.querySelector(".mobile-bottom-nav > div") as HTMLElement;
      const barTop = bar.getBoundingClientRect().top;
      const rect = el.getBoundingClientRect();
      return rect.top < barTop && rect.bottom > barTop;
    });
  expect(spansBar).toBe(true);
  await shot(page, "glass-nav-over-content");

  // Bottom: the reserved space must keep the last card clear of the bar.
  // Reaching the bottom keeps revealing the buffered remainder, which grows the
  // page, so settle the list first and then assert against a fresh scroll.
  await expect
    .poll(
      async () => {
        await page.evaluate(() => window.scrollTo(0, 999_999));
        return rows.count();
      },
      { timeout: 15000 },
    )
    .toBe(24);

  await expect
    .poll(
      async () => {
        await page.evaluate(() => window.scrollTo(0, 999_999));
        const cardBottom = await page
          .locator("div.rounded-lg.border.bg-white")
          .last()
          .evaluate((el) => el.getBoundingClientRect().bottom);
        const barTop = await bar.evaluate((el) => el.getBoundingClientRect().top);
        return cardBottom <= barTop + 1;
      },
      { timeout: 15000 },
    )
    .toBe(true);
  await shot(page, "glass-nav-bottom-clear");
});

test("底部导航的「阅读」菜单能弹出并跳转", async ({ page }) => {
  // Regression: the floating bar must not clip its own popover. With
  // `overflow-hidden` on the bar the menu was rendered but unreachable, which
  // made the 阅读 tab look broken.
  await installTauriMock(page);
  await page.goto("/#/home/home");

  const nav = page.locator(".mobile-bottom-nav");
  await nav.getByRole("button", { name: "阅读", exact: true }).click();

  const favorites = nav.getByRole("link", { name: "在线收藏", exact: true });
  await expect(favorites).toBeVisible();
  await shot(page, "glass-nav-read-menu");

  // Reachable, not just present: the click has to land on the link.
  await favorites.click();
  await expect(page).toHaveURL(/\/#\/home\/favorites$/);
});
