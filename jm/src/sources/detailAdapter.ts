/**
 * Detail source adapter.
 *
 * The album detail screen is large because it carries a lot of behaviour, not
 * because it is source-specific. The adapter normalises its source into the
 * album shape the screen already understands (id / series_id / name / author /
 * tags / series), so the shared page keeps working unchanged and only the
 * handful of genuinely different operations go through the adapter:
 *
 *   - album metadata (with an offline fallback),
 *   - comments,
 *   - favourite state,
 *   - page count,
 *   - the "cache everything" download.
 */
import type { Session } from "../auth/session";
import { getImgBase } from "../config/endpoints";

export type DetailChapter = {
  id: string | number;
  sort?: string | number;
  name?: string;
};

/** Album shaped the way the shared detail page already consumes it. */
export type DetailAlbum = {
  id: string;
  series_id?: string;
  name?: string;
  author?: unknown;
  tags?: string[];
  series?: DetailChapter[];
  is_favorite?: boolean;
  comment_total?: number | string;
};

export type DetailComment = {
  id: string;
  userName: string;
  avatar: string;
  content: unknown;
  levelText: string;
  replies: DetailComment[];
};

export type CacheResult = { done: number; total: number; failed: number };

/** Everything the shared export panel reports on, from either backend. */
export type ExportAlbumResult = {
  dir?: string;
  images?: number;
  failed?: number;
  skipped?: string[];
  files?: Array<{ path: string; rel: string }>;
  pdfs?: unknown[];
  merged?: unknown;
};

export type DetailCapabilities = {
  /** Folder picker / "move to folder" in the favourite sheet. */
  favoriteFolders: boolean;
  /** Image + PDF export panel. */
  exportAlbum: boolean;
  /** A separate page-count probe. */
  pageCount: boolean;
  comments: boolean;
};

export type DetailAdapter = {
  id: "jm";
  /** Prefix for the raw id label. */
  idLabel: string;
  capabilities: DetailCapabilities;

  /** Loads album metadata, falling back to the offline copy when offline. */
  loadAlbum(params: { aid: string; token?: string }): Promise<{
    album: DetailAlbum;
    fromCache: boolean;
  }>;

  /** Cover for the header; empty string when one cannot be produced. */
  coverUrl(params: { aid: string; token?: string }): Promise<string>;

  toggleFavorite(params: { aid: string; token?: string }): Promise<void>;

  pageCount?(params: { aid: string }): Promise<number | null>;

  loadComments?(params: { aid: string; token?: string; page: number }): Promise<{
    list: DetailComment[];
    total: number | null;
  }>;

  sendComment?(params: {
    aid: string;
    token?: string;
    content: string;
    replyToId?: string;
  }): Promise<void>;

  /**
   * Downloads every segment into the local read cache. `onProgress` is called
   * as work completes so the button can show live counts.
   */
  cacheAll(params: {
    aid: string;
    token?: string;
    series: DetailChapter[];
    onProgress: (progress: CacheResult) => void;
  }): Promise<CacheResult>;

  /** Rebuilds the cached-size index after a download. */
  refreshCacheIndex(): Promise<void>;

  /**
   * Writes the album to `dest`; an empty `dest` stages it for a SAF folder.
   * Implementations emit `export-progress` events the shared panel listens to.
   */
  exportAlbum?(params: {
    aid: string;
    albumName: string;
    chapters: DetailChapter[];
    dest: string;
    wantImages: boolean;
    wantPdfChapter: boolean;
    wantPdfMerged: boolean;
    exportKey: string;
  }): Promise<ExportAlbumResult>;
};

type Cookies = Session["cookies"];

function toText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join(", ");
  return "";
}

// ------------------------------------------------------------- JM helpers

function normalizeImgUrl(p: string, chapterId: string): string {
  if (!p) return "";
  if (p.startsWith("http://") || p.startsWith("https://")) return p;
  const base = getImgBase();
  if (p.startsWith("/")) return `${base}${p}`;
  return `${base}/media/photos/${chapterId}/${p}`;
}

function numKey(s: string): number | null {
  const m = s.match(/\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function pictureNameFromPath(p: string): string {
  const base = p.split("/").pop() ?? p;
  return base.split(".")[0] ?? "";
}

function commentId(item: any): string {
  const raw = item?.CID ?? item?.cid ?? item?.id;
  return typeof raw === "string" || typeof raw === "number" ? String(raw) : "";
}

function mapJmComments(list: unknown): DetailComment[] {
  const rows = Array.isArray(list) ? list : [];
  return rows.map((item: any) => ({
    id: commentId(item),
    userName: toText(item?.username) || "匿名",
    avatar: toText(item?.photo),
    content: item?.content ?? "",
    levelText: toText(item?.expinfo?.level_name),
    replies: mapJmComments(item?.replys),
  }));
}

// --------------------------------------------------------------- JM adapter

export function createJmDetailAdapter(ctx: { cookies: Cookies }): DetailAdapter {
  return {
    id: "jm",
    idLabel: "AID",
    capabilities: {
      favoriteFolders: true,
      exportAlbum: true,
      pageCount: true,
      comments: true,
    },

    async loadAlbum({ aid }) {
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        const raw = await invoke<any>("api_album", { id: aid, cookies: ctx.cookies });
        void invoke("api_read_offline_cache_upsert_album", { aid, album: raw }).catch(() => {
          // offline metadata is best effort
        });
        return { album: raw as DetailAlbum, fromCache: false };
      } catch (e) {
        const cached = await invoke<any | null>("api_read_offline_cache_get", {
          aid,
        }).catch(() => null);
        if (cached?.album) {
          return { album: cached.album as DetailAlbum, fromCache: true };
        }
        throw e;
      }
    },

    async coverUrl({ aid }) {
      return `${getImgBase()}/media/albums/${aid}_3x4.jpg`;
    },

    async toggleFavorite({ aid }) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("api_favorite_toggle", { aid, cookies: ctx.cookies });
    },

    async pageCount({ aid }) {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<number>("api_comic_page_count", { id: aid, cookies: ctx.cookies });
    },

    async loadComments({ aid, page }) {
      const { invoke } = await import("@tauri-apps/api/core");
      const data = await invoke<any>("api_comments", {
        aid,
        page: String(page),
        cookies: ctx.cookies,
      });
      const raw = data?.total ?? data?.count ?? data?.total_num;
      const total = raw == null ? null : Number(raw);
      return {
        list: mapJmComments(data?.list),
        total: total != null && Number.isFinite(total) ? total : null,
      };
    },

    async sendComment({ aid, content, replyToId }) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("api_comment_send", {
        aid,
        comment: content,
        commentId: replyToId,
        cookies: ctx.cookies,
      });
    },

    async cacheAll({ aid, series, onProgress }) {
      const { invoke } = await import("@tauri-apps/api/core");
      const jobs: Array<{ chapterId: string; images: string[]; nums: number[] }> = [];
      let total = 0;

      for (const chapter of series) {
        const chapterId = toText(chapter.id) || aid;
        if (!chapterId) continue;
        const [raw, scramble] = await Promise.all([
          invoke<any>("api_chapter", { id: chapterId, cookies: ctx.cookies }),
          invoke<number>("api_chapter_scramble_id", { id: chapterId }).catch(() => 220980),
        ]);
        const imagePaths = Array.isArray(raw?.images)
          ? raw.images.filter((x: unknown): x is string => typeof x === "string")
          : [];
        const sorted = [...imagePaths].sort((a, b) => {
          const na = numKey(a);
          const nb = numKey(b);
          if (na == null && nb == null) return a.localeCompare(b);
          if (na == null) return 1;
          if (nb == null) return -1;
          return na - nb;
        });
        const nums = await invoke<number[]>("api_segmentation_nums", {
          epsId: chapterId,
          scrambleId: scramble,
          pictureNames: sorted.map(pictureNameFromPath),
        });
        await invoke("api_read_offline_cache_upsert_chapter", {
          aid,
          chapterId,
          chapter: raw,
          scrambleId: scramble,
          segmentNums: nums,
        });
        total += sorted.length;
        jobs.push({ chapterId, images: sorted, nums });
      }

      let done = 0;
      let failed = 0;
      onProgress({ done, total, failed });
      for (const job of jobs) {
        for (let i = 0; i < job.images.length; i += 1) {
          try {
            await invoke<string>("api_image_descramble_file", {
              url: normalizeImgUrl(job.images[i], job.chapterId),
              num: job.nums[i] ?? 0,
              aid,
              readKey: undefined,
            });
          } catch {
            failed += 1;
          } finally {
            done += 1;
            onProgress({ done, total, failed });
          }
        }
      }
      return { done, total, failed };
    },

    async refreshCacheIndex() {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("api_read_cache_refresh");
    },

    async exportAlbum({
      albumName,
      chapters,
      dest,
      wantImages,
      wantPdfChapter,
      wantPdfMerged,
      exportKey,
    }) {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke("api_export_album", {
        albumName,
        chapters,
        cookies: ctx.cookies,
        // Chapter responses carry bare file names; the backend prefixes this
        // base (same value the reader and the offline cache use).
        imgBase: getImgBase(),
        dest,
        wantImages,
        wantPdfChapter,
        wantPdfMerged,
        exportKey,
      });
    },
  };
}

export function createDetailAdapter(ctx: { cookies: Cookies }): DetailAdapter {
  return createJmDetailAdapter({ cookies: ctx.cookies });
}
