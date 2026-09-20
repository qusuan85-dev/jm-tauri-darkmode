import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import useSWR from "swr";
import { ArrowLeft, BookOpen, Download, FolderDown, Loader2, X } from "lucide-react";

import type { Session } from "../auth/session";
import { isAuthExpiredError } from "../auth/errors";
import { refreshCachedAlbums } from "../cache/cachedAlbums";
import Button from "../components/Button";
import { useToast } from "../components/Toast";
import { getImgBase } from "../config/endpoints";
import {
  clearCustomDir,
  copyIntoTree,
  getExportDirMode,
  pickCustomDir,
  pickSupported,
  resolveDefaultDir,
  savedCustomDir,
  setExportDirMode,
  subscribeExportDirChange,
  type ExportDirMode,
} from "../settings/exportDir";
import {
  clearReadProgressAliases,
  coalesceReadProgress,
  getReadProgress,
} from "../reading/progress";
import type { ReadProgress } from "../reading/progress";
import {
  createReadingTarget,
  createReadingWork,
  formatChapterTitle,
  toNavigationId,
} from "../reading/navigation";
import type { ReadingTarget } from "../reading/navigation";
import Loading from "../components/Loading";
import CoverImage from "../components/CoverImage";

type Album = {
  id: string | number;
  series_id?: string | number;
  name?: string;
  author?: unknown;
  tags?: string[];
  description?: string;
  is_favorite?: boolean;
  likes?: number | string;
  total_views?: number | string;
  comment_total?: number | string;
  images?: unknown[];
  series?: Array<{
    id: string | number;
    sort?: string | number;
    name?: string;
  }>;
};

type ComicExtraEntry = {
  id: string;
  pageCount: number;
  updatedAt: number;
};

type OfflineChapterMeta = {
  chapter?: unknown | null;
  scrambleId?: number | null;
  segmentNums?: number[];
  updatedAt?: number;
};

type OfflineCacheMeta = {
  aid: string;
  album?: unknown | null;
  chapters?: Record<string, OfflineChapterMeta>;
  updatedAt?: number;
};

type CommentExpInfo = {
  level_name?: unknown;
  level?: unknown;
};

type CommentItem = {
  CID?: unknown;
  UID?: unknown;
  username?: unknown;
  photo?: unknown;
  content?: unknown;
  likes?: unknown;
  addtime?: unknown;
  replys?: unknown;
  expinfo?: CommentExpInfo;
};

function toId(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "";
}

function toText(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map((x) => toText(x)).filter(Boolean).join(", ");
  return "";
}

function splitAuthors(raw: string): string[] {
  return raw
    .split(/[、,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeAuthorList(v: unknown): string[] {
  if (Array.isArray(v)) {
    const out: string[] = [];
    for (const item of v) {
      const text = toText(item);
      if (!text) continue;
      out.push(...splitAuthors(text));
    }
    return out;
  }
  if (typeof v === "string") return splitAuthors(v);
  if (typeof v === "number") return [String(v)];
  return [];
}

function commentId(item: CommentItem): string {
  return toId((item as any)?.CID ?? (item as any)?.cid ?? (item as any)?.comment_id ?? (item as any)?.commentId);
}

function commentUserName(item: CommentItem): string {
  const name = (item as any)?.username;
  if (typeof name === "string" && name.trim()) return name.trim();
  return "用户";
}

function commentAvatar(item: CommentItem): string {
  const photo = (item as any)?.photo;
  if (typeof photo !== "string") return "";
  if (photo === "nopic-Male.gif" || photo === "nopic-Female.gif") return "";
  return `${getImgBase()}/media/users/${photo}`;
}

function commentLevelText(item: CommentItem): string {
  const info = (item as any)?.expinfo;
  const levelName = typeof info?.level_name === "string" ? info.level_name.trim() : "";
  const levelRaw = info?.level;
  const levelText = typeof levelRaw === "number" || typeof levelRaw === "string" ? String(levelRaw) : "";
  if (levelName && levelText) return `${levelName} · LV${levelText}`;
  if (levelName) return levelName;
  if (levelText) return `LV${levelText}`;
  return "";
}

function commentReplies(item: CommentItem): CommentItem[] {
  const list = (item as any)?.replys ?? (item as any)?.replies;
  return Array.isArray(list) ? (list as CommentItem[]) : [];
}

function sanitizeCommentImageSrc(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("data:")) return "";
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("/")) return `${getImgBase()}${trimmed}`;
  return `${getImgBase()}/${trimmed.replace(/^\.\//, "")}`;
}

function renderCommentContent(raw: unknown): ReactNode {
  const text = toText(raw);
  if (!text) return "";
  if (!/[<&]/.test(text)) return text;
  try {
    const doc = new DOMParser().parseFromString(text, "text/html");
    const nodes: ReactNode[] = [];
    let imgIndex = 0;
    const pushText = (val: string) => {
      if (!val) return;
      nodes.push(val);
    };
    const pushBreak = () => {
      if (!nodes.length) return;
      const last = nodes[nodes.length - 1];
      if (typeof last === "string") {
        if (!last.endsWith("\n")) {
          nodes[nodes.length - 1] = `${last}\n`;
        }
        return;
      }
      nodes.push("\n");
    };
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        pushText(node.textContent ?? "");
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node as Element;
      const tag = el.tagName.toLowerCase();
      if (tag === "br") {
        pushBreak();
        return;
      }
      if (tag === "img") {
        const rawSrc = el.getAttribute("src") ?? el.getAttribute("data-src") ?? "";
        const src = sanitizeCommentImageSrc(rawSrc);
        if (src) {
          nodes.push(
            <img
              key={`comment-img-${imgIndex++}`}
              src={src}
              alt="comment"
              className="mt-2 max-w-full rounded-md border border-zinc-200"
              loading="lazy"
              referrerPolicy="no-referrer"
            />,
          );
          pushBreak();
        }
        return;
      }
      const isBlock = ["div", "p", "section", "article", "li", "ul", "ol"].includes(tag);
      if (isBlock) pushBreak();
      el.childNodes.forEach(walk);
      if (isBlock) pushBreak();
    };
    doc.body.childNodes.forEach(walk);
    return nodes.length ? nodes : text.replace(/<[^>]*>/g, "");
  } catch {
    return text.replace(/<[^>]*>/g, "");
  }
}

function albumCoverUrl(aid: string) {
  return `${getImgBase()}/media/albums/${aid}_3x4.jpg`;
}

function normalizeImgUrl(p: string, chapterId: string) {
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

export default function ComicDetailPage(props: {
  session: Session;
  aid: string;
  onBack: () => void;
  onAuthExpired: () => void;
  onOpenSearch: (query: string) => void;
  onOpenReader: (target: ReadingTarget, startPage?: number) => void;
}) {
  const [toggleBusy, setToggleBusy] = useState(false);
  const [favSheetOpen, setFavSheetOpen] = useState(false);
  const [favFolders, setFavFolders] = useState<Array<{ id: string; name: string }>>([]);
  const [favFoldersLoading, setFavFoldersLoading] = useState(false);
  const [favFoldersError, setFavFoldersError] = useState("");
  const [favBusyFolderId, setFavBusyFolderId] = useState("");
  const [newFavFolderName, setNewFavFolderName] = useState("");
  const [favCreating, setFavCreating] = useState(false);
  const [usingOfflineAlbum, setUsingOfflineAlbum] = useState(false);
  const [progress, setProgress] = useState<ReadProgress | null>(() => getReadProgress(props.aid));
  const [comicPageCount, setComicPageCount] = useState<number | null>(null);
  const [comicPageLoading, setComicPageLoading] = useState(false);
  const [cacheDownloading, setCacheDownloading] = useState(false);
  const [cacheProgress, setCacheProgress] = useState<{ done: number; total: number; failed: number } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportImages, setExportImages] = useState(true);
  const [exportPdfChapter, setExportPdfChapter] = useState(true);
  const [exportPdfMerged, setExportPdfMerged] = useState(false);
  const [exportMode, setExportModeState] = useState<ExportDirMode>(() => getExportDirMode());
  const [exportCustomLabel, setExportCustomLabel] = useState(() => savedCustomDir()?.label ?? "");
  const [exportDefaultDir, setExportDefaultDir] = useState("");
  const [exportProgress, setExportProgress] = useState<{
    done: number;
    total: number;
    failed: number;
    chapter: string;
    message: string;
  } | null>(null);
  const [exportSummary, setExportSummary] = useState("");
  const [exportError, setExportError] = useState("");
  const exportKeyRef = useRef("");
  const canPickDir = pickSupported();
  const [commentPage, setCommentPage] = useState(1);
  const [commentInput, setCommentInput] = useState("");
  const [commentReplyTo, setCommentReplyTo] = useState<CommentItem | null>(null);
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentActionError, setCommentActionError] = useState("");
  const [commentPageSize, setCommentPageSize] = useState(0);
  const { showToast } = useToast();

  const {
    data: albumData,
    error: albumError,
    isValidating,
    mutate,
  } = useSWR(
    ["album", props.aid, props.session.cookies],
    async ([, aid, cookies]) => {
      const { invoke } = await import("@tauri-apps/api/core");
      const cacheAid = String(aid);
      try {
        const raw = await invoke<unknown>("api_album", { id: aid, cookies });
        setUsingOfflineAlbum(false);
        const work = createReadingWork(raw as Album, cacheAid);
        void invoke("api_read_offline_cache_upsert_album", {
          aid: work.workId || cacheAid,
          album: raw,
        }).catch(() => {
          // ignore offline metadata write failures
        });
        return raw;
      } catch (e) {
        const cached = await invoke<OfflineCacheMeta | null>("api_read_offline_cache_get", {
          aid: cacheAid,
        }).catch(() => null);
        if (cached?.album) {
          setUsingOfflineAlbum(true);
          return cached.album;
        }
        throw e;
      }
    },
    {
      revalidateOnFocus: false,
      onError: (err) => {
        if (isAuthExpiredError(err)) {
          props.onAuthExpired();
        }
      },
    },
  );
  const album = (albumData as Album) ?? null;
  const readingWork = useMemo(() => createReadingWork(album, props.aid), [album, props.aid]);
  const rootAid = readingWork.workId || props.aid;
  const chapters = readingWork.chapters;
  const isSingle = Boolean(album) && readingWork.kind === "single";

  const coverUrl = useMemo(() => albumCoverUrl(rootAid), [rootAid]);

  const {
    data: commentData,
    error: commentError,
    isValidating: commentValidating,
    mutate: mutateComments,
  } = useSWR(
    album && rootAid && !usingOfflineAlbum ? ["comments", rootAid, commentPage, props.session.cookies] : null,
    async ([, aid, page, cookies]) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<any>("api_comments", {
        aid: String(aid),
        page: String(page),
        cookies,
      });
    },
    {
      keepPreviousData: true,
      revalidateOnFocus: false,
      onError: (err) => {
        if (isAuthExpiredError(err)) {
          props.onAuthExpired();
        }
      },
    },
  );

  useEffect(() => {
    setUsingOfflineAlbum(false);
    setProgress(getReadProgress(props.aid));
  }, [props.aid]);

  useEffect(() => {
    setCommentPage(1);
    setCommentInput("");
    setCommentReplyTo(null);
    setCommentActionError("");
    setCommentPageSize(0);
  }, [rootAid]);

  const loadFavoriteFolders = useCallback(async () => {
    setFavFoldersLoading(true);
    setFavFoldersError("");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const data = await invoke<any>("api_favorites", {
        page: "1",
        sort: "mr",
        folderId: "0",
        cookies: props.session.cookies,
      });
      const list = Array.isArray(data?.folder_list) ? data.folder_list : [];
      const folders = list
        .map((f: any) => ({
          id: f?.FID != null ? String(f.FID) : "",
          name: typeof f?.name === "string" ? f.name : "",
        }))
        .filter((f: { id: string; name: string }) => f.id && f.name);
      setFavFolders(folders);
    } catch (e) {
      if (isAuthExpiredError(e)) {
        props.onAuthExpired();
        return;
      }
      setFavFoldersError(e instanceof Error ? e.message : String(e));
    } finally {
      setFavFoldersLoading(false);
    }
  }, [props.onAuthExpired, props.session.cookies]);

  useEffect(() => {
    if (!favSheetOpen) return;
    void loadFavoriteFolders();
  }, [favSheetOpen, loadFavoriteFolders]);

  const title = album?.name ?? `漫画 ${props.aid}`;
  const authorText = useMemo(() => toText(album?.author), [album?.author]);
  const authorList = useMemo(() => normalizeAuthorList(album?.author), [album?.author]);
  const tags = useMemo(() => (Array.isArray(album?.tags) ? album!.tags! : []), [album]);
  const singleChapterId = useMemo(() => {
    if (!isSingle) return "";
    return toNavigationId(chapters[0]?.id) || rootAid;
  }, [chapters, isSingle, rootAid]);
  const errorText =
    albumError && !isAuthExpiredError(albumError)
      ? albumError instanceof Error
        ? albumError.message
        : String(albumError)
      : "";
  const loading = isValidating && !album;
  const commentErrorText =
    commentError && !isAuthExpiredError(commentError)
      ? commentError instanceof Error
        ? commentError.message
        : String(commentError)
      : "";
  const commentLoading = commentValidating && !commentData;
  const commentList: CommentItem[] = Array.isArray(commentData?.list) ? commentData.list : [];
  const commentTotal = useMemo(() => {
    const raw = commentData?.total ?? commentData?.count ?? commentData?.total_num;
    if (raw == null) return null;
    const num = Number(raw);
    return Number.isFinite(num) ? num : null;
  }, [commentData]);
  const commentMaxPage = useMemo(() => {
    const raw = commentData?.page_count ?? commentData?.pageCount ?? commentData?.pages;
    const num = Number(raw);
    if (Number.isFinite(num) && num > 0) return num;
    const total = commentTotal;
    const pageSize = commentPageSize || commentList.length;
    if (total != null && pageSize > 0) return Math.max(1, Math.ceil(total / pageSize));
    return null;
  }, [commentData, commentList.length, commentPageSize, commentTotal]);
  const commentHasNext = useMemo(() => {
    if (commentMaxPage != null) return commentPage < commentMaxPage;
    return commentList.length > 0;
  }, [commentList.length, commentMaxPage, commentPage]);

  useEffect(() => {
    if (commentList.length > commentPageSize) {
      setCommentPageSize(commentList.length);
    }
  }, [commentList.length, commentPageSize]);

  useEffect(() => {
    if (!album || !rootAid) return;
    try {
      const result = coalesceReadProgress(rootAid, readingWork.aliases, {
        title: album.name,
        coverUrl,
      });
      setProgress(result.progress);
      if (!result.progress) return;
      void (async () => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("api_read_progress_upsert", { entry: result.progress });
          await Promise.all(
            result.removedAids.map((aid) => invoke("api_read_progress_clear", { aid })),
          );
        } catch {
          // ignore native progress migration failures
        }
      })();
    } catch {
      // ignore unavailable localStorage
    }
  }, [album, coverUrl, readingWork.aliases, rootAid]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!isSingle || !rootAid || !singleChapterId) {
        setComicPageCount(null);
        setComicPageLoading(false);
        return;
      }
      setComicPageLoading(true);
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const cached = await invoke<ComicExtraEntry | null>("api_comic_extra_get", { id: rootAid });
        if (cancelled) return;
        if (cached && typeof cached.pageCount === "number") {
          setComicPageCount(cached.pageCount);
          setComicPageLoading(false);
          return;
        }
        const count = await invoke<number>("api_comic_page_count", {
          id: rootAid,
          chapter_id: singleChapterId,
          cookies: props.session.cookies,
        });
        if (cancelled) return;
        setComicPageCount(Number.isFinite(count) ? count : 0);
      } catch {
        if (!cancelled) setComicPageCount(null);
      } finally {
        if (!cancelled) setComicPageLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [isSingle, props.session.cookies, rootAid, singleChapterId]);

  const openChapter = useCallback(
    (chapter: (typeof chapters)[number], startPage = 1) => {
      const target = createReadingTarget(readingWork, chapter);
      if (!target) return;
      props.onOpenReader(target, startPage);
    },
    [props.onOpenReader, readingWork],
  );

  const progressChapter = useMemo(() => {
    if (!progress?.chapterId) return null;
    return chapters.find((chapter) => toNavigationId(chapter.id) === progress.chapterId) ?? null;
  }, [chapters, progress?.chapterId]);

  const jumpToProgress = useCallback(() => {
    if (!progressChapter) return;
    openChapter(progressChapter, progress?.pageIndex ?? 1);
  }, [openChapter, progress?.pageIndex, progressChapter]);

  const startOrResumeReading = useCallback(() => {
    const chapter = progressChapter ?? chapters[0];
    if (!chapter) return;
    openChapter(chapter, progressChapter ? progress?.pageIndex ?? 1 : 1);
  }, [chapters, openChapter, progress?.pageIndex, progressChapter]);

  const clearProgress = useCallback(() => {
    try {
      clearReadProgressAliases(readingWork.aliases);
      setProgress(null);
      void (async () => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await Promise.all(
            readingWork.aliases.map((aid) => invoke("api_read_progress_clear", { aid })),
          );
        } catch {
          // ignore
        }
      })();
      showToast({ ok: true, text: "已清除阅读记录" });
    } catch {
      showToast({ ok: false, text: "清除失败（localStorage不可用）" });
    }
  }, [readingWork.aliases, showToast]);

  /**
   * Saves the album into the chosen favourites folder.
   *
   * The mobile API has no "favourite with folder" call, so a fresh favourite is
   * added first and then moved; an existing favourite is only moved.
   */
  const saveToFavoriteFolder = useCallback(
    async (folderId: string, folderName: string) => {
      if (!album) return;
      const wasFavorite = Boolean(album.is_favorite);
      if (folderId === "0" && wasFavorite) {
        setFavSheetOpen(false);
        return;
      }
      setFavBusyFolderId(folderId);
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        if (!wasFavorite) {
          await invoke("api_favorite_toggle", { aid: rootAid, cookies: props.session.cookies });
        }
        if (folderId !== "0") {
          await invoke("api_favorite_folder_move", {
            aid: rootAid,
            folderId,
            cookies: props.session.cookies,
          });
        }
        await mutate();
        setFavSheetOpen(false);
        showToast({
          ok: true,
          text: wasFavorite ? `已移动到「${folderName}」` : `已收藏到「${folderName}」`,
        });
      } catch (e) {
        if (isAuthExpiredError(e)) {
          props.onAuthExpired();
          return;
        }
        const msg = e instanceof Error ? e.message : String(e);
        showToast({ ok: false, text: `收藏失败：${msg}` });
      } finally {
        setFavBusyFolderId("");
      }
    },
    [album, mutate, props.onAuthExpired, props.session.cookies, rootAid, showToast],
  );

  const toggleFavorite = useCallback(async () => {
    if (!album) return;
    setToggleBusy(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("api_favorite_toggle", { aid: rootAid, cookies: props.session.cookies });
      await mutate();
      setFavSheetOpen(false);
      showToast({ ok: true, text: "已取消收藏" });
    } catch (e) {
      if (isAuthExpiredError(e)) {
        props.onAuthExpired();
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      showToast({ ok: false, text: `取消收藏失败：${msg}` });
    } finally {
      setToggleBusy(false);
    }
  }, [album, mutate, props.onAuthExpired, props.session.cookies, rootAid, showToast]);

  const createFavoriteFolder = useCallback(async () => {
    const name = newFavFolderName.trim();
    if (!name) return;
    setFavCreating(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("api_favorite_folder_add", { name, cookies: props.session.cookies });
      setNewFavFolderName("");
      await loadFavoriteFolders();
      showToast({ ok: true, text: `已新建收藏夹「${name}」` });
    } catch (e) {
      if (isAuthExpiredError(e)) {
        props.onAuthExpired();
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      setFavFoldersError(msg);
    } finally {
      setFavCreating(false);
    }
  }, [loadFavoriteFolders, newFavFolderName, props.onAuthExpired, props.session.cookies, showToast]);

  const cacheAll = useCallback(async () => {
    if (!album || chapters.length === 0) return;
    setCacheDownloading(true);
    setCacheProgress({ done: 0, total: 0, failed: 0 });
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const cacheAid = rootAid;
      void invoke("api_cover_cache", { url: coverUrl }).catch(() => {
        // best-effort cover cache for offline detail display
      });
      await invoke("api_read_offline_cache_upsert_album", {
        aid: cacheAid,
        album,
      });
      let done = 0;
      let failed = 0;
      let total = 0;
      const cacheJobs: Array<{ chapterId: string; images: string[]; nums: number[] }> = [];
      for (const chapter of chapters) {
        const chapterId = toId(chapter.id) || rootAid;
        if (!chapterId) continue;
        const [raw, scramble] = await Promise.all([
          invoke<any>("api_chapter", { id: chapterId, cookies: props.session.cookies }),
          invoke<number>("api_chapter_scramble_id", { id: chapterId }).catch(() => 220980),
        ]);
        const imagePaths = Array.isArray(raw?.images) ? raw.images.filter((x: unknown): x is string => typeof x === "string") : [];
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
          aid: cacheAid,
          chapterId,
          chapter: raw,
          scrambleId: scramble,
          segmentNums: nums,
        });
        total += sorted.length;
        cacheJobs.push({ chapterId, images: sorted, nums });
      }
      setCacheProgress({ done, total, failed });
      for (const job of cacheJobs) {
        for (let i = 0; i < job.images.length; i += 1) {
          try {
            await invoke<string>("api_image_descramble_file", {
              url: normalizeImgUrl(job.images[i], job.chapterId),
              num: job.nums[i] ?? 0,
              aid: cacheAid,
              readKey: undefined,
            });
          } catch {
            failed += 1;
          } finally {
            done += 1;
            setCacheProgress({ done, total, failed });
          }
        }
      }
      await invoke("api_read_cache_refresh");
      void refreshCachedAlbums();
      showToast({ ok: failed === 0, text: failed === 0 ? "缓存下载完成" : `缓存完成，失败 ${failed} 张` });
    } catch (e) {
      if (isAuthExpiredError(e)) {
        props.onAuthExpired();
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      showToast({ ok: false, text: `缓存失败：${msg}` });
    } finally {
      setCacheDownloading(false);
    }
  }, [album, chapters, coverUrl, props.onAuthExpired, props.session.cookies, rootAid, showToast]);

  // Destination shown in the export panel.
  useEffect(() => {
    if (!exportOpen) return;
    let cancelled = false;
    void (async () => {
      try {
        const dir = await resolveDefaultDir();
        if (!cancelled) setExportDefaultDir(dir);
      } catch {
        // The default destination is only informational.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [exportOpen]);

  useEffect(() => {
    return subscribeExportDirChange(() => setExportCustomLabel(savedCustomDir()?.label ?? ""));
  }, []);

  // Live progress from the Rust export task.
  useEffect(() => {
    if (!exportBusy) return;
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const unlisten = await listen<any>("export-progress", (event) => {
        const payload = event.payload ?? {};
        if (payload.export_key && exportKeyRef.current && payload.export_key !== exportKeyRef.current) {
          return;
        }
        setExportProgress({
          done: Number(payload.done) || 0,
          total: Number(payload.total) || 0,
          failed: Number(payload.failed) || 0,
          chapter: typeof payload.chapter_title === "string" ? payload.chapter_title : "",
          message: typeof payload.message === "string" ? payload.message : "",
        });
      });
      if (cancelled) unlisten();
      else dispose = unlisten;
    })();
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [exportBusy]);

  const chooseExportDir = useCallback(async () => {
    const label = await pickCustomDir();
    if (!label) return;
    setExportCustomLabel(label);
    setExportModeState("custom");
    setExportDirMode("custom");
  }, []);

  const useDefaultExportDir = useCallback(() => {
    setExportModeState("default");
    setExportDirMode("default");
  }, []);

  const cancelExport = useCallback(async () => {
    if (!exportKeyRef.current) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("api_read_cancel", { readKey: exportKeyRef.current });
    } catch {
      // ignore
    }
  }, []);

  const runExport = useCallback(async () => {
    if (!album || chapters.length === 0) return;
    if (!exportImages && !exportPdfChapter && !exportPdfMerged) {
      showToast({ ok: false, text: "请至少选择一种导出内容" });
      return;
    }
    const key = `export-${Date.now()}`;
    exportKeyRef.current = key;
    setExportBusy(true);
    setExportSummary("");
    setExportError("");
    setExportProgress({ done: 0, total: 0, failed: 0, chapter: "", message: "正在准备章节…" });
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const useCustom = exportMode === "custom" && Boolean(exportCustomLabel);
      // A SAF folder can only be written through Android's document API, so the
      // Rust side stages the files and we stream them across afterwards.
      const dest = useCustom ? "" : await resolveDefaultDir();
      const chapterInputs = chapters.map((chapter, index) => ({
        id: toId(chapter.id) || rootAid,
        title: chapter.name ?? `第${index + 1}话`,
      }));

      const result = await invoke<any>("api_export_album", {
        albumName: album.name ?? `AID ${rootAid}`,
        chapters: chapterInputs,
        cookies: props.session.cookies,
        // Chapter responses carry bare file names; the backend prefixes this
        // base (same value the reader and the offline cache use).
        imgBase: getImgBase(),
        dest,
        wantImages: exportImages,
        wantPdfChapter: exportPdfChapter,
        wantPdfMerged: exportPdfMerged,
        exportKey: key,
      });
      if (isAuthExpiredError(result)) return;

      const pdfCount = (result?.pdfs?.length ?? 0) + (result?.merged ? 1 : 0);
      const skipped: string[] = Array.isArray(result?.skipped) ? result.skipped : [];
      const skippedNote = skipped.length ? ` · 跳过 ${skipped.length} 章` : "";
      if (useCustom) {
        const files: Array<{ path: string; rel: string }> = Array.isArray(result?.files)
          ? result.files
          : [];
        let copied = 0;
        for (const file of files) {
          const failure = copyIntoTree(file.rel, file.path);
          if (failure) throw new Error(failure);
          copied += 1;
          setExportProgress({
            done: copied,
            total: files.length,
            failed: 0,
            chapter: "",
            message: `正在复制到所选目录 ${copied}/${files.length}`,
          });
        }
        setExportSummary(
          `已导出到「${exportCustomLabel}」：${result?.images ?? 0} 张图片 · ${pdfCount} 个 PDF${skippedNote}`,
        );
      } else {
        setExportSummary(
          `已导出到 ${result?.dir ?? dest}：${result?.images ?? 0} 张图片 · ${pdfCount} 个 PDF${skippedNote}`,
        );
      }
      if (skipped.length) {
        setExportError(`以下章节被跳过：${skipped.slice(0, 5).join("；")}${skipped.length > 5 ? " …" : ""}`);
      }
      if (result?.failed) {
        showToast({ ok: false, text: `导出完成，失败 ${result.failed} 张` });
      } else {
        showToast({ ok: true, text: "导出完成" });
      }
    } catch (e) {
      if (isAuthExpiredError(e)) {
        props.onAuthExpired();
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("cancelled")) {
        setExportSummary("已取消导出");
      } else {
        // Keep the reason on screen: a toast disappears before it can be read.
        setExportError(msg);
        showToast({ ok: false, text: `导出失败：${msg}` });
      }
    } finally {
      exportKeyRef.current = "";
      setExportBusy(false);
    }
  }, [
    album,
    chapters,
    exportCustomLabel,
    exportImages,
    exportMode,
    exportPdfChapter,
    exportPdfMerged,
    props.onAuthExpired,
    props.session.cookies,
    rootAid,
    showToast,
  ]);

  const sendComment = useCallback(async () => {
    const text = commentInput.trim();
    if (!text) {
      showToast({ ok: false, text: "请输入评论内容" });
      return;
    }
    if (!rootAid) return;
    setCommentBusy(true);
    setCommentActionError("");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const replyId = commentReplyTo ? commentId(commentReplyTo) : "";
      await invoke("api_comment_send", {
        aid: rootAid,
        comment: text,
        commentId: replyId || undefined,
        cookies: props.session.cookies,
      });
      setCommentInput("");
      setCommentReplyTo(null);
      setCommentPage(1);
      await Promise.all([mutateComments(), mutate()]);
      showToast({ ok: true, text: "评论已发送" });
    } catch (e) {
      if (isAuthExpiredError(e)) {
        props.onAuthExpired();
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      setCommentActionError(msg);
      showToast({ ok: false, text: `发表评论失败：${msg}` });
    } finally {
      setCommentBusy(false);
    }
  }, [
    commentInput,
    commentReplyTo,
    mutate,
    mutateComments,
    props.onAuthExpired,
    props.session.cookies,
    rootAid,
    showToast,
  ]);

  return (
    <div className="safe-area-top min-h-screen bg-zinc-100 p-4 text-zinc-900 sm:p-6">
      <div className="mx-auto flex w-full min-w-0 max-w-[900px] flex-col gap-4">
        <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <div className="break-words text-base font-semibold text-zinc-900">
                {title}
              </div>
              {usingOfflineAlbum ? (
                <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                  离线缓存
                </span>
              ) : null}
            </div>
            <div className="break-words text-sm text-zinc-600">
              {authorText ? `作者：${authorText}` : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 md:justify-end">
            <Button
              className="h-9 rounded-md bg-zinc-900 px-3 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
              disabled={!album || !chapters.length}
              onClick={startOrResumeReading}
            >
              <BookOpen className="h-4 w-4" />
              {progressChapter ? "继续阅读" : isSingle ? "开始阅读" : "从第1话开始"}
            </Button>
            <button
              type="button"
              className="inline-flex h-9 items-center gap-1 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
              onClick={props.onBack}
            >
              <ArrowLeft className="h-4 w-4" />
              返回
            </button>
            <Button
              className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
              disabled={cacheDownloading || !album}
              loading={cacheDownloading}
              onClick={cacheAll}
            >
              <span className="inline-flex items-center gap-1">
                {!cacheDownloading ? <Download className="h-4 w-4" /> : null}
                {cacheDownloading && cacheProgress
                  ? cacheProgress.total > 0
                    ? `缓存 ${cacheProgress.done}/${cacheProgress.total}`
                    : "准备缓存"
                  : "一键缓存"}
              </span>
            </Button>
            <Button
              className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
              disabled={!album || exportBusy}
              loading={exportBusy}
              onClick={() => setExportOpen((v) => !v)}
            >
              <span className="inline-flex items-center gap-1">
                {!exportBusy ? <FolderDown className="h-4 w-4" /> : null}
                导出
              </span>
            </Button>
            <Button
              className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
              disabled={!album}
              onClick={() => setFavSheetOpen((v) => !v)}
            >
              {album?.is_favorite ? "已收藏 · 移动" : "收藏"}
            </Button>
          </div>
        </div>

        {errorText ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-3 text-sm text-red-600 shadow-sm">
            {errorText}
          </div>
        ) : null}

        {favSheetOpen ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="text-sm font-medium text-zinc-900">
                {album?.is_favorite ? "移动到收藏夹" : "收藏到收藏夹"}
              </div>
              <button
                type="button"
                className="rounded-full p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700"
                aria-label="关闭收藏夹面板"
                onClick={() => setFavSheetOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {favFoldersError ? (
              <div className="mb-2 rounded-md border border-zinc-200 bg-white p-2 text-sm text-red-600">
                {favFoldersError}
              </div>
            ) : null}

            {favFoldersLoading ? (
              <div className="text-sm text-zinc-500">正在读取收藏夹…</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {!album?.is_favorite ? (
                  <button
                    type="button"
                    className="inline-flex h-8 items-center gap-1 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
                    disabled={!!favBusyFolderId}
                    onClick={() => void saveToFavoriteFolder("0", "默认收藏夹")}
                  >
                    {favBusyFolderId === "0" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    默认收藏夹
                  </button>
                ) : null}
                {favFolders.map((folder) => (
                  <button
                    key={folder.id}
                    type="button"
                    className="inline-flex h-8 items-center gap-1 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
                    disabled={!!favBusyFolderId}
                    onClick={() => void saveToFavoriteFolder(folder.id, folder.name)}
                  >
                    {favBusyFolderId === folder.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    {folder.name}
                  </button>
                ))}
                {favFolders.length === 0 ? (
                  <div className="text-sm text-zinc-500">
                    {album?.is_favorite
                      ? "还没有其它收藏夹，先在下面新建一个。"
                      : "还没有自定义收藏夹，先收藏到默认收藏夹也可以。"}
                  </div>
                ) : null}
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                className="h-8 min-w-[160px] flex-1 rounded-md border border-zinc-200 bg-white px-3 text-sm"
                placeholder="新建收藏夹名称"
                value={newFavFolderName}
                onChange={(e) => setNewFavFolderName(e.currentTarget.value)}
              />
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
                disabled={!newFavFolderName.trim() || favCreating}
                onClick={() => void createFavoriteFolder()}
              >
                {favCreating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                新建
              </button>
              {album?.is_favorite ? (
                <button
                  type="button"
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-zinc-200 bg-white px-3 text-sm text-red-600 hover:bg-zinc-50 disabled:opacity-60"
                  disabled={toggleBusy || !!favBusyFolderId}
                  onClick={() => void toggleFavorite()}
                >
                  {toggleBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  取消收藏
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {cacheDownloading && cacheProgress ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-600 shadow-sm">
            {cacheProgress.total > 0
              ? `正在缓存：${cacheProgress.done}/${cacheProgress.total}`
              : "正在准备缓存..."}
            {cacheProgress.failed ? ` · 失败 ${cacheProgress.failed}` : ""}
          </div>
        ) : null}

        {exportOpen ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="text-sm font-medium text-zinc-900">导出到目录</div>
              <button
                type="button"
                className="rounded-full p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-60"
                aria-label="关闭导出面板"
                disabled={exportBusy}
                onClick={() => setExportOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="text-xs text-zinc-500">目标目录</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className={[
                  "h-8 rounded-md border px-3 text-xs font-medium",
                  exportMode === "default"
                    ? "border-transparent bg-zinc-900 text-white"
                    : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50",
                ].join(" ")}
                onClick={useDefaultExportDir}
              >
                默认位置
              </button>
              <button
                type="button"
                className={[
                  "h-8 rounded-md border px-3 text-xs font-medium disabled:opacity-60",
                  exportMode === "custom" && exportCustomLabel
                    ? "border-transparent bg-zinc-900 text-white"
                    : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50",
                ].join(" ")}
                disabled={!canPickDir || exportBusy}
                onClick={() => void chooseExportDir()}
              >
                {exportCustomLabel ? `自定义：${exportCustomLabel}` : "选择目录…"}
              </button>
              {exportCustomLabel ? (
                <button
                  type="button"
                  className="h-8 rounded-md border border-zinc-200 bg-white px-3 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
                  disabled={exportBusy}
                  onClick={() => {
                    clearCustomDir();
                    setExportCustomLabel("");
                    useDefaultExportDir();
                  }}
                >
                  清除
                </button>
              ) : null}
            </div>
            <div className="mt-2 truncate text-xs text-zinc-500">
              {exportMode === "custom" && exportCustomLabel
                ? `导出到所选文件夹：${exportCustomLabel}`
                : exportDefaultDir
                  ? `导出到 ${exportDefaultDir}`
                  : "正在解析默认目录…"}
            </div>
            {!canPickDir ? (
              <div className="mt-1 text-xs text-zinc-400">
                当前平台不支持选择自定义目录，将使用默认位置。
              </div>
            ) : null}

            <div className="mt-4 text-xs text-zinc-500">导出内容</div>
            <div className="mt-2 flex flex-wrap gap-4 text-sm text-zinc-700">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={exportImages}
                  onChange={(e) => setExportImages(e.currentTarget.checked)}
                />
                解密原图
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={exportPdfChapter}
                  onChange={(e) => setExportPdfChapter(e.currentTarget.checked)}
                />
                每章一个 PDF
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={exportPdfMerged}
                  onChange={(e) => setExportPdfMerged(e.currentTarget.checked)}
                />
                整本合并 PDF
              </label>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                className="h-9 rounded-md bg-zinc-900 px-3 text-sm font-medium text-white disabled:opacity-60"
                loading={exportBusy}
                disabled={exportBusy || !album}
                onClick={() => void runExport()}
              >
                {exportBusy ? "导出中…" : "开始导出"}
              </Button>
              {exportBusy ? (
                <button
                  type="button"
                  className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm text-red-600 hover:bg-zinc-50"
                  onClick={() => void cancelExport()}
                >
                  取消
                </button>
              ) : null}
            </div>

            {exportProgress ? (
              <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-2 text-xs text-zinc-600">
                {exportProgress.message ? `${exportProgress.message} · ` : ""}
                {exportProgress.total > 0 ? `${exportProgress.done}/${exportProgress.total}` : ""}
                {exportProgress.chapter ? ` · ${exportProgress.chapter}` : ""}
                {exportProgress.failed ? ` · 失败 ${exportProgress.failed}` : ""}
              </div>
            ) : null}
            {exportSummary ? (
              <div className="mt-2 break-all text-xs text-zinc-600">{exportSummary}</div>
            ) : null}
            {exportError ? (
              <div className="mt-2 break-all rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-600">
                {exportError}
              </div>
            ) : null}
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-600 shadow-sm">
            <Loading />
          </div>
        ) : null}

        {album ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[320px_1fr]">
            <div className="flex flex-col gap-3">
              <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="mb-3 text-sm font-medium text-zinc-900">封面</div>
                <div className="relative">
                  <CoverImage
                    src={coverUrl}
                    alt={title}
                    aid={rootAid}
                    className="w-full rounded-md border border-zinc-200 bg-zinc-50 object-cover"
                  />
                </div>
              </div>

              <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-sm font-medium text-zinc-900">阅读记录</div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-sm text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
                      onClick={jumpToProgress}
                      disabled={!progress?.chapterId}
                    >
                      继续阅读
                    </button>
                    <button
                      type="button"
                      className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-sm text-zinc-900 hover:bg-zinc-50"
                      onClick={clearProgress}
                    >
                      清除
                    </button>
                  </div>
                </div>
                <div className="space-y-1 text-sm text-zinc-700">
                  <div>
                    最近阅读：{" "}
                    {progress?.updatedAt
                      ? new Date(progress.updatedAt).toLocaleString()
                      : "—"}
                  </div>
                  <div>
                    最近章节：{" "}
                    {progress?.chapterSort != null
                      ? `第${progress.chapterSort}话${progress.chapterName ? `：${progress.chapterName}` : ""}`
                      : "—"}
                  </div>
                  <div>
                    最近页：{" "}
                    {progress?.pageIndex != null ? `第${progress.pageIndex}页` : "—"}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="mb-3 text-sm font-medium text-zinc-900">信息</div>
                <div className="space-y-1 text-sm text-zinc-700">
                  <div>作品ID：{rootAid}</div>
                  {props.aid !== rootAid ? <div>入口ID：{props.aid}</div> : null}
                  <div>
                    类型：{isSingle ? "单话" : "多话"}
                    {!isSingle ? ` · 共 ${chapters.length} 话` : ""}
                  </div>
                  {isSingle ? (
                    <div className="flex items-center gap-2">
                      <span>漫画页数：</span>
                      {comicPageLoading ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <span>{comicPageCount != null ? comicPageCount : "—"}</span>
                      )}
                    </div>
                  ) : null}
                  <div>点赞：{String(album.likes ?? "—")}</div>
                  <div>浏览：{String(album.total_views ?? "—")}</div>
                  <div>评论：{String(album.comment_total ?? "—")}</div>
                </div>
              </div>

              <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="mb-3 text-sm font-medium text-zinc-900">标签</div>
                <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-zinc-700">
                  {tags.length ? (
                    tags.map((t) => (
                      <button
                        key={t}
                        type="button"
                        className="rounded-full border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
                        onClick={() => props.onOpenSearch(t)}
                      >
                        {t}
                      </button>
                    ))
                  ) : (
                    <span className="text-zinc-500">—</span>
                  )}
                </div>
                <div className="mb-3 text-sm font-medium text-zinc-900">作者</div>
                <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-700">
                  {authorList.length ? (
                    authorList.map((name) => (
                      <button
                        key={name}
                        type="button"
                        className="rounded-full border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
                        onClick={() => props.onOpenSearch(name)}
                      >
                        {name}
                      </button>
                    ))
                  ) : (
                    <span className="text-zinc-500">—</span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="mb-3 text-sm font-medium text-zinc-900">简介</div>
                <div className="whitespace-pre-wrap text-sm text-zinc-700">
                  {album.description || "—"}
                </div>

                <div className="mt-4 mb-2 text-sm font-medium text-zinc-900">章节</div>
                <div className="flex flex-wrap gap-2">
                  {chapters.length ? (
                    chapters.map((c) => (
                      <button
                        key={toNavigationId(c.id)}
                        type="button"
                        className="inline-flex items-center rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 hover:bg-zinc-50"
                        onClick={() => openChapter(c, 1)}
                      >
                        {formatChapterTitle(c)}
                      </button>
                    ))
                  ) : (
                    <div className="text-sm text-zinc-600">暂无章节信息</div>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium text-zinc-900">
                      评论{commentTotal != null ? `（${commentTotal}）` : ""}
                    </div>
                    <div className="text-xs text-zinc-500">第 {commentPage} 页</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-sm text-zinc-900 hover:bg-zinc-50"
                      onClick={() => setCommentPage((p) => Math.max(1, p - 1))}
                      disabled={commentLoading || commentPage <= 1}
                    >
                      上一页
                    </button>
                    <button
                      type="button"
                      className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-sm text-zinc-900 hover:bg-zinc-50"
                      onClick={() => setCommentPage((p) => p + 1)}
                      disabled={commentLoading || !commentHasNext}
                    >
                      下一页
                    </button>
                    <button
                      type="button"
                      className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-sm text-zinc-900 hover:bg-zinc-50"
                      onClick={() => void mutateComments()}
                      disabled={commentLoading}
                    >
                      刷新
                    </button>
                  </div>
                </div>

                <div className="mb-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
                  {commentReplyTo ? (
                    <div className="mb-2 flex items-center justify-between text-xs text-zinc-500">
                      <span>回复 @ {commentUserName(commentReplyTo)}</span>
                      <button
                        type="button"
                        className="text-xs text-zinc-500 hover:text-zinc-700"
                        onClick={() => setCommentReplyTo(null)}
                        disabled={commentBusy}
                      >
                        取消回复
                      </button>
                    </div>
                  ) : null}
                  <textarea
                    className="h-24 w-full resize-none rounded-md border border-zinc-200 bg-white p-2 text-sm text-zinc-900 placeholder:text-zinc-400"
                    placeholder="写下你的评论..."
                    value={commentInput}
                    onChange={(e) => setCommentInput(e.currentTarget.value)}
                    disabled={commentBusy}
                  />
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="text-xs text-zinc-500">
                      {commentBusy ? "正在发送..." : "发表评论"}
                    </div>
                    <Button
                      className="h-8 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
                      disabled={commentBusy || !commentInput.trim()}
                      loading={commentBusy}
                      onClick={sendComment}
                    >
                      发送
                    </Button>
                  </div>
                  {commentActionError ? (
                    <div className="mt-2 text-xs text-red-600">{commentActionError}</div>
                  ) : null}
                </div>

                {commentErrorText ? (
                  <div className="mb-3 rounded-md border border-zinc-200 bg-white p-2 text-sm text-red-600">
                    {commentErrorText}
                  </div>
                ) : null}

                {commentLoading ? (
                  <Loading />
                ) : commentList.length ? (
                  <div className="flex flex-col gap-3">
                    {commentList.map((item, idx) => {
                      const cid = commentId(item) || `comment-${idx}`;
                      const avatar = commentAvatar(item);
                      const name = commentUserName(item);
                      const level = commentLevelText(item);
                      const time = toText((item as any)?.addtime);
                      const content = renderCommentContent((item as any)?.content) || "—";
                      const likes = toText((item as any)?.likes);
                      const replies = commentReplies(item);
                      return (
                        <div
                          key={`${cid}-${idx}`}
                          className="rounded-md border border-zinc-200 bg-white p-3"
                        >
                          <div className="flex items-start gap-3">
                            {avatar ? (
                              <img
                                src={avatar}
                                alt={name}
                                className="h-9 w-9 flex-none rounded-full border border-zinc-200 object-cover"
                                loading="lazy"
                              />
                            ) : (
                              <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full border border-zinc-200 bg-zinc-50 text-xs text-zinc-400">
                                用户
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-medium text-zinc-900">{name}</span>
                                {level ? (
                                  <span className="text-xs text-zinc-500">{level}</span>
                                ) : null}
                                {time ? (
                                  <span className="text-xs text-zinc-400">{time}</span>
                                ) : null}
                              </div>
                              <div className="mt-1 whitespace-pre-wrap text-sm text-zinc-700">{content}</div>
                              <div className="mt-2 flex items-center gap-3 text-xs text-zinc-500">
                                {likes ? <span>赞 {likes}</span> : null}
                                <button
                                  type="button"
                                  className="text-xs text-zinc-500 hover:text-zinc-700"
                                  onClick={() => setCommentReplyTo(item)}
                                  disabled={commentBusy}
                                >
                                  回复
                                </button>
                              </div>
                            </div>
                          </div>

                          {replies.length ? (
                            <div className="mt-3 space-y-2 border-l-2 border-zinc-100 pl-3">
                              {replies.map((reply, ridx) => {
                                const rid = commentId(reply) || `reply-${ridx}`;
                                const rname = commentUserName(reply);
                                const rlevel = commentLevelText(reply);
                                const rtime = toText((reply as any)?.addtime);
                                const rcontent = renderCommentContent((reply as any)?.content) || "—";
                                const rlikes = toText((reply as any)?.likes);
                                return (
                                  <div key={`${rid}-${ridx}`} className="rounded-md bg-zinc-50 p-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="text-xs font-medium text-zinc-900">{rname}</span>
                                      {rlevel ? (
                                        <span className="text-[11px] text-zinc-500">{rlevel}</span>
                                      ) : null}
                                      {rtime ? (
                                        <span className="text-[11px] text-zinc-400">{rtime}</span>
                                      ) : null}
                                    </div>
                                    <div className="mt-1 whitespace-pre-wrap text-xs text-zinc-700">
                                      {rcontent}
                                    </div>
                                    <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500">
                                      {rlikes ? <span>赞 {rlikes}</span> : null}
                                      <button
                                        type="button"
                                        className="text-[11px] text-zinc-500 hover:text-zinc-700"
                                        onClick={() => setCommentReplyTo(reply)}
                                        disabled={commentBusy}
                                      >
                                        回复
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-sm text-zinc-600">暂无评论</div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
