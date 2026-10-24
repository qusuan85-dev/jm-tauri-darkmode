import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import useSWR from "swr";
import { ChevronRight, Search } from "lucide-react";

import type { Session } from "../auth/session";
import { isAuthExpiredError } from "../auth/errors";
import CoverImage from "../components/CoverImage";
import ListViewToggle from "../components/ListViewToggle";
import Loading from "../components/Loading";
import { getImgBase } from "../config/endpoints";

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
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as PersistedLatest;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.savedAt !== "number" ||
      !("data" in parsed) ||
      Date.now() - parsed.savedAt > HOME_LATEST_CACHE_MAX_AGE_MS
    ) {
      localStorage.removeItem(key);
      return undefined;
    }
    return parsed.data;
  } catch {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore unavailable storage
    }
    return undefined;
  }
}

function saveLatestFallback(uid: unknown, data: unknown): void {
  try {
    localStorage.setItem(
      latestCacheKey(uid),
      JSON.stringify({ savedAt: Date.now(), data } satisfies PersistedLatest),
    );
  } catch {
    // ignore unavailable or full storage
  }
}

function HomeLatestSkeleton(props: { viewMode: "list" | "card" }) {
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
  const viewKey = "jm_view_home_latest";
  const [viewMode, setViewMode] = useState<"list" | "card">(() => {
    try {
      const value = localStorage.getItem(viewKey);
      return value === "list" ? "list" : "card";
    } catch {
      return "card";
    }
  });
  const latestFallback = useMemo(
    () => loadLatestFallback(props.session.user.uid),
    [props.session.user.uid],
  );

  useEffect(() => {
    try {
      localStorage.setItem(viewKey, viewMode);
    } catch {
      // ignore
    }
  }, [viewMode, viewKey]);

  const { data: latestRaw, error: latestError } = useSWR(
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
  /** Local category filter. Falls back to the full list when nothing matches,
      so tapping a chip can never leave the user staring at an empty screen. */
  const visibleCards = useMemo(() => {
    if (homeFilter === "全部") return latestCards;
    const hit = latestCards.filter((card) => card.category.includes(homeFilter));
    return hit.length > 0 ? hit : latestCards;
  }, [latestCards, homeFilter]);
  const latestErrorText =
    latestError && !isAuthExpiredError(latestError)
      ? latestError instanceof Error
        ? latestError.message
        : String(latestError)
      : "";

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col gap-6 pb-2 pt-1 md:min-h-0">
      {/* An eyebrow plus one strong title answers "where am I" at a glance, and
          the view switch rides the same line instead of owning a whole card. */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
            JM · 最近更新
          </div>
          <h1 className="text-[26px] font-medium leading-none text-zinc-900">发现</h1>
        </div>
        <Link
          to="/home/search"
          aria-label="搜索"
          className="flex h-9 w-9 flex-none items-center justify-center rounded-pill border border-zinc-300 text-zinc-500 transition-colors hover:text-zinc-900"
        >
          <Search className="h-4 w-4" />
        </Link>
      </div>

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
        <div className="text-[15px] font-semibold text-zinc-900">最新更新</div>
        <ListViewToggle value={viewMode} onChange={setViewMode} />
      </div>

      {latestErrorText && latest === null ? (
        <div className="rounded-lg border border-zinc-200 p-3 text-sm text-red-600">
          最近更新加载失败：{latestErrorText}
        </div>
      ) : latest === null ? (
        <HomeLatestSkeleton viewMode={viewMode} />
      ) : latestCards.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-500">
          暂无更新
        </div>
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
                      <CoverImage src={item.cover} alt={item.title} aid={item.aid} className="h-full w-full object-cover" />
                      {/* The album id becomes a monospace badge on the cover
                          rather than a fourth "AID：" line under the title. */}
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
                    <div className="truncate text-[11px] text-zinc-500">{item.author || "—"}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {visibleCards.map((item, idx) => (
                  <div key={`${item.aid}-${idx}`} className="flex items-center gap-3">
                    <div className="relative h-[76px] w-[57px] flex-none overflow-hidden rounded-md bg-zinc-100">
                      <CoverImage src={item.cover} alt={item.title} aid={item.aid} className="h-full w-full object-cover" />
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
                      <div className="mt-1 truncate text-[11px] text-zinc-500">{item.author || "—"}</div>
                      <div className="truncate font-mono text-[10px] tracking-wider text-zinc-400">
                        #{item.aid || "—"}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="flex h-9 w-9 flex-none items-center justify-center rounded-pill border border-zinc-300 text-zinc-500 hover:bg-zinc-50 disabled:opacity-60"
                      onClick={() => item.aid && props.onOpenComic(item.aid)}
                      disabled={!item.aid}
                      aria-label="详情"
                    >
                      <ChevronRight className="h-4 w-4" />
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
          <div className="rounded-lg border border-dashed border-zinc-200 p-4 text-center text-sm text-zinc-500">
            今日暂无推荐
          </div>
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
            <ChevronRight className="h-5 w-5 flex-none text-accent-fg/80" />
          </div>
        )}
      </div>
    </div>
  );
}
