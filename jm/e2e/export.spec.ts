import fs from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { installTauriMock } from "./support/tauriMock";

/**
 * Export panel on the comic detail page: destination handling plus the
 * "decrypted images / per-chapter PDF / merged PDF" options.
 *
 * In the browser there is no native shell bridge, so the custom SAF folder is
 * unavailable — the panel must say so and fall back to the default location.
 */

test.use({ viewport: { width: 412, height: 915 } });

const shotDir = process.env.JM_SHOT_DIR;
async function shot(page: Page, name: string, fullPage = false) {
  if (!shotDir) return;
  fs.mkdirSync(shotDir, { recursive: true });
  await page.screenshot({ path: path.join(shotDir, `${name}.png`), fullPage });
}

async function openDetail(page: Page) {
  await installTauriMock(page, {
    albumId: "50001",
    exportDefaultDir: "C:/mock-export/JM",
    albumSeries: [{ id: "50001", sort: 1, name: "第一话", images: ["00001.jpg", "00002.jpg"] }],
  });
  await page.goto("/#/detail/50001");
  await expect(page.getByRole("button", { name: "导出" })).toBeVisible();
}

test("详情页可以导出解密原图与 PDF，并把参数与进度传给后端", async ({ page }) => {
  await openDetail(page);

  await page.getByRole("button", { name: "导出" }).click();
  await expect(page.getByText("导出到目录")).toBeVisible();
  // Default destination comes from the backend (resolved asynchronously).
  await expect(page.getByText("C:/mock-export/JM")).toBeVisible({ timeout: 15000 });
  // No native bridge in the browser: custom folders are unavailable and the
  // panel explains the fallback.
  await expect(page.getByRole("button", { name: /选择目录/ })).toBeDisabled();
  await expect(page.getByText("当前平台不支持选择自定义目录")).toBeVisible();

  // Defaults: images + one PDF per chapter.
  await expect(page.getByLabel("解密原图")).toBeChecked();
  await expect(page.getByLabel("每章一个 PDF")).toBeChecked();
  await expect(page.getByLabel("整本合并 PDF")).not.toBeChecked();
  await shot(page, "export-panel-light");

  await page.getByLabel("整本合并 PDF").check();
  await page.getByRole("button", { name: "开始导出" }).click();

  await expect(page.getByText(/已导出到 C:\/mock-export\/JM/)).toBeVisible();
  await expect(page.getByText(/2 张图片/)).toBeVisible();
  // Scoped to the progress line: the chapter name also appears in the album's
  // chapter list, so a bare /第一话/ would match two elements.
  await expect(page.getByText(/2\/2 · 第一话/)).toBeVisible();

  const call = await page.evaluate(() =>
    ((window as any).__mockInvokeCalls as Array<{ cmd: string; args: any }>)
      .filter((c) => c.cmd === "api_export_album")
      .pop(),
  );
  expect(call.args.wantImages).toBe(true);
  expect(call.args.wantPdfChapter).toBe(true);
  expect(call.args.wantPdfMerged).toBe(true);
  expect(call.args.dest).toBe("C:/mock-export/JM");
  // The backend needs the CDN base: chapter responses carry bare file names.
  expect(call.args.imgBase).toMatch(/^https?:\/\//);
  expect(call.args.chapters).toHaveLength(1);
  expect(call.args.chapters[0].id).toBe("50001");

  await shot(page, "export-panel-done");
});


test("导出面板在深色主题下正常", async ({ page }) => {
  await openDetail(page);
  await page.evaluate(() => localStorage.setItem("jm_theme_mode", "dark"));
  await page.reload();
  await expect(page.getByRole("button", { name: "导出" })).toBeVisible();
  await page.getByRole("button", { name: "导出" }).click();
  await expect(page.getByText("导出到目录")).toBeVisible();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await shot(page, "export-panel-dark");
});
