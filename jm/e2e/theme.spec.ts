import fs from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { installTauriMock } from "./support/tauriMock";

/**
 * Dark-mode coverage.
 *
 * The theme is expressed as a `dark` class on <html>; every colour in the app
 * resolves through the token layer in src/index.css. These tests pin down the
 * resolved token values, persistence, system-following, and — most importantly
 * — that no light surface is left behind anywhere in the DOM.
 */

// Phone-sized viewport: this is primarily an Android app.
test.use({ viewport: { width: 412, height: 915 } });

const LATEST_ITEMS = [
  { id: "50001", name: "Sample Comic A", author: "Author A", category: { title: "Short" } },
  { id: "50002", name: "Sample Comic B", author: "Author B", category: { title: "Long" } },
  { id: "50003", name: "Sample Comic C", author: "Author C", category: { title: "Long" } },
];

const WINDOW_BG_DARK = "rgb(9, 9, 11)";
const SURFACE_BG_DARK = "rgb(24, 24, 27)";
const PRIMARY_TEXT_DARK = "rgb(244, 244, 245)";
const BORDER_DARK = "rgb(45, 45, 51)";

/** Optional visual review output: set JM_SHOT_DIR to dump screenshots. */
const shotDir = process.env.JM_SHOT_DIR;
async function shot(page: Page, name: string) {
  if (!shotDir) return;
  fs.mkdirSync(shotDir, { recursive: true });
  await page.screenshot({ path: path.join(shotDir, `${name}.png`), fullPage: true });
}

async function style(page: Page, selector: string, prop: string) {
  return page.locator(selector).first().evaluate(
    (el, p) => getComputedStyle(el).getPropertyValue(p as string),
    prop,
  );
}

/**
 * Every element big enough to be a visible surface must not paint a light
 * background while the dark theme is active. This is what catches a utility
 * that the token layer forgot to re-map.
 *
 * `bg-zinc-900 text-white` is excluded on purpose: that combination is the
 * app's inverted "primary" fill, which is *supposed* to become light-on-dark
 * in the dark theme.
 */
async function lightSurfaces(page: Page) {
  return page.evaluate(() => {
    const lum = (c: string) => {
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(c);
      if (!m) return null;
      const a = m[4] === undefined ? 1 : Number(m[4]);
      if (a < 0.5) return null;
      return (0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3])) / 255;
    };
    const offenders: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const cls = typeof el.className === "string" ? el.className : "";
      if (cls.includes("bg-zinc-900") && cls.includes("text-white")) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 20) continue;
      const bg = getComputedStyle(el).backgroundColor;
      const l = lum(bg);
      if (l === null || l <= 0.7) continue;
      offenders.push(`${el.tagName.toLowerCase()}[${cls.slice(0, 110)}] ${bg}`);
    }
    return offenders;
  });
}

test("appearance setting switches to dark, re-maps tokens and persists", async ({ page }) => {
  await installTauriMock(page, { latestItems: LATEST_ITEMS });
  await page.goto("/#/home/settings");

  const html = page.locator("html");
  await expect(html).not.toHaveClass(/dark/);
  await shot(page, "settings-light");

  await page.getByRole("button", { name: "深色" }).click();
  await expect(html).toHaveClass(/dark/);

  expect(await style(page, "html", "background-color")).toBe(WINDOW_BG_DARK);
  expect(await style(page, "html", "color-scheme")).toBe("dark");
  expect(await style(page, "div.rounded-lg.border.bg-white", "background-color")).toBe(SURFACE_BG_DARK);
  expect(await style(page, "div.rounded-lg.border.bg-white", "border-top-color")).toBe(BORDER_DARK);
  expect(await style(page, "div.rounded-lg.border.bg-white .text-zinc-900", "color")).toBe(
    PRIMARY_TEXT_DARK,
  );

  expect(await lightSurfaces(page)).toEqual([]);
  await shot(page, "settings-dark");

  // The choice survives a reload and is restored before first paint.
  await page.reload();
  await expect(html).toHaveClass(/dark/);
  expect(await page.evaluate(() => localStorage.getItem("jm_theme_mode"))).toBe("dark");

  await page.getByRole("button", { name: "浅色" }).click();
  await expect(html).not.toHaveClass(/dark/);
  expect(await style(page, "html", "background-color")).toBe("rgb(244, 244, 245)");
});

test("dark theme leaves no light surfaces on list pages", async ({ page }) => {
  await installTauriMock(page, { latestItems: LATEST_ITEMS });
  await page.goto("/#/home/home");
  // Persist the preference, then load with it in place.
  await page.evaluate(() => localStorage.setItem("jm_theme_mode", "dark"));
  await page.reload();

  await expect(page.getByText("Sample Comic A", { exact: true })).toBeVisible();
  expect(await lightSurfaces(page)).toEqual([]);
  await shot(page, "home-dark");

  // Hash-only navigation keeps the same document, so the theme stays applied.
  await page.goto("/#/home/search");
  await expect(page.getByRole("textbox").first()).toBeVisible();
  expect(await lightSurfaces(page)).toEqual([]);
  await shot(page, "search-dark");

  await page.goto("/#/home/category_rank");
  await expect(page.locator("main, div").first()).toBeVisible();
  expect(await lightSurfaces(page)).toEqual([]);
  await shot(page, "rank-dark");

  await page.goto("/#/home/favorites");
  await expect(page.locator("main, div").first()).toBeVisible();
  expect(await lightSurfaces(page)).toEqual([]);
  await shot(page, "favorites-dark");

  await page.goto("/#/home/settings");
  await expect(page.getByText("外观", { exact: true })).toBeVisible();
  expect(await lightSurfaces(page)).toEqual([]);
  await shot(page, "settings-dark-full");

  await page.evaluate(() => localStorage.setItem("jm_theme_mode", "light"));
  await page.reload();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.goto("/#/home/home");
  await expect(page.getByText("Sample Comic A", { exact: true })).toBeVisible();
  // Light stays exactly as before: white cards on the zinc-100 window.
  expect(await style(page, "div.rounded-lg.border.bg-white", "background-color")).toBe(
    "rgb(255, 255, 255)",
  );
  await shot(page, "home-light");
});

test("system mode follows the OS scheme until the user picks a theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await installTauriMock(page, { latestItems: LATEST_ITEMS });
  await page.goto("/#/home/settings");

  const html = page.locator("html");
  await expect(html).toHaveClass(/dark/);
  await shot(page, "settings-system-dark");

  await page.emulateMedia({ colorScheme: "light" });
  await expect(html).not.toHaveClass(/dark/);

  // An explicit choice opts out of following the OS.
  await page.getByRole("button", { name: "浅色" }).click();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(html).not.toHaveClass(/dark/);

  await page.getByRole("button", { name: "跟随系统" }).click();
  await expect(html).toHaveClass(/dark/);
  expect(await page.evaluate(() => localStorage.getItem("jm_theme_mode"))).toBeNull();
});
