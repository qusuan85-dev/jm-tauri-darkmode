import fs from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { installTauriMock } from "./support/tauriMock";

/**
 * Search batching / infinite scroll / session restore.
 *
 * The backend page size is fixed server-side, so `每次加载` is a client-side
 * slice of the accumulated results: a "batch" reveals N entries, and reaching
 * the bottom pulls the next server page when the buffer runs out.
 */

test.use({ viewport: { width: 412, height: 915 } });

function makeItems(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const idx = String(i + 1).padStart(3, "0");
    return { id: `90${idx}`, name: `Result ${idx}`, author: `Author ${idx}` };
  });
}

/** List rows each expose a 详情 button, so the count of those is the row count. */
function resultRows(page: Page) {
  return page.getByRole("button", { name: "详情", exact: true });
}

async function searchFor(page: Page, query: string) {
  const input = page.getByPlaceholder("输入关键词 / JM12345");
  await input.click();
  await input.fill(query);
  await page.getByRole("button", { name: "搜索", exact: true }).click();
}

async function searchCallCount(page: Page) {
  return page.evaluate(
    () =>
      ((window as any).__mockInvokeCalls as Array<{ cmd: string }>).filter((c) => c.cmd === "api_search")
        .length,
  );
}

async function scrollToBottom(page: Page) {
  await page.evaluate(() => window.scrollTo(0, 999_999));
}

/** Optional visual review output: set JM_SHOT_DIR to dump screenshots. */
const shotDir = process.env.JM_SHOT_DIR;
async function shot(page: Page, name: string, fullPage = true) {
  if (!shotDir) return;
  fs.mkdirSync(shotDir, { recursive: true });
  await page.screenshot({ path: path.join(shotDir, `${name}.png`), fullPage });
}

test("每次加载条数决定每批展示的结果数量", async ({ page }) => {
  await installTauriMock(page, { searchItems: makeItems(120), searchPageSize: 60 });
  await page.goto("/#/home/search");
  await searchFor(page, "batch");

  // Default batch size is 20; the first server page holds 60 so no extra fetch
  // is needed for the second batch.
  await expect(resultRows(page)).toHaveCount(20);
  const callsAfterFirstBatch = await searchCallCount(page);
  expect(callsAfterFirstBatch).toBe(1);

  await page.getByRole("button", { name: "加载更多" }).click();
  await expect(resultRows(page)).toHaveCount(40);
  // Still served from the buffered page — no additional request.
  expect(await searchCallCount(page)).toBe(callsAfterFirstBatch);

  // Switching the batch size changes the granularity of the next batch.
  await page.getByLabel("每次加载结果数").selectOption("10");
  await page.getByRole("button", { name: "加载更多" }).click();
  await expect(resultRows(page)).toHaveCount(50);
  expect(await searchCallCount(page)).toBe(callsAfterFirstBatch);

  // The header reflects both totals.
  await expect(page.getByText(/共 120 条 · 已加载 50/)).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "search-controls-light", false);
  await shot(page, "search-batch-light");
});

test("划到最底部自动加载下一批，直到全部加载完", async ({ page }) => {
  await installTauriMock(page, { searchItems: makeItems(45), searchPageSize: 20 });
  await page.goto("/#/home/search");
  await searchFor(page, "scroll");

  await expect(resultRows(page)).toHaveCount(20);

  // Touching the bottom pulls and reveals the next batch without any button.
  await scrollToBottom(page);
  await expect(resultRows(page)).toHaveCount(40);

  await scrollToBottom(page);
  await expect(resultRows(page)).toHaveCount(45);

  // Stops at the end instead of looping forever.
  await expect(page.getByText("已经到底了", { exact: false })).toBeVisible();
  await scrollToBottom(page);
  await page.waitForTimeout(300);
  await expect(resultRows(page)).toHaveCount(45);
  expect(await searchCallCount(page)).toBe(3);

  // A cold start (app restart / reload) restores the session from storage too.
  await page.evaluate(() => localStorage.setItem("jm_theme_mode", "dark"));
  await page.reload();
  await expect(page.getByPlaceholder("输入关键词 / JM12345")).toHaveValue("scroll");
  await expect(resultRows(page)).toHaveCount(45);
  expect(await searchCallCount(page)).toBe(0);
  await shot(page, "search-restored-dark");
});

test("切到别的页面再回来，搜索条件、结果与滚动位置都保留", async ({ page }) => {
  await installTauriMock(page, { searchItems: makeItems(120), searchPageSize: 60 });
  await page.goto("/#/home/search");
  await searchFor(page, "keep");
  await expect(resultRows(page)).toHaveCount(20);

  const callsBeforeLeaving = await searchCallCount(page);

  await page.evaluate(() => window.scrollTo(0, 600));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);

  await page.getByRole("link", { name: /首页/ }).click();
  await expect(page).toHaveURL(/\/#\/home\/home$/);
  await expect(page.getByText("Result 001", { exact: true })).toHaveCount(0);

  await page.getByRole("link", { name: /搜索/ }).click();
  await expect(page).toHaveURL(/\/#\/home\/search/);

  // Same query, same results, and — crucially — no refetch.
  await expect(page.getByPlaceholder("输入关键词 / JM12345")).toHaveValue("keep");
  await expect(resultRows(page)).toHaveCount(20);
  expect(await searchCallCount(page)).toBe(callsBeforeLeaving);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);

  // The buffered page is still there, so the next batch needs no request.
  await page.getByRole("button", { name: "加载更多" }).click();
  await expect(resultRows(page)).toHaveCount(40);
  expect(await searchCallCount(page)).toBe(callsBeforeLeaving);
});

test("清空结果后不再保留上一次搜索", async ({ page }) => {
  await installTauriMock(page, { searchItems: makeItems(30), searchPageSize: 30 });
  await page.goto("/#/home/search");
  await searchFor(page, "temp");
  await expect(resultRows(page)).toHaveCount(20);

  await page.getByRole("button", { name: "清空结果" }).click();
  await expect(resultRows(page)).toHaveCount(0);
  await expect(page.getByText("暂无结果")).toBeVisible();

  await page.getByRole("link", { name: /首页/ }).click();
  await page.getByRole("link", { name: /搜索/ }).click();
  await expect(resultRows(page)).toHaveCount(0);
});
