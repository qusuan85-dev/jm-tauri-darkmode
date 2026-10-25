import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import useSWR from "swr";
import { ChevronRight, RefreshCw, Search } from "lucide-react";

import type { Session } from "../auth/session";
import { isAuthExpiredError } from "../auth/errors";
import CoverImage from "../components/CoverImage";
import EmptyState from "../components/EmptyState";
import ListViewToggle from "../components/ListViewToggle";
import Loading from "../components/Loading";
import PageHeader from "../components/PageHeader";
import { getImgBase } from "../config/endpoints";
import { type ViewMode, usePersistedViewMode } from "../hooks/usePersistedViewMode";
import { readJsonStorage, removeStorage, writeJsonStorage } from "../utils/storage";

type RawRecord = Record<string, unknown>;

type HomeComicCard = {
  aid: string;
  title: string;
  author: string;
  category: string;
  cover: string;
};

/** Top-level categories offered as a filter row on 发现. */
const HOME_FILTERS = ["全部", "日漫", "同人", "单行本"];

const HOME_LATEST_CACHE_PREFIX = "jm_home_latest_v1";
const HOME_LATEST_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const HOME_VIEW_KEY = "jm_view_home_latest";

type PersistedLatest = {
  savedAt: number;
  data: unknown;
};

function isRecord(value: unknown): value is RawRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => toText(item))
      .filter(Boolean)
      .join(", ");
  }
  if (isRecord(value)) {
    return pickText(value, ["name", "title"]);
  }
  return "";
}

function pickText(item: RawRecord, keys: string[]): string {
  for (const key of keys) {
    const text = toText(item[key]);
    if (text) return text;
  }
  return "";
}

function extractList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!isRecord(raw)) return [];

  const keys = ["content", "list", "data", "albums", "items", "results"];
  for (const key of keys) {
    const value = raw[key];
    if (Array.isArray(value)) return value;
  }
  for (const key of keys) {
    const value = raw[key];
    if (isRecord(value)) {
      const nested = extractList(value);
      if (nested.length) return nested;
    }
  }
  return [];
}

function normalizeCover(src: string, aid: string): string {
  const base = getImgBase().replace(/\/$/, "");
  if (src) {
    if (/^https?:\/\//i.test(src)) return src;
    if (src.startsWith("//")) return `https:${src}`;
    if (src.startsWith("/")) return `${base}${src}`;
    if (src.startsWith("media/")) return `${base}/${src}`;
    return src;
  }
  return aid ? `${base}/media/albums/${aid}_3x4.jpg` : "";
}

function normalizeLatestItem(item: RawRecord, idx: number): HomeComicCard {
  const aid = pickText(item, ["id", "aid", "album_id", "albumId", "comic_id", "comicId"]);
  const title =
    pickText(item, ["name", "title", "album_name", "albumName", "album_title", "albumTitle", "comic_name"]) ||
    `最近更新 ${idx + 1}`;
  const author = pickText(item, ["author", "authors", "author_name", "authorName"]);
  const category = pickText(item, ["category", "category_title", "categoryTitle", "category_sub", "tags"]);
  const cover = normalizeCover(
    pickText(item, ["cover", "cover_url", "coverUrl", "image", "image_url", "imageUrl", "thumb", "thumbnail"]),
    aid,
  );
  return { aid, title, author, category, cover };
}

function latestCacheKey(uid: unknown): string {
  return `${HOME_LATEST_CACHE_PREFIX}:${String(uid ?? "unknown")}`;
}

function loadLatestFallback(uid: unknown): unknown | undefined {
  const key = latestCacheKey(uid);
  const parsed = readJsonStorage<PersistedLatest>(key);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof parsed.savedAt !== "number" ||
    !("data" in parsed) ||
    Date.now() - parsed.savedAt > HOME_LATEST_CACHE_MAX_AGE_MS
  ) {
    removeStorage(key);
    return undefined;
  }
  return parsed.data;
}

function saveLatestFallback(uid: unknown, data: unknown): void {
  writeJsonStorage(
    latestCacheKey(uid),
    { savedAt: Date.now(), data } satisfies PersistedLatest,
  );
}

function HomeLatestSkeleton(props: { viewMode: ViewMode }) {
  if (props.viewMode === "list") {
    return (
      <div className="flex flex-col gap-2" role="status" aria-label="最近更新加载中">
        {Array.from({ length: 4 }, (_, idx) => (
          <div
            key={idx}
            className="flex h-[82px] animate-pulse items-center gap-3 rounded-md border border-zinc-200 px-3 py-2"
          >
            <div className="h-16 w-12 flex-none rounded bg-zinc-200" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-2/3 rounded bg-zinc-200" />
              <div className="h-3 w-1/2 rounded bg-zinc-100" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3" role="status" aria-label="最近更新加载中">
      {Array.from({ length: 6 }, (_, idx) => (
        <div key={idx} className="animate-pulse overflow-hidden rounded-md border border-zinc-200">
          <div className="aspect-[3/4] bg-zinc-200" />
          <div className="space-y-2 p-2">
            <div className="h-4 w-4/5 rounded bg-zinc-200" />
            <div className="h-3 w-3/5 rounded bg-zinc-100" />
            <div className="h-3 w-2/5 rounded bg-zinc-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function HomePage(props: {
  session: Session;
  onAuthExpired: () => void;
  onOpenComic: (aid: string) => void;
}) {
  const [promote, setPromote] = useState<unknown[] | null>(null);
  const [promoteError, setPromoteError] = useState<string>("");
  const [homeFilter, setHomeFilter] = useState<string>("全部");
  const [viewMode, setViewMode] = usePersistedViewMode(HOME_VIEW_KEY, "card");
  const latestFallback = useMemo(
    () => loadLatestFallback(props.session.user.uid),
    [props.session.user.uid],
  );

  const {
    data: latestRaw,
    error: latestError,
    isValidating: latestValidating,
    mutate: refreshLatest,
  } = useSWR(
    ["home-latest", props.session.cookies],
    async ([, cookies]) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<unknown>("api_latest", { page: "0", cookies });
    },
    {
      fallbackData: latestFallback,
      keepPreviousData: true,
      revalidateOnMount: true,
      revalidateOnFocus: false,
      onSuccess: (data) => {
        saveLatestFallback(props.session.user.uid, data);
      },
      onError: (err) => {
        if (isAuthExpiredError(err)) {
          props.onAuthExpired();
        }
      },
    },
  );

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setPromoteError("");
      setPromote(null);
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const promoteRaw = await invoke<unknown>("api_promote", {
          page: "0",
          cookies: props.session.cookies,
        });

        if (cancelled) return;
        if (Array.isArray(promoteRaw)) {
          setPromote(promoteRaw);
        } else if (promoteRaw && typeof promoteRaw === "object") {
          const blocks = Object.values(promoteRaw as Record<string, unknown>);
          setPromote(blocks);
        } else {
          setPromote([]);
        }
      } catch (e) {
        if (cancelled) return;
        if (isAuthExpiredError(e)) {
          props.onAuthExpired();
          return;
        }
        const msg = e instanceof Error ? e.message : String(e);
        setPromoteError(msg);
        setPromote([]);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [props.onAuthExpired, props.session.cookies]);

  const latest = useMemo(
    () => (latestRaw === undefined ? null : extractList(latestRaw).filter(isRecord)),
    [latestRaw],
  );
  const latestCards = useMemo(
    () => (latest ?? []).map((item, idx) => normalizeLatestItem(item, idx)),
    [latest],
  );
  /** Category chips narrow the current feed and preserve a truthful empty state. */
  const visibleCards = useMemo(() => {
    if (homeFilter === "全部") return latestCards;
    return latestCards.filter((card) => card.category.includes(homeFilter));
  }, [latestCards, homeFilter]);
  const latestErrorText =
    latestError && !isAuthExpiredError(latestError)
      ? latestError instanceof Error
        ? latestError.message
        : String(latestError)
      : "";

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col gap-6 pb-2 pt-1 md:min-h-0">
      <PageHeader
        eyebrow="JM · 最近更新"
        title="发现"
        action={
          <Link
            to="/home/search"
            aria-label="搜索"
            className="hidden h-9 w-9 flex-none items-center justify-center rounded-pill border border-zinc-300 text-zinc-500 transition-colors hover:border-zinc-400 hover:text-zinc-900 sm:inline-flex md:hidden"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
          </Link>
        }
      />

      <div className="flex flex-wrap gap-2">
        {HOME_FILTERS.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setHomeFilter(name)}
            aria-pressed={homeFilter === name}
            className={[
              "h-[30px] rounded-pill px-3.5 text-xs font-medium transition-colors",
              homeFilter === name
                ? "bg-zinc-900 text-white"
                : "border border-zinc-300 text-zinc-500 hover:text-zinc-900",
            ].join(" ")}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="text-[15px] font-semibold text-zinc-900">最新更新</div>
          {latest !== null ? (
            <span className="font-mono text-[10px] text-zinc-400">
              {visibleCards.length}/{latestCards.length}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="刷新最新更新"
            title="刷新最新更新"
            onClick={() => void refreshLatest()}
            disabled={latestValidating}
            className="flex h-9 w-9 items-center justify-center rounded-pill border border-zinc-200 bg-white text-zinc-500 transition-colors hover:bg-zinc-50 hover:text-zinc-900 disabled:opacity-60"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${latestValidating ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
          </button>
          <ListViewToggle value={viewMode} onChange={setViewMode} />
        </div>
      </div>

      {latestErrorText && latest === null ? (
        <EmptyState
          title="最近更新加载失败"
          description={latestErrorText}
          action={
            <button
              type="button"
              onClick={() => void refreshLatest()}
              className="h-9 rounded-pill bg-zinc-900 px-4 text-xs font-medium text-white hover:bg-zinc-800"
            >
              重新加载
            </button>
          }
        />
      ) : latest === null ? (
        <HomeLatestSkeleton viewMode={viewMode} />
      ) : latestCards.length === 0 ? (
        <EmptyState title="暂无更新" description="稍后刷新，或去搜索页发现更多作品。" />
      ) : visibleCards.length === 0 ? (
        <EmptyState
          title={`没有“${homeFilter}”分类的作品`}
          description="当前最近更新中没有匹配内容，可以清除筛选查看全部。"
          action={
            <button
              type="button"
              onClick={() => setHomeFilter("全部")}
              className="h-9 rounded-pill border border-zinc-300 px-4 text-xs font-medium text-zinc-800 hover:bg-zinc-50"
            >
              清除筛选
            </button>
          }
        />
      ) : (
        <>
        {viewMode === "card" ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-5 md:grid-cols-3">
            {visibleCards.map((item, idx) => (
              <div key={`${item.aid}-${idx}`} className="flex h-full flex-col gap-2">
                <button
                  type="button"
                  className="relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-zinc-100"
                  onClick={() => item.aid && props.onOpenComic(item.aid)}
                  disabled={!item.aid}
                >
                  <CoverImage
                    src={item.cover}
                    alt={item.title}
                    aid={item.aid}
                    className="h-full w-full object-cover"
                  />
                  <span className="absolute bottom-2 right-2 rounded-pill bg-black/55 px-2 py-[3px] font-mono text-[10px] tracking-wider text-white">
                    #{item.aid || "—"}
                  </span>
                </button>
                <button
                  type="button"
                  className="line-clamp-2 text-left text-[13px] font-medium leading-snug text-zinc-900 hover:underline"
                  onClick={() => item.aid && props.onOpenComic(item.aid)}
                  disabled={!item.aid}
                >
                  {item.title}
                </button>
                <div className="space-y-1 text-[11px] leading-4 text-zinc-500">
                  <div className="truncate">作者：{item.author || "未知"}</div>
                  <div className="truncate font-mono text-[10px] tracking-wide text-zinc-400">
                    AID：{item.aid || "—"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {visibleCards.map((item, idx) => (
              <div
                key={`${item.aid}-${idx}`}
                className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white p-2.5 shadow-sm"
              >
                <div className="relative h-[76px] w-[57px] flex-none overflow-hidden rounded-md bg-zinc-100">
                  <CoverImage
                    src={item.cover}
                    alt={item.title}
                    aid={item.aid}
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    className="line-clamp-2 w-full text-left text-[13px] font-medium text-zinc-900 hover:underline"
                    onClick={() => item.aid && props.onOpenComic(item.aid)}
                    disabled={!item.aid}
                  >
                    {item.title}
                  </button>
                  <div className="mt-1 truncate text-[11px] text-zinc-500">
                    作者：{item.author || "未知"}
                  </div>
                  <div className="truncate font-mono text-[10px] tracking-wide text-zinc-400">
                    AID：{item.aid || "—"}
                  </div>
                </div>
                <button
                  type="button"
                  className="flex h-9 w-9 flex-none items-center justify-center rounded-pill border border-zinc-300 text-zinc-500 hover:bg-zinc-50 disabled:opacity-60"
                  onClick={() => item.aid && props.onOpenComic(item.aid)}
                  disabled={!item.aid}
                  aria-label="详情"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}
        </>
      )}

      {latestErrorText && latest !== null ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          最近更新刷新失败，正在显示上次内容：{latestErrorText}
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        <div className="text-[15px] font-semibold text-zinc-900">编辑推荐</div>
        {promoteError ? (
          <div className="rounded-lg border border-zinc-200 p-3 text-sm text-red-600">
            推荐加载失败：{promoteError}
          </div>
        ) : promote === null ? (
          <Loading />
        ) : promote.length === 0 ? (
          <EmptyState title="今日暂无推荐" compact />
        ) : (
          <div className="flex h-24 items-center justify-between gap-3 overflow-hidden rounded-lg bg-gradient-to-br from-accent to-accent-strong px-4">
            <div className="min-w-0">
              <div className="font-mono text-[9px] uppercase tracking-[0.13em] text-accent-fg/70">
                DAILY PICK
              </div>
              <div className="mt-1 truncate text-[15px] font-medium text-accent-fg">
                今日精选 · {promote.length} 个专题
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
