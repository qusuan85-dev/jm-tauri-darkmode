import type { Page } from "@playwright/test";

type MockFavorite = {
  aid: string;
  title: string;
  author: string;
  coverUrl: string;
  addedAt: number;
  updatedAt: number;
  latestChapterSort?: string | null;
};

type MockSearchItem = {
  id: string;
  name: string;
  author: string;
};

type MockLatestItem = Record<string, unknown>;

type MockAlbumChapter = {
  id: string;
  sort?: string | number;
  name?: string;
  images?: string[];
};

/** One entry of the local reading cache (一键缓存). */
type MockCachedAlbum = {
  aid: string;
  bytes?: number;
  files?: number;
  /** Album name stored with the offline metadata; empty mimics "no metadata". */
  title?: string;
  author?: string;
  chapters?: number;
};

type MockOptions = {
  favorites?: MockFavorite[];
  favoriteFolders?: Array<{ id: string; name: string }>;
  albumIsFavorite?: boolean;
  cachedAlbums?: MockCachedAlbum[];
  searchItems?: MockSearchItem[];
  latestItems?: MockLatestItem[];
  promoteBlocks?: unknown[];
  albumId?: string;
  albumSeriesId?: string;
  albumSeries?: MockAlbumChapter[];
  chapterImages?: Record<string, string[]>;
  readProgress?: Record<string, { updatedAt: number; chapterId?: string; pageIndex?: number }>;
  appVersion?: string;
  updateCheckInfo?: {
    currentVersion?: string;
    currentTag?: string | null;
    latestTag?: string | null;
    releaseUrl?: string | null;
    notes?: string | null;
    hasUpdate?: boolean;
    asset?: {
      name: string;
      url: string;
      size: number;
    } | null;
    isDev?: boolean;
    compareMode?: string | null;
  };
  updateDownloadPath?: string;
  latestDelayMs?: number;
  /** 收藏夹：把它当分页接口时每页返回多少条（默认全部返回）。 */
  favoritesPageSize?: number;
  /** 签到：今天是否已签到（决定「今天还没签到 / 已经签过到了」）。 */
  dailySignedToday?: boolean;
  /** 签到接口 /daily_chk 返回的 msg，默认带奖励 "Jcoin:40 EXP:40"。 */
  dailyCheckMessage?: string;
  continuousReading?: boolean;
  /** Number of search results the backend returns per request (default: all). */
  searchPageSize?: number;
  /** Directory reported by `api_export_default_dir`. */
  exportDefaultDir?: string;
};

export async function installTauriMock(page: Page, options: MockOptions = {}) {
  await page.addInitScript((payload: MockOptions) => {
    const favorites = Array.isArray(payload.favorites) ? payload.favorites : [];
    const favoriteFolders = Array.isArray(payload.favoriteFolders) ? payload.favoriteFolders : [];
    const cachedAlbums = Array.isArray(payload.cachedAlbums) ? payload.cachedAlbums : [];
    const searchItems = Array.isArray(payload.searchItems) ? payload.searchItems : [];
    const latestItems = Array.isArray(payload.latestItems) ? payload.latestItems : [];
    const promoteBlocks = Array.isArray(payload.promoteBlocks) ? payload.promoteBlocks : [];
    const albumSeries = Array.isArray(payload.albumSeries) ? payload.albumSeries : [];
    const chapterImages = payload.chapterImages ?? {};
    const readProgress = payload.readProgress ?? {};
    const appVersion =
      typeof payload.appVersion === "string" && payload.appVersion.trim()
        ? payload.appVersion.trim()
        : "0.1.25+dev";
    const latestDelayMs =
      typeof payload.latestDelayMs === "number" && Number.isFinite(payload.latestDelayMs)
        ? Math.max(0, payload.latestDelayMs)
        : 0;
    const updateDownloadPath =
      typeof payload.updateDownloadPath === "string" && payload.updateDownloadPath.trim()
        ? payload.updateDownloadPath.trim()
        : "/tmp/mock-update.bin";

    const defaultSession = {
      user: {
        uid: "10001",
        username: "e2e-user",
        level_name: "LV1",
        level: 1,
        coin: 100,
        favorites: 0,
        can_favorites: 0,
      },
      cookies: {
        AVS: "e2e",
      },
      savedAt: Date.now(),
    };
    const fallbackCoverDataUrl =
      "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

    localStorage.setItem("jm_session_v1", JSON.stringify(defaultSession));
    localStorage.setItem("jm_auto_login", "0");
    localStorage.setItem("jm_save_password", "0");
    localStorage.setItem("jm_read_progress_v1", JSON.stringify(readProgress));
    localStorage.setItem("jm_continuous_reading", payload.continuousReading ? "1" : "0");

    let callbackId = 1;
    let eventListenerId = 1;
    const callbacks = new Map<number, (payload: unknown) => void>();
    const eventListeners = new Map<number, { event: string; handler: number }>();

    (window as any).__mockInvokeCalls = [];
    (window as any).isTauri = true;

    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => {
        // no-op for test mock
      },
    };

    const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

    // ---- daily check-in (签到) -------------------------------------------------
    // 签到成功后会翻转成"已签到"，这样重新拉取 /daily 时的日历与状态才是真实的。
    let dailySignedNow = Boolean(payload.dailySignedToday);
    const dailyCheckMessage =
      typeof payload.dailyCheckMessage === "string" && payload.dailyCheckMessage
        ? payload.dailyCheckMessage
        : "Jcoin:40 EXP:40";

    /** 按当月真实日期造一份打卡日历（过去=未签、今天=按配置、未来=null）。 */
    const buildDailyRecord = () => {
      const now = new Date();
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const today = now.getDate();
      const cells: Array<{ date: string; signed: boolean | null; bonus: boolean }> = [];
      for (let day = 1; day <= daysInMonth; day += 1) {
        cells.push({
          date: String(day).padStart(2, "0"),
          signed: day < today ? false : day === today ? dailySignedNow : null,
          bonus: day === 5,
        });
      }
      const weeks: Array<typeof cells> = [];
      for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
      return weeks;
    };

    const buildDailyInfo = () => ({
      daily_id: 72,
      event_name: "9月-签到活动",
      currentProgress: "14.3%",
      three_days_coin: "150",
      three_days_exp: "150",
      seven_days_coin: "350",
      seven_days_exp: "350",
      record: buildDailyRecord(),
      ...(dailySignedNow ? { error: "finished" } : {}),
    });

    const defaultUpdateCheckInfo = {
      currentVersion: appVersion,
      currentTag: null,
      latestTag: null,
      releaseUrl: "https://github.com/alexsunxl/jm-tauri/releases/latest",
      notes: null,
      hasUpdate: false,
      asset: null,
      isDev: !appVersion.includes("+jm-"),
      compareMode: "tag",
    };

    const updateCheckInfo = {
      ...defaultUpdateCheckInfo,
      ...(payload.updateCheckInfo ?? {}),
    };

    const emitEvent = (event: string, payload: unknown) => {
      for (const [id, listener] of eventListeners.entries()) {
        if (listener.event !== event) continue;
        const cb = callbacks.get(listener.handler);
        if (!cb) continue;
        cb({
          event,
          id,
          payload,
        });
      }
    };

    const invoke = async (cmd: string, args?: Record<string, unknown>) => {
      (window as any).__mockInvokeCalls.push({ cmd, args: args ?? {} });
      switch (cmd) {
        case "api_latest": {
          if (latestDelayMs) await sleep(latestDelayMs);
          return {
            total: latestItems.length,
            content: latestItems,
          };
        }
        case "api_promote": {
          return promoteBlocks;
        }
        case "api_search": {
          // The real search endpoint is paged server-side; mirror that so the
          // frontend's batching / infinite scroll sees distinct pages.
          const page = Math.max(1, Number(args?.page ?? 1) || 1);
          const perPage =
            typeof payload.searchPageSize === "number" && payload.searchPageSize > 0
              ? payload.searchPageSize
              : searchItems.length || 1;
          return {
            total: searchItems.length,
            content: searchItems.slice((page - 1) * perPage, page * perPage),
          };
        }
        case "api_cover_cache": {
          return "/tmp/mock-cover.jpg";
        }
        case "api_comments": {
          return { total: 0, list: [] };
        }
        case "api_daily": {
          return buildDailyInfo();
        }
        case "api_daily_check": {
          const alreadySigned = /已\s*签\s*到|已經簽到|簽到過|已完成/.test(dailyCheckMessage);
          if (!alreadySigned) dailySignedNow = true;
          return { msg: dailyCheckMessage, status: "ok", daily_id: args?.dailyId ?? 72 };
        }
        case "api_export_default_dir": {
          return payload.exportDefaultDir ?? "C:/mock-export/JM";
        }
        case "api_export_album": {
          // Mirrors the Rust command: progress events over time, then a file
          // manifest. The delays matter — the frontend registers its listener
          // asynchronously, so events emitted synchronously would be missed.
          const key = String(args?.exportKey ?? "");
          const dest = String(args?.dest ?? "") || "C:/mock-export/staging";
          const albumDir = `${dest}/Mock Album`;
          const step = (payload: Record<string, unknown>) =>
            emitEvent("export-progress", {
              export_key: key,
              chapter_total: 1,
              chapter_index: 0,
              page: 0,
              page_total: 0,
              failed: 0,
              ...payload,
            });
          step({ phase: "prepare", done: 0, total: 2, message: "正在准备章节…" });
          await sleep(60);
          step({
            phase: "images",
            done: 1,
            total: 2,
            chapter_title: "第一话",
            message: "",
          });
          await sleep(120);
          step({
            phase: "images",
            done: 2,
            total: 2,
            chapter_title: "第一话",
            message: "",
          });
          await sleep(240);
          const pdf = {
            path: `${albumDir}/001-第一话.pdf`,
            rel: "Mock Album/001-第一话.pdf",
            pages: 2,
          };
          return {
            dir: albumDir,
            images: 2,
            failed: 0,
            skipped: [],
            files: [
              { path: `${albumDir}/001-第一话/0001.jpg`, rel: "Mock Album/001-第一话/0001.jpg" },
              { path: pdf.path, rel: pdf.rel },
              ...(args?.wantPdfMerged
                ? [{ path: `${albumDir}/Mock Album.pdf`, rel: "Mock Album/Mock Album.pdf" }]
                : []),
            ],
            pdfs: [pdf],
            merged: args?.wantPdfMerged
              ? { path: `${albumDir}/Mock Album.pdf`, rel: "Mock Album/Mock Album.pdf", pages: 2 }
              : null,
          };
        }
        case "api_favorites": {
          // 真实接口是分页的；带上 favoritesPageSize 就能测「跨页全选」
          const page = Math.max(1, Number(args?.page ?? 1) || 1);
          const perPage =
            typeof payload.favoritesPageSize === "number" && payload.favoritesPageSize > 0
              ? payload.favoritesPageSize
              : favorites.length || 1;
          const slice = favorites.slice((page - 1) * perPage, page * perPage);
          return {
            total: favorites.length,
            list: slice.map((item) => ({
              id: item.aid,
              name: item.title,
              author: item.author,
            })),
            folder_list: favoriteFolders.map((folder) => ({ FID: folder.id, name: folder.name })),
          };
        }
        case "api_favorite_toggle":
        case "api_favorite_folder_add":
        case "api_favorite_folder_move": {
          return { code: 200 };
        }
        case "api_read_cache_list": {
          return cachedAlbums.map((item) => ({
            aid: item.aid,
            files: item.files ?? 1,
            bytes: item.bytes ?? 1024,
            updatedAt: Date.now(),
            newestMs: Date.now(),
          }));
        }
        case "api_read_cache_remove": {
          const aid = String(args?.aid ?? "");
          const index = cachedAlbums.findIndex((item) => item.aid === aid);
          if (index >= 0) cachedAlbums.splice(index, 1);
          return {
            totalBytes: 0,
            totalFiles: 0,
            totalComics: cachedAlbums.length,
            updatedAt: Date.now(),
          };
        }
        case "api_read_offline_cache_get": {
          const aid = String(args?.aid ?? "");
          const entry = cachedAlbums.find((item) => item.aid === aid);
          if (!entry || !entry.title) return null;
          const count = Math.max(0, entry.chapters ?? 0);
          // one stored chapter meta per chapter, so the page can show "已存 N 话"
          const chapters: Record<string, unknown> = {};
          for (let i = 0; i < count; i += 1) {
            chapters[`${aid}${i + 1}`] = { updatedAt: Date.now() };
          }
          return {
            aid,
            album: {
              id: aid,
              name: entry.title,
              author: entry.author ?? "mock",
              series:
                count > 0
                  ? Array.from({ length: count }, (_, i) => ({
                      id: `${aid}${i + 1}`,
                      sort: i + 1,
                      name: `第${i + 1}话`,
                    }))
                  : [],
            },
            chapters,
            updatedAt: Date.now(),
          };
        }
        case "app_update_check": {
          return updateCheckInfo;
        }
        case "app_update_download": {
          const url = typeof args?.url === "string" ? args.url : "";
          const name = typeof args?.name === "string" ? args.name : "update.bin";
          const steps = [8, 37, 76, 100];
          for (const percent of steps) {
            emitEvent("app-update-download-progress", {
              url,
              downloadedBytes: percent,
              totalBytes: 100,
              percent,
            });
            await sleep(70);
          }
          return { path: updateDownloadPath, name };
        }
        case "plugin:app|version": {
          return appVersion;
        }
        case "api_config_get": {
          return { socksProxy: null };
        }
        case "api_api_base_current": {
          return "https://a.example.com";
        }
        case "api_api_base_list": {
          return ["https://a.example.com", "https://b.example.com"];
        }
        case "api_read_cache_stats": {
          return {
            totalBytes: 1024,
            totalFiles: 2,
            totalComics: 1,
            updatedAt: Date.now(),
          };
        }
        case "api_album": {
          const aid = String(args?.id ?? "0");
          const albumId = typeof payload.albumId === "string" ? payload.albumId : aid;
          const seriesId = typeof payload.albumSeriesId === "string" ? payload.albumSeriesId : albumId;
          const series = albumSeries.length
            ? albumSeries.map((chapter) => ({
                id: chapter.id,
                sort: chapter.sort,
                name: chapter.name,
              }))
            : [{ id: aid, sort: 1, name: "第1话" }];
          return {
            id: albumId,
            series_id: seriesId,
            name: `AID ${albumId}`,
            author: "mock",
            is_favorite: Boolean(payload.albumIsFavorite),
            series,
          };
        }
        case "api_chapter": {
          const id = String(args?.id ?? "1");
          const configured = albumSeries.find((chapter) => chapter.id === id);
          const images = Array.isArray(chapterImages[id])
            ? chapterImages[id]
            : Array.isArray(configured?.images)
              ? configured.images
              : ["00001.jpg"];
          return {
            id,
            series_id: id,
            name: configured?.name ?? "mock chapter",
            series: [{ id, sort: 1, name: "mock chapter" }],
            images,
          };
        }
        case "api_chapter_scramble_id": {
          return 220980;
        }
        case "api_segmentation_nums": {
          const pictureNames = Array.isArray(args?.pictureNames) ? args.pictureNames : [];
          return pictureNames.map(() => 0);
        }
        case "api_image_descramble_file": {
          return "/tmp/mock-reader-image.jpg";
        }
        case "api_read_offline_cache_upsert_album":
        case "api_read_offline_cache_upsert_chapter":
        case "api_read_progress_upsert":
        case "api_read_progress_clear":
        case "api_read_cancel":
        case "api_session_clear":
        case "api_read_cache_refresh":
        case "api_read_cache_cleanup":
        case "api_config_set_socks_proxy":
        case "api_api_domain_fetch":
        case "api_api_base_select":
        case "api_api_base_latency":
        case "api_read_progress_export":
        case "api_read_progress_import":
        case "plugin:opener|open_url":
        case "plugin:opener|open_path":
        case "plugin:event|unlisten": {
          const eventId = Number(args?.eventId ?? -1);
          eventListeners.delete(eventId);
          return null;
        }
        case "plugin:event|listen": {
          const event = String(args?.event ?? "");
          const handler = Number(args?.handler ?? -1);
          const id = eventListenerId++;
          eventListeners.set(id, { event, handler });
          return id;
        }
        default:
          throw new Error(`Unmocked invoke command: ${cmd}`);
      }
    };

    (window as any).__TAURI_INTERNALS__ = {
      invoke,
      transformCallback: (cb: (payload: unknown) => void) => {
        const id = callbackId++;
        callbacks.set(id, cb);
        return id;
      },
      unregisterCallback: (id: number) => {
        callbacks.delete(id);
      },
      convertFileSrc: () => fallbackCoverDataUrl,
    };
  }, options);
}
