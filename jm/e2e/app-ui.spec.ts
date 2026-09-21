import fs from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { installTauriMock } from "./support/tauriMock";

/** Optional visual review output: set JM_SHOT_DIR to dump screenshots. */
const shotDir = process.env.JM_SHOT_DIR;
async function shot(page: Page, name: string) {
  if (!shotDir) return;
  fs.mkdirSync(shotDir, { recursive: true });
  await page.screenshot({ path: path.join(shotDir, `${name}.png`), fullPage: true });
}

test("home latest updates render as cards and open detail", async ({ page }) => {
  await installTauriMock(page, {
    latestItems: [
      { id: "50001", name: "Recent Alpha", author: "Home Author", category: { title: "短篇" } },
      { aid: "50002", title: "Recent Beta", authors: ["Author B"] },
    ],
  });

  await page.goto("/#/home/home");

  await expect(page.getByText("Recent Alpha", { exact: true })).toBeVisible();
  await expect(page.getByText("作者：Home Author", { exact: true })).toBeVisible();
  await expect(page.getByText("AID：50001", { exact: true })).toBeVisible();

  await page.getByText("Recent Alpha", { exact: true }).click();
  await expect(page).toHaveURL(/\/#\/detail\/50001$/);
  await expect(page.getByText("AID 50001", { exact: true })).toBeVisible();
});

test("home latest restores persisted data while SWR revalidates", async ({ page }) => {
  await installTauriMock(page, {
    latestItems: [{ id: "50003", name: "Persisted Recent", author: "Cached Author" }],
    latestDelayMs: 800,
  });

  await page.goto("/#/home/home");
  await expect(page.getByText("Persisted Recent", { exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("jm_home_latest_v1:10001")))
    .not.toBeNull();

  await page.reload();
  await expect(page.getByText("Persisted Recent", { exact: true })).toBeVisible({ timeout: 300 });
  await expect(page.getByRole("status", { name: "最近更新加载中" })).toHaveCount(0);

  await expect
    .poll(() =>
      page.evaluate(() =>
        ((window as any).__mockInvokeCalls as Array<{ cmd: string }>).filter((call) => call.cmd === "api_latest")
          .length,
      ),
    )
    .toBeGreaterThan(0);
});

test("search input stays editable during IME composition and returns results", async ({ page }) => {
  await installTauriMock(page, {
    searchItems: [
      { id: "1298961", name: "长十郎大战黑土", author: "臭弟弟" },
      { id: "1246367", name: "黑土本子 重制版", author: "EEGOES" },
    ],
  });

  await page.goto("/#/home/search");

  const input = page.getByPlaceholder("输入关键词 / JM12345");
  await expect(input).toBeVisible();

  await input.click();
  await input.dispatchEvent("compositionstart");
  await input.fill("黑土");
  await expect(input).toHaveValue("黑土");
  await input.dispatchEvent("compositionend", { data: "黑土" });

  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.getByText("长十郎大战黑土")).toBeVisible();
});

test("desktop reader shortcuts show menu and navigate back", async ({ page }) => {
  await installTauriMock(page);

  await page.goto("/#/reading/123/456?ct=Desktop%20Reader");

  const menu = page.locator(".fixed.left-0.right-0.bottom-0.z-50");
  await expect(menu).toHaveClass(/opacity-0/);

  await page.keyboard.press("Escape");
  await expect(menu).toHaveClass(/opacity-100/);

  await page.keyboard.press("Backspace");
  await expect(page).toHaveURL(/\/#\/detail\/123$/);

  const cancelCalls = await page.evaluate(() => {
    const calls = (window as any).__mockInvokeCalls as Array<{ cmd: string; args: any }>;
    return calls.filter((x) => x.cmd === "api_read_cancel").length;
  });
  expect(cancelCalls).toBeGreaterThan(0);
});

test("desktop reader arrow keys navigate chapters", async ({ page }) => {
  await installTauriMock(page, {
    albumSeries: [
      { id: "11", sort: 1, name: "One", images: ["00001.jpg"] },
      { id: "22", sort: 2, name: "Two", images: ["00001.jpg"] },
      { id: "33", sort: 3, name: "Three", images: ["00001.jpg"] },
    ],
  });

  await page.goto("/#/detail/123");
  await page.getByRole("button", { name: "第2话：Two", exact: true }).click();
  await expect(page).toHaveURL(/\/#\/reading\/123\/22/);
  await expect(page.getByAltText("p1")).toBeVisible();

  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("正在切换到下一话 第3话：Three", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/#\/reading\/123\/33/);

  await page.keyboard.press("ArrowLeft");
  await expect(page.getByText("正在切换到上一话 第2话：Two", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/#\/reading\/123\/22/);
});

test("continuous reader preloads and keeps adjacent chapters scrollable both ways", async ({ page }) => {
  await installTauriMock(page, {
    continuousReading: true,
    albumSeries: [
      { id: "11", sort: 1, name: "One", images: ["00001.jpg"] },
      { id: "22", sort: 2, name: "Two", images: ["00001.jpg"] },
      { id: "33", sort: 3, name: "Three", images: ["00001.jpg"] },
    ],
  });

  await page.goto("/#/detail/123");
  await page.getByRole("button", { name: "第1话：One", exact: true }).click();
  await expect(page).toHaveURL(/\/#\/reading\/123\/11/);

  const chapter11 = page.locator('[data-reading-chapter="11"]');
  const chapter22 = page.locator('[data-reading-chapter="22"]');
  const chapter33 = page.locator('[data-reading-chapter="33"]');
  await expect(chapter11).toHaveCount(1);
  await expect(chapter22).toHaveCount(1);
  await expect(chapter11.getByAltText("p1")).toBeVisible();
  await expect(chapter22.getByAltText("p1")).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const calls = (window as any).__mockInvokeCalls as Array<{ cmd: string; args: any }>;
        const loadedChapters = new Set(
          calls
            .filter((call) => call.cmd === "api_image_descramble_file")
            .map((call) => String(call.args?.url).match(/\/photos\/(\d+)\//)?.[1])
            .filter(Boolean),
        );
        return loadedChapters.size;
      }),
    )
    .toBeGreaterThanOrEqual(2);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const progress = JSON.parse(localStorage.getItem("jm_read_progress_v1") ?? "{}");
        return progress["123"]?.chapterId;
      }),
    )
    .toBe("11");

  await chapter22.evaluate((node) => node.scrollIntoView({ block: "start" }));
  await expect(chapter22).toHaveAttribute("data-reading-active", "true");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const progress = JSON.parse(localStorage.getItem("jm_read_progress_v1") ?? "{}");
        return progress["123"]?.chapterId;
      }),
    )
    .toBe("22");
  await expect(chapter33).toHaveCount(1);
  await expect(chapter11).toHaveCount(1);

  await chapter33.evaluate((node) => node.scrollIntoView({ block: "start" }));
  await expect(chapter33).toHaveAttribute("data-reading-active", "true");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const progress = JSON.parse(localStorage.getItem("jm_read_progress_v1") ?? "{}");
        return progress["123"]?.chapterId;
      }),
    )
    .toBe("33");
  await expect(chapter11).toHaveCount(0);
  await expect(chapter22).toHaveCount(1);

  await chapter22.evaluate((node) => node.scrollIntoView({ block: "start" }));
  await expect(chapter22).toHaveAttribute("data-reading-active", "true");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const progress = JSON.parse(localStorage.getItem("jm_read_progress_v1") ?? "{}");
        return progress["123"]?.chapterId;
      }),
    )
    .toBe("22");
  await expect(chapter11).toHaveCount(1);
  await expect(chapter33).toHaveCount(1);
});

test("detail keeps work and chapter ids separate across reading navigation", async ({ page }) => {
  await installTauriMock(page, {
    latestItems: [{ id: "202", name: "ID Split Entry", author: "mock" }],
    albumId: "202",
    albumSeriesId: "100",
    albumSeries: [
      { id: "201", sort: 1, name: "One", images: ["00001.jpg"] },
      { id: "202", sort: 2, name: "Two", images: ["00001.jpg"] },
    ],
  });

  await page.goto("/#/home/home");
  await page.getByText("ID Split Entry", { exact: true }).click();
  await expect(page).toHaveURL(/\/#\/detail\/202$/);
  await expect(page.getByText("作品ID：100", { exact: true })).toBeVisible();
  await expect(page.getByText("入口ID：202", { exact: true })).toBeVisible();
  await expect(page.getByText("类型：多话 · 共 2 话", { exact: true })).toBeVisible();

  const progressBeforeReading = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("jm_read_progress_v1") ?? "{}"),
  );
  expect(progressBeforeReading).toEqual({});

  await page.getByRole("button", { name: "从第1话开始", exact: true }).click();
  await expect(page).toHaveURL(/\/#\/reading\/100\/201/);
  await expect(page.getByAltText("p1")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const all = JSON.parse(localStorage.getItem("jm_read_progress_v1") ?? "{}");
        return all["100"]?.chapterId;
      }),
    )
    .toBe("201");

  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/\/#\/reading\/100\/202/);
  await page.keyboard.press("Backspace");
  await expect(page).toHaveURL(/\/#\/detail\/202$/);
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await expect(page).toHaveURL(/\/#\/home\/home$/);
});

test("detail migrates aliased progress to the canonical work id", async ({ page }) => {
  await installTauriMock(page, {
    albumId: "202",
    albumSeriesId: "100",
    albumSeries: [
      { id: "201", sort: 1, name: "One", images: ["00001.jpg"] },
      { id: "202", sort: 2, name: "Two", images: ["00001.jpg"] },
    ],
    readProgress: {
      "202": {
        updatedAt: 123456,
        chapterId: "202",
        pageIndex: 7,
      },
    },
  });

  await page.goto("/#/detail/202");
  await expect(page.getByRole("button", { name: "继续阅读", exact: true }).first()).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const all = JSON.parse(localStorage.getItem("jm_read_progress_v1") ?? "{}");
        return {
          canonicalChapter: all["100"]?.chapterId,
          canonicalPage: all["100"]?.pageIndex,
          aliasExists: Boolean(all["202"]),
        };
      }),
    )
    .toEqual({ canonicalChapter: "202", canonicalPage: 7, aliasExists: false });
});


test("settings release build auto-checks update and downloads with progress", async ({ page }) => {
  await installTauriMock(page, {
    appVersion: "0.1.25+jm-20260312-000000",
    updateCheckInfo: {
      currentVersion: "0.1.25+jm-20260312-000000",
      currentTag: "jm-20260312-000000",
      latestTag: "jm-20260312-010000",
      hasUpdate: true,
      asset: {
        name: "jm.apk",
        url: "https://example.com/jm.apk",
        size: 123456,
      },
      isDev: false,
      compareMode: "tag",
      releaseUrl: "https://github.com/alexsunxl/jm-tauri/releases/latest",
    },
    updateDownloadPath: "/tmp/jm.apk",
  });

  await page.goto("/#/home/settings");

  await expect(page.getByText(/版本：0\.1\.25\+jm-20260312-000000（release）/)).toBeVisible();
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const calls = (window as any).__mockInvokeCalls as Array<{ cmd: string; args: any }>;
        return calls.filter((x) => x.cmd === "app_update_check").length;
      });
    })
    .toBeGreaterThan(0);

  await page.getByRole("button", { name: "自动更新", exact: true }).click();
  await expect(page.getByText(/正在下载\.\.\./)).toBeVisible();
  await expect(page.getByText(/正在下载\.\.\.\s*\d+%/)).toBeVisible();

  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const calls = (window as any).__mockInvokeCalls as Array<{ cmd: string; args: any }>;
        const downloadCalls = calls.filter((x) => x.cmd === "app_update_download").length;
        const openPathCalls = calls.filter((x) => x.cmd === "plugin:opener|open_path").length;
        return { downloadCalls, openPathCalls };
      });
    })
    .toEqual({ downloadCalls: 1, openPathCalls: 1 });
});

test("导航里不再有本地收藏，已缓存入口就位", async ({ page }) => {
  await installTauriMock(page);

  await page.goto("/#/home/home");

  await expect(page.getByRole("link", { name: "已缓存" })).toBeVisible();
  await expect(page.getByRole("link", { name: /本地收藏/ })).toHaveCount(0);
  await shot(page, "nav-cached-entry");
});

test("已缓存页列出缓存的本子（封面/标题/占用），并能删除", async ({ page }) => {
  await installTauriMock(page, {
    cachedAlbums: [
      { aid: "90001", title: "缓存的本子A", author: "作者A", bytes: 2048, files: 3, chapters: 2 },
      { aid: "90002", bytes: 1024, files: 1 },
    ],
  });

  await page.goto("/#/home/cached");

  await expect(page.getByText(/已缓存 · 2 个本子/)).toBeVisible();
  await expect(page.getByText("缓存的本子A")).toBeVisible();
  // 缓存里没存过元数据的条目会去接口补标题（mock 的 api_album 返回 AID xxx）
  await expect(page.getByText("AID 90002")).toBeVisible();
  await expect(page.getByText(/已存 2 话/)).toBeVisible();
  await shot(page, "cached-page");

  await page.getByRole("button", { name: "删除" }).first().click();

  await expect(page.getByText(/已缓存 · 1 个本子/)).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const calls = (window as any).__mockInvokeCalls as Array<{ cmd: string; args: any }>;
        return calls.filter((x) => x.cmd === "api_read_cache_remove").map((x) => x.args?.aid);
      }),
    )
    .toEqual(["90001"]);
});

test("未收藏的本子可以收藏到指定收藏夹", async ({ page }) => {
  await installTauriMock(page, {
    favoriteFolders: [{ id: "2", name: "珍藏夹" }],
  });

  await page.goto("/#/detail/12345");
  await page.getByRole("button", { name: "收藏", exact: true }).click();

  await expect(page.getByText("收藏到收藏夹")).toBeVisible();
  await shot(page, "favorite-folder-picker");
  await page.getByRole("button", { name: "珍藏夹", exact: true }).click();

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const calls = (window as any).__mockInvokeCalls as Array<{ cmd: string; args: any }>;
        return {
          toggle: calls.filter((x) => x.cmd === "api_favorite_toggle").length,
          movedTo: calls
            .filter((x) => x.cmd === "api_favorite_folder_move")
            .map((x) => x.args?.folderId),
        };
      }),
    )
    .toEqual({ toggle: 1, movedTo: ["2"] });
});

test("已收藏的本子可以在收藏夹之间移动，也能取消收藏", async ({ page }) => {
  await installTauriMock(page, {
    albumIsFavorite: true,
    favoriteFolders: [{ id: "7", name: "稍后再看" }],
  });

  await page.goto("/#/detail/12345");

  const openButton = page.getByRole("button", { name: "已收藏 · 移动", exact: true });
  await expect(openButton).toBeVisible();
  await openButton.click();

  await expect(page.getByText("移动到收藏夹")).toBeVisible();
  await page.getByRole("button", { name: "稍后再看", exact: true }).click();

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const calls = (window as any).__mockInvokeCalls as Array<{ cmd: string; args: any }>;
        return {
          toggles: calls.filter((x) => x.cmd === "api_favorite_toggle").length,
          movedTo: calls
            .filter((x) => x.cmd === "api_favorite_folder_move")
            .map((x) => x.args?.folderId),
        };
      }),
    )
    // 已经收藏过，所以只移动、不重复 toggle
    .toEqual({ toggles: 0, movedTo: ["7"] });
});

test("收藏列表的封面显示已缓存角标", async ({ page }) => {
  await installTauriMock(page, {
    favorites: [
      { aid: "20001", title: "已缓存的本子", author: "A", coverUrl: "", addedAt: 1, updatedAt: 1 },
      { aid: "20002", title: "没缓存的本子", author: "B", coverUrl: "", addedAt: 2, updatedAt: 2 },
    ],
    cachedAlbums: [{ aid: "20001" }],
  });

  await page.goto("/#/home/favorites");
  await expect(page.getByText("已缓存的本子")).toBeVisible();

  // 只有已缓存的那个封面带角标（导航里也有「已缓存」字样，所以按数据属性找）
  await expect(page.locator('[data-cached-badge="20001"]')).toHaveCount(1);
  await expect(page.locator('[data-cached-badge="20002"]')).toHaveCount(0);
});

test("签到页可以手动签到并显示增加的金币与经验", async ({ page }) => {
  await installTauriMock(page, { dailySignedToday: false, dailyCheckMessage: "Jcoin:40 EXP:40" });

  await page.goto("/#/home/daily");

  await expect(page.getByText("9月-签到活动")).toBeVisible();
  await expect(page.locator('[data-daily-status="unsigned"]')).toContainText("今天还没签到");
  await expect(page.locator('[data-daily-status="unsigned"]')).toContainText("连续进度 14.3%");

  await page.getByRole("button", { name: "立即签到", exact: true }).click();

  // 用数据属性定位奖励块，避免和 Toast 里的文案撞车
  await expect(page.locator('[data-daily-reward="coin"]')).toHaveText(/\+40 金币/);
  await expect(page.locator('[data-daily-reward="exp"]')).toHaveText(/\+40 经验/);
  // 重新拉取后今天应变成已签到
  await expect(page.locator('[data-daily-status="signed"]')).toContainText("明天再来");
  await shot(page, "daily-checkin-success");

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const calls = (window as any).__mockInvokeCalls as Array<{ cmd: string; args: any }>;
        return calls
          .filter((x) => x.cmd === "api_daily_check")
          .map((x) => ({ userId: x.args?.userId, dailyId: String(x.args?.dailyId ?? "") }));
      }),
    )
    .toEqual([{ userId: "10001", dailyId: "72" }]);
});

test("今天已签到时签到页给出提示而不是奖励", async ({ page }) => {
  await installTauriMock(page, {
    dailySignedToday: true,
    dailyCheckMessage: "今天已經簽到過了",
  });

  await page.goto("/#/home/daily");

  await expect(page.locator('[data-daily-status="signed"]')).toContainText("明天再来");
  // 日历里今天那一格应标记为已签到
  const today = String(new Date().getDate()).padStart(2, "0");
  await expect(page.locator(`[data-daily-cell="${today}"]`)).toHaveAttribute(
    "data-daily-signed",
    "1",
  );

  await page.getByRole("button", { name: "再签一次", exact: true }).click();
  await expect(page.locator("[data-daily-message]")).toContainText("今天已經簽到過了");
  await expect(page.locator('[data-daily-reward="coin"]')).toHaveCount(0);
  await expect(page.locator('[data-daily-reward="exp"]')).toHaveCount(0);
});

test("签到页的自动打卡开关会持久化，侧边栏也能进入签到", async ({ page }) => {
  await installTauriMock(page);

  await page.goto("/#/home/home");
  await page.getByRole("link", { name: "签到", exact: true }).click();
  await expect(page).toHaveURL(/\/#\/home\/daily$/);

  const toggle = page.getByRole("checkbox");
  await expect(toggle).not.toBeChecked();
  await toggle.check();

  await expect
    .poll(async () => page.evaluate(() => localStorage.getItem("jm_auto_sign")))
    .toBe("1");

  await page.reload();
  await expect(page.getByRole("checkbox")).toBeChecked();
});

test("手机端底部导航有签到入口", async ({ page }) => {
  await installTauriMock(page);
  await page.setViewportSize({ width: 412, height: 915 });

  await page.goto("/#/home/home");

  const bottomNav = page.locator(".mobile-bottom-nav");
  await expect(bottomNav).toBeVisible();
  await expect(bottomNav.getByText("签到", { exact: true })).toBeVisible();
  await shot(page, "daily-bottom-nav");

  await bottomNav.getByText("签到", { exact: true }).click();
  await expect(page).toHaveURL(/\/#\/home\/daily$/);
});

test("从收藏夹点进本子再返回，仍留在原来的收藏夹与页码", async ({ page }) => {
  await installTauriMock(page, {
    favoriteFolders: [{ id: "2", name: "珍藏夹" }],
    favoritesPageSize: 1,
    favorites: [
      { aid: "30001", title: "Alpha", author: "A", coverUrl: "", addedAt: 1, updatedAt: 1 },
      { aid: "30002", title: "Beta", author: "B", coverUrl: "", addedAt: 2, updatedAt: 2 },
    ],
  });

  await page.goto("/#/home/favorites?folder=2&page=2&sort=mp");

  const sortSelect = page.locator("select").nth(0);
  const folderSelect = page.locator("select").nth(1);
  await expect(sortSelect).toHaveValue("mp");
  await expect(folderSelect).toHaveValue("2");
  await expect(page.getByText("Beta", { exact: true })).toBeVisible();

  await page.getByText("Beta", { exact: true }).click();
  await expect(page).toHaveURL(/\/#\/detail\/30002$/);

  await page.getByRole("button", { name: "返回", exact: true }).click();

  // 返回后收藏夹、页码、排序都还在（以前会掉回默认收藏夹第 1 页）
  await expect(page).toHaveURL(/folder=2/);
  await expect(page).toHaveURL(/page=2/);
  await expect(page).toHaveURL(/sort=mp/);
  await expect(page.locator("select").nth(1)).toHaveValue("2");
  await expect(page.getByText("Beta", { exact: true })).toBeVisible();
  await shot(page, "favorites-folder-restored");

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const calls = (window as any).__mockInvokeCalls as Array<{ cmd: string; args: any }>;
        const fav = calls.filter((x) => x.cmd === "api_favorites");
        const last = fav[fav.length - 1];
        return { folderId: String(last?.args?.folderId ?? ""), page: String(last?.args?.page ?? "") };
      }),
    )
    .toEqual({ folderId: "2", page: "2" });
});

test("收藏夹批量整理：多选后移动到指定收藏夹", async ({ page }) => {
  await installTauriMock(page, {
    favoriteFolders: [{ id: "9", name: "稍后再看" }],
    favorites: [
      { aid: "40001", title: "Alpha", author: "A", coverUrl: "", addedAt: 1, updatedAt: 1 },
      { aid: "40002", title: "Beta", author: "B", coverUrl: "", addedAt: 2, updatedAt: 2 },
      { aid: "40003", title: "Gamma", author: "C", coverUrl: "", addedAt: 3, updatedAt: 3 },
    ],
  });

  await page.goto("/#/home/favorites");
  await page.locator("[data-batch-toggle]").click();

  await page.getByRole("button", { name: "Alpha", exact: true }).click();
  await page.getByRole("button", { name: "Gamma", exact: true }).click();
  await expect(page.locator("[data-batch-bar]")).toContainText("已选 2 个");
  await expect(page.locator('[data-favorite-row="40001"]')).toHaveAttribute(
    "data-favorite-picked",
    "1",
  );

  await page.locator("[data-batch-move]").click();
  await shot(page, "favorites-batch-mode");
  await page.locator('[data-batch-move-target="9"]').click();

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const calls = (window as any).__mockInvokeCalls as Array<{ cmd: string; args: any }>;
        return calls
          .filter((x) => x.cmd === "api_favorite_folder_move")
          .map((x) => ({ aid: String(x.args?.aid ?? ""), folderId: String(x.args?.folderId ?? "") }));
      }),
    )
    .toEqual([
      { aid: "40001", folderId: "9" },
      { aid: "40003", folderId: "9" },
    ]);
});

test("收藏夹批量整理：全选与反选，并可批量取消收藏", async ({ page }) => {
  await installTauriMock(page, {
    favorites: [
      { aid: "41001", title: "Alpha", author: "A", coverUrl: "", addedAt: 1, updatedAt: 1 },
      { aid: "41002", title: "Beta", author: "B", coverUrl: "", addedAt: 2, updatedAt: 2 },
      { aid: "41003", title: "Gamma", author: "C", coverUrl: "", addedAt: 3, updatedAt: 3 },
    ],
  });

  await page.goto("/#/home/favorites");
  await page.locator("[data-batch-toggle]").click();

  await page.getByRole("button", { name: "全选本页", exact: true }).click();
  await expect(page.locator("[data-batch-bar]")).toContainText("已选 3 个");

  await page.getByRole("button", { name: "反选本页", exact: true }).click();
  await expect(page.locator("[data-batch-bar]")).toContainText("已选 0 个");

  await page.getByRole("button", { name: "全选本页", exact: true }).click();
  await page.locator("[data-batch-unfavorite]").click();

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const calls = (window as any).__mockInvokeCalls as Array<{ cmd: string; args: any }>;
        return calls
          .filter((x) => x.cmd === "api_favorite_toggle")
          .map((x) => String(x.args?.aid ?? ""));
      }),
    )
    .toEqual(["41001", "41002", "41003"]);
});

test("收藏夹批量整理：可跨页全选整个收藏夹", async ({ page }) => {
  await installTauriMock(page, {
    favoritesPageSize: 2,
    favorites: [
      { aid: "42001", title: "A1", author: "", coverUrl: "", addedAt: 1, updatedAt: 1 },
      { aid: "42002", title: "A2", author: "", coverUrl: "", addedAt: 2, updatedAt: 2 },
      { aid: "42003", title: "A3", author: "", coverUrl: "", addedAt: 3, updatedAt: 3 },
      { aid: "42004", title: "A4", author: "", coverUrl: "", addedAt: 4, updatedAt: 4 },
      { aid: "42005", title: "A5", author: "", coverUrl: "", addedAt: 5, updatedAt: 5 },
    ],
  });

  await page.goto("/#/home/favorites");
  await page.locator("[data-batch-toggle]").click();

  // 当前页只有 2 条
  await expect(page.locator("[data-favorite-row]")).toHaveCount(2);

  await page.getByRole("button", { name: "全选该收藏夹（所有页）", exact: true }).click();

  await expect(page.locator("[data-batch-bar]")).toContainText("已选 5 个");
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const calls = (window as any).__mockInvokeCalls as Array<{ cmd: string; args: any }>;
        return calls.filter((x) => x.cmd === "api_favorites").map((x) => String(x.args?.page ?? ""));
      }),
    )
    .toEqual(["1", "1", "2", "3"]);
});

