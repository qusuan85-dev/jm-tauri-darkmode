/**
 * Reading source adapter.
 *
 * The reader (`pages/ReadingPage.tsx`) owns everything that is expensive to get
 * right — the virtualised window, the concurrency ramp, page preloading,
 * keyboard shortcuts and progress persistence. The adapter only answers what
 * actually differs:
 *
 *   1. what images make up one reading segment, and how are they ordered,
 *   2. which per-image seed the server needs (JM scrambles its images),
 *   3. how one image becomes something the webview can render,
 *   4. what the work is called and how its cover is found.
 */
import { getImgBase } from "../config/endpoints";
import type { Session } from "../auth/session";

export type ReadImage = {
  /** Source-native identity for the image (the file name). */
  raw: string;
  /** Remote URL the adapter can resolve. */
  url: string;
  /** Name handed to the backend when it needs to derive a scramble seed. */
  pictureName: string;
};

export type SegmentLoad = {
  /** Images of this segment, already ordered and URL-resolved. */
  images: ReadImage[];
  /** Raw source payload, used by the reader to tell "empty" from "loading". */
  raw: unknown;
  /**
   * Seed the backend needs for this segment. Sources that ship plain images
   * report 0, which the reader treats as "no descrambling required".
   */
  scrambleId: number;
  /** Per-image seeds already known (offline replay); null means "go compute". */
  segmentNums: number[] | null;
};

export type ReadingAdapter = {
  id: "jm";

  /** Loads one segment's image list, falling back to the offline cache. */
  loadSegment(params: { aid: string; chapterId: string }): Promise<SegmentLoad>;

  /**
   * Derives the per-image seeds once the image list is known. May persist them
   * for offline replay as a side effect.
   */
  computeSegmentNums(params: {
    aid: string;
    chapterId: string;
    scrambleId: number;
    images: ReadImage[];
    raw: unknown;
  }): Promise<number[] | null>;

  /** Produces a renderable URL (or local path) for a single image. */
  resolveImage(params: {
    aid: string;
    chapterId: string;
    image: ReadImage;
    index: number;
    num: number;
    readKey?: string;
  }): Promise<string>;

  /** Title/author shown in the reader menu and written to progress rows. */
  loadAlbumMeta(params: { aid: string }): Promise<{ title: string; author: string } | null>;

  /** Cover for progress rows. Empty string means "keep whatever is stored". */
  coverUrl(aid: string): string;
};

type Cookies = Session["cookies"];

// ---------------------------------------------------------------- JM helpers

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

function toAuthorText(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(toAuthorText).filter(Boolean).join(", ");
  return "";
}

type JmChapter = { images?: string[] };

type JmOfflineChapterMeta = {
  chapter?: unknown | null;
  scrambleId?: number | null;
  segmentNums?: number[];
};

type JmOfflineCacheMeta = {
  chapters?: Record<string, JmOfflineChapterMeta>;
};

/** Orders the chapter's file names and turns them into reader images. */
function buildJmImages(raw: unknown, chapterId: string): ReadImage[] {
  const list = Array.isArray((raw as JmChapter | null)?.images)
    ? (raw as JmChapter).images!
    : [];
  const sorted = [...list].sort((a, b) => {
    const na = numKey(a);
    const nb = numKey(b);
    if (na == null && nb == null) return a.localeCompare(b);
    if (na == null) return 1;
    if (nb == null) return -1;
    return na - nb;
  });
  return sorted
    .map((p) => ({
      raw: p,
      url: normalizeImgUrl(p, chapterId),
      pictureName: pictureNameFromPath(p),
    }))
    .filter((x) => Boolean(x.url));
}

const JM_DEFAULT_SCRAMBLE_ID = 220980;

// --------------------------------------------------------------- JM adapter

export function createJmReadingAdapter(ctx: { cookies: Cookies }): ReadingAdapter {
  return {
    id: "jm",

    async loadSegment({ aid, chapterId }) {
      const { invoke } = await import("@tauri-apps/api/core");
      let raw: unknown;
      let scrambleId: number;
      try {
        const [chapterRaw, scramble] = await Promise.all([
          invoke<unknown>("api_chapter", { id: chapterId, cookies: ctx.cookies }),
          invoke<number>("api_chapter_scramble_id", { id: chapterId }).catch(
            () => JM_DEFAULT_SCRAMBLE_ID,
          ),
        ]);
        raw = chapterRaw;
        scrambleId = scramble;
        // Remember the segment so a later offline open has something to replay.
        void invoke("api_read_offline_cache_upsert_chapter", {
          aid,
          chapterId,
          chapter: chapterRaw,
          scrambleId: scramble,
          segmentNums: [],
        }).catch(() => {
          // offline metadata is best effort
        });
      } catch (e) {
        const cached = await invoke<JmOfflineCacheMeta | null>(
          "api_read_offline_cache_get",
          { aid },
        ).catch(() => null);
        const cachedChapter = cached?.chapters?.[chapterId];
        if (!cachedChapter?.chapter) throw e;
        raw = cachedChapter.chapter;
        scrambleId = cachedChapter.scrambleId ?? JM_DEFAULT_SCRAMBLE_ID;
        return {
          images: buildJmImages(raw, chapterId),
          raw,
          scrambleId,
          segmentNums: cachedChapter.segmentNums?.length
            ? cachedChapter.segmentNums
            : null,
        };
      }
      return { images: buildJmImages(raw, chapterId), raw, scrambleId, segmentNums: null };
    },

    async computeSegmentNums({ aid, chapterId, scrambleId, images, raw }) {
      const { invoke } = await import("@tauri-apps/api/core");
      const nums = await invoke<number[]>("api_segmentation_nums", {
        epsId: chapterId,
        scrambleId,
        pictureNames: images.map((image) => image.pictureName),
      });
      if (raw) {
        void invoke("api_read_offline_cache_upsert_chapter", {
          aid,
          chapterId,
          chapter: raw,
          scrambleId,
          segmentNums: nums,
        }).catch(() => {
          // offline metadata is best effort
        });
      }
      return nums;
    },

    async resolveImage({ aid, image, num, readKey }) {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<string>("api_image_descramble_file", {
        url: image.url,
        num,
        aid,
        readKey,
      });
    },

    async loadAlbumMeta({ aid }) {
      const { invoke } = await import("@tauri-apps/api/core");
      const raw = await invoke<any>("api_album", { id: aid, cookies: ctx.cookies });
      return {
        title: typeof raw?.name === "string" ? raw.name : "",
        author: toAuthorText(raw?.author),
      };
    },

    coverUrl(aid) {
      return `${getImgBase()}/media/albums/${aid}_3x4.jpg`;
    },
  };
}

export function createReadingAdapter(ctx: { cookies: Cookies }): ReadingAdapter {
  return createJmReadingAdapter(ctx);
}
