/**
 * 已缓存：everything the local reading cache holds, with covers and titles.
 *
 * The cache list itself only stores ids and byte counts, so each row is enriched
 * with the album metadata the 一键缓存 flow saved alongside it. When that metadata
 * is missing (pages that were cached by simply reading them) the title is filled in
 * from the API when that is possible, and the row falls back to its AID offline.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Play, Trash2 } from "lucide-react";

import type { Session } from "../auth/session";
import Button from "../components/Button";
import CoverImage from "../components/CoverImage";
import ListViewToggle from "../components/ListViewToggle";
import Loading from "../components/Loading";
import { useToast } from "../components/Toast";
import { refreshCachedAlbums } from "../cache/cachedAlbums";
import { getImgBase } from "../config/endpoints";
import { getReadProgress } from "../reading/progress";

type CachedListItem = {
  aid?: string | number;
  files?: number;
  bytes?: number;
  updatedAt?: number;
  newestMs?: number;
};

type OfflineChapterMeta = {
  chapter?: unknown;
  updatedAt?: number;
};

type OfflineMeta = {
  aid?: string;
  album?: {
    name?: unknown;
    author?: unknown;
    series?: Array<{ id?: string | number; sort?: string | number; name?: string }>;
  } | null;
  chapters?: Record<string, OfflineChapterMeta>;
};

type CachedRow = {
  aid: string;
  bytes: number;
  files: number;
  newestMs: number;
  title: string;
  author: string;
  chapters: Array<{ id: string; sort?: string | number; name?: string }>;
  cachedChapters: number;
};

type CachedSort = "newest" | "size" | "title";

const viewKey = "jm_view_cached";
const sortKey = "jm_sort_cached";
/** Titles learned from the API in this session, so revisiting is instant. */
const titleCache = new Map<string, { title: string; author: string }>();

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function toText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string").join(" / ");
  return "";
}

function chapterLabel(c: { sort?: string | number; name?: string }): string {
  return `第${c.sort ?? "?"}话${c.name ? `：${c.name}` : ""}`;
}

/** Runs `worker` over `items` with a small concurrency cap. */
async function mapLimited<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      out[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return out;
}

export default function CachedPage(props: {
  session: Session;
  onOpenComic: (aid: string) => void;
  onOpenReader: (
    aid: string,
    chapterId: string,
    chapterTitle: string,
    chapters: Array<{ id: string | number; sort?: string | number; name?: string }>,
    startPage?: number,
  ) => void;
}) {
  const [viewMode, setViewMode] = useState<"list" | "card">(() => {
    try {
      return localStorage.getItem(viewKey) === "card" ? "card" : "list";
    } catch {
      return "list";
    }
  });
  const [sortMode, setSortMode] = useState<CachedSort>(() => {
    try {
      const v = localStorage.getItem(sortKey);
      return v === "size" || v === "title" ? v : "newest";
    } catch {
      return "newest";
    }
  });
  const [rows, setRows] = useState<CachedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [deleting, setDeleting] = useState<Record<string, boolean>>({});
  const [openReaderLoading, setOpenReaderLoading] = useState<Record<string, boolean>>({});
  const mounted = useRef(true);
  const { showToast } = useToast();

  useEffect(() => {
    try {
      localStorage.setItem(viewKey, viewMode);
    } catch {
      // ignore
    }
  }, [viewMode]);

  useEffect(() => {
    try {
      localStorage.setItem(sortKey, sortMode);
    } catch {
      // ignore
    }
  }, [sortMode]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setError("");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const list = await invoke<CachedListItem[]>("api_read_cache_list");
      const items = (Array.isArray(list) ? list : []).filter(
        (item) => item?.aid != null && String(item.aid).trim(),
      );

      const built = await mapLimited(items, 6, async (item): Promise<CachedRow> => {
        const aid = String(item.aid).trim();
        let meta: OfflineMeta | null = null;
        try {
          meta = await invoke<OfflineMeta | null>("api_read_offline_cache_get", { aid });
        } catch {
          meta = null;
        }
        const series = Array.isArray(meta?.album?.series) ? meta!.album!.series : [];
        const chapters = series
          .map((c) => ({
            id: c?.id != null ? String(c.id) : "",
            sort: c?.sort,
            name: typeof c?.name === "string" ? c.name : undefined,
          }))
          .filter((c) => c.id);

        const offlineTitle = toText(meta?.album?.name).trim();
        const offlineAuthor = toText(meta?.album?.author).trim();
        let title = offlineTitle;
        let author = offlineAuthor;
        if (!title) {
          const learned = titleCache.get(aid);
          if (learned) {
            title = learned.title;
            author = learned.author;
          }
        }
        return {
          aid,
          bytes: Number(item.bytes ?? 0) || 0,
          files: Number(item.files ?? 0) || 0,
          newestMs: Number(item.newestMs ?? item.updatedAt ?? 0) || 0,
          title,
          author,
          chapters: chapters.length
            ? chapters
            : [{ id: aid, sort: 1, name: "" }],
          cachedChapters: meta?.chapters ? Object.keys(meta.chapters).length : 0,
        };
      });

      if (!mounted.current) return;
      setRows(built);

      // Best effort: fill in titles the cache does not know about. Failures are
      // expected offline and simply leave the AID as the label.
      const missing = built.filter((row) => !row.title);
      if (missing.length) {
        const learned = await mapLimited(missing, 4, async (row) => {
          try {
            const album = await invoke<{ name?: unknown; author?: unknown }>("api_album", {
              id: row.aid,
              cookies: props.session.cookies,
            });
            const title = toText(album?.name).trim();
            if (!title) return null;
            const entry = { title, author: toText(album?.author).trim() };
            titleCache.set(row.aid, entry);
            return { aid: row.aid, ...entry };
          } catch {
            return null;
          }
        });
        if (!mounted.current) return;
        const found = learned.filter((v): v is { aid: string; title: string; author: string } => !!v);
        if (found.length) {
          const byAid = new Map(found.map((v) => [v.aid, v]));
          setRows((prev) =>
            prev.map((row) => {
              const hit = byAid.get(row.aid);
              return hit ? { ...row, title: hit.title, author: hit.author } : row;
            }),
          );
        }
      }
    } catch (e) {
      if (!mounted.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [props.session.cookies]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const keyword = filter.trim().toLowerCase();
    const filtered = keyword
      ? rows.filter(
          (row) =>
            row.title.toLowerCase().includes(keyword) || row.aid.toLowerCase().includes(keyword),
        )
      : rows;
    const sorted = [...filtered];
    if (sortMode === "size") sorted.sort((a, b) => b.bytes - a.bytes);
    else if (sortMode === "title") sorted.sort((a, b) => (a.title || a.aid).localeCompare(b.title || b.aid));
    else sorted.sort((a, b) => b.newestMs - a.newestMs);
    return sorted;
  }, [filter, rows, sortMode]);

  const totalBytes = useMemo(() => rows.reduce((sum, row) => sum + row.bytes, 0), [rows]);

  const openReader = async (row: CachedRow) => {
    setOpenReaderLoading((prev) => ({ ...prev, [row.aid]: true }));
    try {
      const progress = getReadProgress("jm", row.aid);
      const chapters = row.chapters.length ? row.chapters : [{ id: row.aid, sort: 1, name: "" }];
      const target =
        progress?.chapterId != null
          ? chapters.find((c) => String(c.id) === String(progress.chapterId))
          : null;
      const chosen = target ?? chapters[0];
      props.onOpenReader(
        row.aid,
        String(chosen.id),
        chapterLabel(chosen),
        chapters,
        target ? progress?.pageIndex ?? 1 : 1,
      );
    } finally {
      setOpenReaderLoading((prev) => ({ ...prev, [row.aid]: false }));
    }
  };

  const remove = async (row: CachedRow) => {
    setDeleting((prev) => ({ ...prev, [row.aid]: true }));
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("api_read_cache_remove", { aid: row.aid });
      setRows((prev) => prev.filter((r) => r.aid !== row.aid));
      void refreshCachedAlbums();
      showToast({ ok: true, text: `已删除缓存：${row.title || row.aid}` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast({ ok: false, text: `删除缓存失败：${msg}` });
    } finally {
      setDeleting((prev) => ({ ...prev, [row.aid]: false }));
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-600 shadow-sm">
        已缓存 · {rows.length} 个本子 · 共 {formatBytes(totalBytes)}
        {visible.length !== rows.length ? ` · 筛选出 ${visible.length} 个` : ""}
      </div>

      <div className="min-w-0 overflow-hidden rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="h-9 min-w-[160px] flex-1 rounded-md border border-zinc-200 bg-white px-3 text-sm"
            placeholder="按标题或 AID 筛选"
            value={filter}
            onChange={(e) => setFilter(e.currentTarget.value)}
          />
          <select
            className="h-9 rounded-md border border-zinc-200 bg-white px-2 text-sm"
            value={sortMode}
            onChange={(e) => setSortMode(e.currentTarget.value as CachedSort)}
          >
            <option value="newest">最近缓存</option>
            <option value="size">占用大小</option>
            <option value="title">标题</option>
          </select>
          <button
            type="button"
            className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm hover:bg-zinc-50 disabled:opacity-60"
            onClick={() => void load()}
            disabled={loading}
          >
            刷新
          </button>
          <ListViewToggle value={viewMode} onChange={setViewMode} />
        </div>

        {error ? (
          <div className="mt-3 rounded-md border border-zinc-200 bg-white p-2 text-sm text-red-600">
            {error}
          </div>
        ) : null}

        {loading && rows.length === 0 ? (
          <Loading />
        ) : visible.length === 0 ? (
          <div className="mt-4 rounded-md border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-500">
            {rows.length === 0
              ? "还没有缓存的本子。在漫画详情页点「一键缓存」，或在阅读时让它自动缓存即可。"
              : "没有符合筛选条件的本子。"}
          </div>
        ) : viewMode === "card" ? (
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
            {visible.map((row) => (
              <div
                key={row.aid}
                className="flex h-full flex-col overflow-hidden rounded-md border border-zinc-200 bg-white"
              >
                <button
                  type="button"
                  className="relative aspect-[3/4] w-full overflow-hidden bg-zinc-100"
                  onClick={() => props.onOpenComic(row.aid)}
                >
                  <CoverImage
                    src={`${getImgBase()}/media/albums/${row.aid}_3x4.jpg`}
                    alt={row.title || row.aid}
                    className="h-full w-full object-cover"
                  />
                </button>
                <div className="flex flex-1 flex-col gap-1 p-2">
                  <button
                    type="button"
                    className="line-clamp-2 text-left text-sm font-medium text-zinc-900 hover:underline"
                    onClick={() => props.onOpenComic(row.aid)}
                  >
                    {row.title || `本子 ${row.aid}`}
                  </button>
                  <div className="truncate text-xs text-zinc-600">
                    {row.author ? `作者：${row.author}` : `AID：${row.aid}`}
                  </div>
                  <div className="truncate text-xs text-zinc-500">
                    {formatBytes(row.bytes)} · {row.files} 个文件
                    {row.cachedChapters ? ` · 已存 ${row.cachedChapters} 话` : ""}
                  </div>
                  <div className="mt-auto flex items-center gap-2">
                    <Button
                      className="h-7 flex-1 rounded-md border border-zinc-200 bg-white text-xs text-zinc-900 hover:bg-zinc-50"
                      onClick={() => void openReader(row)}
                      loading={!!openReaderLoading[row.aid]}
                    >
                      阅读
                    </Button>
                    <Button
                      className="h-7 flex-1 rounded-md border border-zinc-200 bg-white text-xs text-red-600 hover:bg-zinc-50"
                      onClick={() => void remove(row)}
                      loading={!!deleting[row.aid]}
                    >
                      删除
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3 flex min-w-0 flex-col gap-2">
            {visible.map((row) => (
              <div
                key={row.aid}
                className="flex min-w-0 items-center gap-3 overflow-hidden rounded-md border border-zinc-200 bg-white px-3 py-2"
              >
                <div className="relative h-16 w-12 flex-none overflow-hidden rounded bg-zinc-100">
                  <CoverImage
                    src={`${getImgBase()}/media/albums/${row.aid}_3x4.jpg`}
                    alt={row.title || row.aid}
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    className="line-clamp-2 w-full text-left text-sm font-medium text-zinc-900 hover:underline"
                    onClick={() => props.onOpenComic(row.aid)}
                  >
                    {row.title || `本子 ${row.aid}`}
                  </button>
                  <div className="truncate text-xs text-zinc-600">
                    {row.author ? `${row.author} · ` : ""}AID：{row.aid}
                  </div>
                  <div className="truncate text-xs text-zinc-500">
                    {formatBytes(row.bytes)} · {row.files} 个文件
                    {row.cachedChapters ? ` · 已存 ${row.cachedChapters} 话` : ""}
                    {row.newestMs ? ` · ${new Date(row.newestMs).toLocaleDateString()}` : ""}
                  </div>
                </div>
                <div className="flex flex-none items-center gap-2">
                  <button
                    type="button"
                    className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-md border border-zinc-200 bg-white px-2 text-sm text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
                    onClick={() => void openReader(row)}
                    disabled={!!openReaderLoading[row.aid]}
                  >
                    {openReaderLoading[row.aid] ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                    阅读
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-md border border-zinc-200 bg-white px-2 text-sm text-red-600 hover:bg-zinc-50 disabled:opacity-60"
                    onClick={() => void remove(row)}
                    disabled={!!deleting[row.aid]}
                  >
                    {deleting[row.aid] ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
