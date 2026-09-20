import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2, X } from "lucide-react";

import type { Session } from "../auth/session";
import { isAuthExpiredError } from "../auth/errors";
import CoverImage from "../components/CoverImage";
import ListViewToggle from "../components/ListViewToggle";
import { getImgBase } from "../config/endpoints";

type SortKey = "mr" | "mv" | "mp" | "tf";

const SORT_KEY = "jm_search_sort";
const HISTORY_KEY = "jm_search_history";
const PREFILL_KEY = "jm_search_prefill";
const VIEW_KEY = "jm_view_search";
const BATCH_KEY = "jm_search_batch_size";
const STATE_KEY = "jm_search_state_v1";

/** How many results one "batch" reveals. The backend page size is fixed, so a
 *  batch is a slice of the accumulated results rather than a request size. */
const BATCH_SIZE_OPTIONS = [10, 20, 30, 50];
const DEFAULT_BATCH_SIZE = 20;

/** Results are cached so returning to the page is instant; keep the payload
 *  bounded since it goes to localStorage. */
const MAX_CACHED_ITEMS = 400;

/** Two consecutive pages that add nothing new mean we have reached the end
 *  (search results shift between requests, so pages can overlap). */
const MAX_EMPTY_STREAK = 2;

const SENTINEL_MARGIN_PX = 400;

type SearchState = {
  queryInput: string;
  query: string;
  sort: SortKey;
  items: any[];
  visibleCount: number;
  total: number | null;
  nextServerPage: number;
  loadedPages: number;
  emptyStreak: number;
  exhausted: boolean;
  scrollY: number;
};

function isSortKey(value: unknown): value is SortKey {
  return value === "mr" || value === "mv" || value === "mp" || value === "tf";
}

function loadSort(): SortKey {
  try {
    const raw = localStorage.getItem(SORT_KEY);
    if (isSortKey(raw)) return raw;
  } catch {
    // ignore
  }
  return "mr";
}

function saveSort(sort: SortKey) {
  try {
    localStorage.setItem(SORT_KEY, sort);
  } catch {
    // ignore
  }
}

function loadBatchSize(): number {
  try {
    const n = Number(localStorage.getItem(BATCH_KEY));
    if (BATCH_SIZE_OPTIONS.includes(n)) return n;
  } catch {
    // ignore
  }
  return DEFAULT_BATCH_SIZE;
}

function saveBatchSize(size: number) {
  try {
    localStorage.setItem(BATCH_KEY, String(size));
  } catch {
    // ignore
  }
}

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((s) => typeof s === "string" && s.trim()) : [];
  } catch {
    return [];
  }
}

function saveHistory(list: string[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 30)));
  } catch {
    // ignore
  }
}

function loadViewMode(): "list" | "card" {
  try {
    return localStorage.getItem(VIEW_KEY) === "card" ? "card" : "list";
  } catch {
    return "list";
  }
}

function emptyState(): SearchState {
  return {
    queryInput: "",
    query: "",
    sort: loadSort(),
    items: [],
    visibleCount: 0,
    total: null,
    nextServerPage: 1,
    loadedPages: 0,
    emptyStreak: 0,
    exhausted: false,
    scrollY: 0,
  };
}

/**
 * Last search session, kept in memory for instant restores and mirrored to
 * localStorage so it also survives a cold start.
 */
let memoryState: SearchState | null = null;

function normalizeState(raw: any): SearchState | null {
  if (!raw || typeof raw !== "object") return null;
  const items = Array.isArray(raw.items) ? raw.items : [];
  const base = emptyState();
  return {
    queryInput: typeof raw.queryInput === "string" ? raw.queryInput : "",
    query: typeof raw.query === "string" ? raw.query : "",
    sort: isSortKey(raw.sort) ? raw.sort : base.sort,
    items,
    visibleCount: Math.max(0, Math.min(Number(raw.visibleCount) || 0, items.length)),
    total: typeof raw.total === "number" && Number.isFinite(raw.total) ? raw.total : null,
    nextServerPage: Math.max(1, Number(raw.nextServerPage) || 1),
    loadedPages: Math.max(0, Number(raw.loadedPages) || 0),
    emptyStreak: Math.max(0, Number(raw.emptyStreak) || 0),
    exhausted: Boolean(raw.exhausted),
    scrollY: Math.max(0, Number(raw.scrollY) || 0),
  };
}

function loadState(): SearchState | null {
  if (memoryState) return memoryState;
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return null;
    memoryState = normalizeState(JSON.parse(raw));
    return memoryState;
  } catch {
    return null;
  }
}

function saveState(state: SearchState) {
  memoryState = state;
  try {
    if (!state.query) localStorage.removeItem(STATE_KEY);
    else
      localStorage.setItem(
        STATE_KEY,
        JSON.stringify({ ...state, items: state.items.slice(0, MAX_CACHED_ITEMS) }),
      );
  } catch {
    // ignore quota / privacy errors
  }
}

function aidOf(item: any): string {
  return typeof item?.id === "string" || typeof item?.id === "number" ? String(item.id) : "";
}

export default function SearchPage(props: {
  session: Session;
  onAuthExpired: () => void;
  onOpenComic: (aid: string) => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const scrollSentinelRef = useRef<HTMLDivElement | null>(null);

  // Resolve the initial state exactly once: an explicit ?q= in the URL starts a
  // fresh search, otherwise the previous session is restored.
  const [initial] = useState<SearchState>(() => {
    const urlQuery = (searchParams.get("q") ?? "").trim();
    const cached = loadState();
    if (urlQuery && urlQuery !== (cached?.query ?? "")) {
      const rawSort = searchParams.get("sort");
      return {
        ...emptyState(),
        queryInput: urlQuery,
        query: urlQuery,
        sort: isSortKey(rawSort) ? rawSort : (cached?.sort ?? loadSort()),
      };
    }
    return cached ?? emptyState();
  });
  /** A remembered offset is waiting to be re-applied on this mount. */
  const pendingRestore = initial.items.length > 0 && initial.scrollY > 0;

  const [queryInput, setQueryInput] = useState(initial.queryInput);
  const [committedQuery, setCommittedQuery] = useState(initial.query);
  const [searchSort, setSearchSort] = useState<SortKey>(initial.sort);
  const [items, setItems] = useState<any[]>(initial.items);
  const [visibleCount, setVisibleCount] = useState(initial.visibleCount);
  const [total, setTotal] = useState<number | null>(initial.total);
  const [nextServerPage, setNextServerPage] = useState(initial.nextServerPage);
  const [loadedPages, setLoadedPages] = useState(initial.loadedPages);
  const [emptyStreak, setEmptyStreak] = useState(initial.emptyStreak);
  const [exhausted, setExhausted] = useState(initial.exhausted);
  const [batchSize, setBatchSize] = useState(loadBatchSize);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "card">(loadViewMode);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<string[]>(() => loadHistory());
  const [historyFilter, setHistoryFilter] = useState("");
  const [sentinelVisible, setSentinelVisible] = useState(false);

  const composingRef = useRef(false);
  const queryInputRef = useRef<HTMLInputElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const prefillRef = useRef(false);
  const inFlightRef = useRef(false);
  const scrollYRef = useRef(initial.scrollY);
  /** Muted until the pending restore is applied, so a stray 0 cannot clobber it. */
  const scrollReadyRef = useRef(!pendingRestore);
  const lastPersistRef = useRef(0);

  useEffect(() => {
    saveSort(searchSort);
  }, [searchSort]);

  useEffect(() => {
    saveBatchSize(batchSize);
  }, [batchSize]);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, viewMode);
    } catch {
      // ignore
    }
  }, [viewMode]);

  useEffect(() => {
    const onDown = (ev: MouseEvent) => {
      const t = ev.target as HTMLElement | null;
      if (!t) return;
      if (queryInputRef.current?.contains(t)) return;
      if (dropdownRef.current?.contains(t)) return;
      setHistoryOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);

  const list = visibleCount > 0 ? items.slice(0, visibleCount) : [];
  const hasMoreInBuffer = visibleCount < items.length;
  const canLoadMore = Boolean(committedQuery) && (hasMoreInBuffer || !exhausted);

  const loadMore = useCallback(async () => {
    if (!committedQuery) return;
    // Reveal what is already buffered before hitting the network.
    if (visibleCount < items.length) {
      setVisibleCount(Math.min(visibleCount + batchSize, items.length));
      return;
    }
    if (exhausted || inFlightRef.current) return;

    inFlightRef.current = true;
    setLoading(true);
    setErrorText("");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const data = await invoke<any>("api_search", {
        searchQuery: committedQuery,
        sort: searchSort,
        page: String(nextServerPage),
        cookies: props.session.cookies,
      });
      const pageItems: any[] = Array.isArray(data?.content) ? data.content : [];
      const apiTotal = typeof data?.total === "number" ? data.total : total;

      // Drop duplicates: live search results shift between requests, so the
      // next page can repeat entries we already have.
      const seen = new Set(items.map(aidOf).filter(Boolean));
      const fresh: any[] = [];
      for (const item of pageItems) {
        const aid = aidOf(item);
        if (aid && seen.has(aid)) continue;
        if (aid) seen.add(aid);
        fresh.push(item);
      }
      const merged = [...items, ...fresh];

      setItems(merged);
      setVisibleCount(Math.min(visibleCount + batchSize, merged.length));
      setTotal(apiTotal);
      setNextServerPage(nextServerPage + 1);
      setLoadedPages(loadedPages + 1);

      if (apiTotal != null && merged.length >= apiTotal) {
        setEmptyStreak(0);
        setExhausted(true);
      } else if (fresh.length === 0) {
        const streak = emptyStreak + 1;
        setEmptyStreak(streak);
        if (streak >= MAX_EMPTY_STREAK) setExhausted(true);
      } else {
        setEmptyStreak(0);
      }
    } catch (err) {
      if (isAuthExpiredError(err)) {
        props.onAuthExpired();
      } else {
        setErrorText(err instanceof Error ? err.message : String(err));
      }
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [
    batchSize,
    committedQuery,
    emptyStreak,
    exhausted,
    items,
    loadedPages,
    nextServerPage,
    props.onAuthExpired,
    props.session.cookies,
    searchSort,
    total,
    visibleCount,
  ]);

  const runSearch = useCallback(
    (options?: { query?: string; sort?: SortKey }) => {
      const q = (options?.query ?? queryInput).trim();
      if (!q) return;
      const m = q.match(/^(?:jm|JM)?(\d+)$/);
      if (m) {
        props.onOpenComic(m[1]);
        return;
      }
      const sort = options?.sort ?? searchSort;
      setCommittedQuery(q);
      setQueryInput(q);
      setSearchSort(sort);
      // A new search always starts over from the first page.
      setItems([]);
      setVisibleCount(0);
      setTotal(null);
      setNextServerPage(1);
      setLoadedPages(0);
      setEmptyStreak(0);
      setExhausted(false);
      setErrorText("");
      setSentinelVisible(false);
      setHistoryOpen(false);
      setSearchParams({ q, sort }, { replace: true });
      scrollYRef.current = 0;
      window.scrollTo({ top: 0, behavior: "auto" as ScrollBehavior });
      setHistory((prev) => {
        const nextHistory = [q, ...prev.filter((x) => x !== q)].slice(0, 30);
        saveHistory(nextHistory);
        return nextHistory;
      });
    },
    [props.onOpenComic, queryInput, searchSort, setSearchParams],
  );

  // Kick off the first request for a query that has no results yet (new search,
  // or a restored state whose first request failed).
  useEffect(() => {
    if (!committedQuery || loading || exhausted) return;
    if (loadedPages > 0 || items.length > 0) return;
    void loadMore();
  }, [committedQuery, exhausted, items.length, loadMore, loadedPages, loading]);

  // Mirror the current session into the URL so it stays meaningful (and so a
  // deep link / reload lands on the same search).
  useEffect(() => {
    if (!committedQuery) return;
    if ((searchParams.get("q") ?? "").trim() === committedQuery && searchParams.get("sort") === searchSort)
      return;
    setSearchParams({ q: committedQuery, sort: searchSort }, { replace: true });
  }, [committedQuery, searchParams, searchSort, setSearchParams]);

  useEffect(() => {
    if (prefillRef.current) return;
    let q = "";
    try {
      q = localStorage.getItem(PREFILL_KEY) ?? "";
      if (!q.trim()) return;
      localStorage.removeItem(PREFILL_KEY);
    } catch {
      return;
    }
    prefillRef.current = true;
    setQueryInput(q);
    runSearch({ query: q });
  }, [runSearch]);

  // Reveal the next batch as soon as the bottom sentinel comes into view.
  useEffect(() => {
    const el = scrollSentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => setSentinelVisible(Boolean(entries[0]?.isIntersecting)),
      { rootMargin: `${SENTINEL_MARGIN_PX}px 0px` },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [list.length > 0]);

  /**
   * The observer notification can arrive after a batch already pushed the
   * sentinel out of view, so the trigger re-checks the real geometry instead of
   * trusting a possibly stale flag — otherwise a single scroll can fire two
   * batches back to back.
   */
  const sentinelInView = useCallback(() => {
    const el = scrollSentinelRef.current;
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.top <= window.innerHeight + SENTINEL_MARGIN_PX;
  }, []);

  useEffect(() => {
    if (!sentinelVisible || loading) return;
    if (!sentinelInView()) return;
    void loadMore();
  }, [loadMore, loading, sentinelInView, sentinelVisible]);

  // Restore the outgoing scroll offset once the restored results are laid out.
  //
  // `scrollYRef` is seeded with the cached offset and the scroll listener stays
  // muted until the restore has been applied, so nothing can overwrite the
  // remembered position with the 0 the fresh page starts at. The effect is
  // deliberately re-entrant: StrictMode mounts, unmounts and mounts again, and
  // its first cleanup cancels the pending frame.
  useEffect(() => {
    if (!pendingRestore) return;
    let cancelled = false;
    let raf2 = 0;
    const apply = () => {
      if (cancelled) return;
      window.scrollTo({ top: initial.scrollY, behavior: "auto" as ScrollBehavior });
      scrollYRef.current = window.scrollY;
      scrollReadyRef.current = true;
    };
    const raf1 = requestAnimationFrame(() => {
      apply();
      raf2 = requestAnimationFrame(apply);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [initial.scrollY, pendingRestore]);

  // Persist the session (including the live scroll offset) so switching to
  // another page and back restores the exact same results. The offset lives in
  // a ref fed by the scroll listener: reading window.scrollY while unmounting
  // would already reflect the incoming page.
  const stateRef = useRef<SearchState>(initial);
  stateRef.current = {
    queryInput,
    query: committedQuery,
    sort: searchSort,
    items,
    visibleCount,
    total,
    nextServerPage,
    loadedPages,
    emptyStreak,
    exhausted,
    scrollY: scrollYRef.current,
  };

  useEffect(() => {
    saveState(stateRef.current);
  }, [committedQuery, exhausted, items, loadedPages, nextServerPage, searchSort, total, visibleCount]);

  useEffect(() => {
    const onScroll = () => {
      if (!scrollReadyRef.current) return;
      scrollYRef.current = window.scrollY;
      const now = Date.now();
      if (now - lastPersistRef.current < 1000) return;
      lastPersistRef.current = now;
      saveState(stateRef.current);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const persist = () => {
      stateRef.current.scrollY = scrollYRef.current;
      saveState(stateRef.current);
    };
    window.addEventListener("pagehide", persist);
    document.addEventListener("visibilitychange", persist);
    return () => {
      persist();
      window.removeEventListener("pagehide", persist);
      document.removeEventListener("visibilitychange", persist);
    };
  }, []);

  // Runs while unmounting, before the browser clamps the scroll offset to the
  // incoming (usually shorter) page — the only point where the outgoing
  // position can still be observed reliably.
  useLayoutEffect(() => {
    return () => {
      if (!scrollReadyRef.current) return;
      saveState({ ...stateRef.current, scrollY: window.scrollY });
    };
  }, []);

  const clearResults = useCallback(() => {
    setItems([]);
    setVisibleCount(0);
    setTotal(null);
    setNextServerPage(1);
    setLoadedPages(0);
    setEmptyStreak(0);
    setExhausted(false);
    setErrorText("");
    setCommittedQuery("");
    setSentinelVisible(false);
    setSearchParams({}, { replace: true });
    scrollYRef.current = 0;
    saveState({ ...emptyState(), sort: searchSort });
  }, [searchSort, setSearchParams]);

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-600 shadow-sm">
        搜索 ·{" "}
        {committedQuery
          ? `${total != null ? `共 ${String(total)} 条 · ` : ""}已加载 ${list.length}${
              loadedPages > 0 ? ` · 第 ${loadedPages} 页` : ""
            }`
          : "—"}
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="mb-3 text-sm font-medium text-zinc-900">条件</div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <input
              ref={queryInputRef}
              className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm"
              placeholder="输入关键词 / JM12345"
              value={queryInput}
              onFocus={() => {
                setHistory(loadHistory());
                setHistoryFilter(queryInput);
                setHistoryOpen(true);
              }}
              onClick={() => {
                setHistory(loadHistory());
                setHistoryFilter(queryInput);
                setHistoryOpen(true);
              }}
              onChange={(e) => {
                const next = e.currentTarget.value;
                setQueryInput(next);
                setHistoryFilter(next);
              }}
              onCompositionStart={() => {
                composingRef.current = true;
              }}
              onCompositionEnd={(e) => {
                composingRef.current = false;
                const next = e.currentTarget.value;
                setQueryInput(next);
                setHistoryFilter(next);
              }}
              onBlur={() => {
                // Some Windows IME paths may miss compositionend on blur.
                composingRef.current = false;
              }}
              onKeyDown={(e) => {
                const native = e.nativeEvent as KeyboardEvent;
                if (e.key === "Enter" && !composingRef.current && !native.isComposing) {
                  void runSearch();
                }
              }}
            />
            {historyOpen ? (
              <div
                ref={dropdownRef}
                className="glass absolute left-0 right-0 top-10 z-20 max-h-[280px] overflow-auto rounded-xl"
              >
                <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2 text-xs text-zinc-600">
                  <div>搜索记录</div>
                </div>
                <div className="p-1">
                  {(() => {
                    const needle = historyFilter.trim().toLowerCase();
                    const historyItems = needle
                      ? history.filter((h) => h.toLowerCase().includes(needle))
                      : history;
                    if (!historyItems.length) {
                      return <div className="px-3 py-2 text-sm text-zinc-500">暂无记录</div>;
                    }
                    return (
                      <div className="flex flex-wrap gap-2 p-2">
                        {historyItems.map((h) => (
                          <button
                            key={h}
                            type="button"
                            className="group flex max-w-full items-center gap-1 rounded-full border border-zinc-200 bg-white px-2 py-1 text-left text-sm text-zinc-900 hover:bg-zinc-50"
                            onClick={() => {
                              setQueryInput(h);
                              setHistoryOpen(false);
                              runSearch({ query: h });
                            }}
                            title={h}
                          >
                            <span className="block max-w-[200px] truncate">{h}</span>
                            <span className="ml-1 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
                              <button
                                type="button"
                                className="flex h-5 w-5 items-center justify-center"
                                aria-label={`删除搜索记录 ${h}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setHistory((prev) => {
                                    const next = prev.filter((x) => x !== h);
                                    saveHistory(next);
                                    return next;
                                  });
                                }}
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </span>
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm hover:bg-zinc-50 disabled:opacity-60"
            onClick={() => void runSearch()}
            disabled={loading}
          >
            搜索
          </button>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            className="h-9 rounded-md border border-zinc-200 bg-white px-2 text-sm"
            value={searchSort}
            aria-label="排序方式"
            onChange={(e) => {
              const next = e.currentTarget.value as SortKey;
              if (!isSortKey(next)) return;
              saveSort(next);
              setSearchSort(next);
              if (committedQuery.trim()) runSearch({ sort: next, query: committedQuery });
            }}
          >
            <option value="mr">最新</option>
            <option value="mv">最多点击</option>
            <option value="mp">最多图片</option>
            <option value="tf">最多爱心</option>
          </select>
          <label className="flex h-9 items-center gap-2 rounded-md border border-zinc-200 bg-white px-2 text-sm text-zinc-700">
            <span className="whitespace-nowrap text-xs text-zinc-500">每次加载</span>
            <select
              className="h-7 rounded border-0 bg-transparent text-sm"
              value={String(batchSize)}
              aria-label="每次加载结果数"
              onChange={(e) => setBatchSize(Number(e.currentTarget.value) || DEFAULT_BATCH_SIZE)}
            >
              {BATCH_SIZE_OPTIONS.map((n) => (
                <option key={n} value={String(n)}>
                  {n} 条
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm hover:bg-zinc-50 disabled:opacity-60"
            onClick={() => void loadMore()}
            disabled={loading || !canLoadMore}
          >
            加载更多
          </button>
          <button
            type="button"
            className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm hover:bg-zinc-50 disabled:opacity-60"
            onClick={clearResults}
            disabled={!committedQuery && !items.length}
          >
            清空结果
          </button>
          <div className="text-sm text-zinc-600">
            {loading ? "加载中…" : exhausted && committedQuery ? "已全部加载" : ""}
          </div>
        </div>

        {errorText ? (
          <div className="mt-3 rounded-md border border-zinc-200 bg-white p-2 text-sm text-red-600">
            {errorText}
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2 text-sm font-medium text-zinc-900">
          <div>结果</div>
          <ListViewToggle value={viewMode} onChange={setViewMode} />
        </div>
        {viewMode === "card" ? (
          <div className="mt-3">
            {!list.length && !loading ? (
              <div className="rounded-md border border-dashed border-zinc-200 p-3 text-center text-sm text-zinc-500">
                暂无结果
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {list.map((item, idx) => {
                const aid = aidOf(item);
                const title =
                  typeof item?.name === "string"
                    ? item.name
                    : typeof item?.title === "string"
                      ? item.title
                      : `搜索结果 ${idx + 1}`;
                const author =
                  typeof item?.author === "string"
                    ? item.author
                    : Array.isArray(item?.author)
                      ? item.author.join(", ")
                      : "";
                const cover = aid ? `${getImgBase()}/media/albums/${aid}_3x4.jpg` : "";
                return (
                  <div
                    key={`${aid}-${idx}`}
                    className="flex flex-col overflow-hidden rounded-md border border-zinc-200 bg-white"
                  >
                    <button
                      type="button"
                      className="relative aspect-[3/4] w-full overflow-hidden bg-zinc-100"
                      onClick={() => aid && props.onOpenComic(aid)}
                      disabled={!aid}
                    >
                      <CoverImage src={cover} alt={title} className="h-full w-full object-cover" />
                    </button>
                    <div className="flex flex-1 flex-col gap-1 p-2">
                      <button
                        type="button"
                        className="line-clamp-2 text-left text-sm font-medium text-zinc-900 hover:underline"
                        onClick={() => aid && props.onOpenComic(aid)}
                        disabled={!aid}
                      >
                        {title}
                      </button>
                      <div className="truncate text-xs text-zinc-600">
                        {author ? `作者：${author}` : "作者：—"}
                      </div>
                      <div className="truncate text-xs text-zinc-500">AID：{aid || "—"}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {list.map((item, idx) => {
              const aid = aidOf(item);
              const title =
                typeof item?.name === "string"
                  ? item.name
                  : typeof item?.title === "string"
                    ? item.title
                    : `搜索结果 ${idx + 1}`;
              const author =
                typeof item?.author === "string"
                  ? item.author
                  : Array.isArray(item?.author)
                    ? item.author.join(", ")
                    : "";
              const categoryMain =
                typeof item?.category?.title === "string" ? item.category.title : "";
              const categorySub =
                typeof item?.category_sub?.title === "string" ? item.category_sub.title : "";
              const category =
                categoryMain && categorySub ? `${categoryMain}/${categorySub}` : categoryMain || categorySub;
              const cover = aid ? `${getImgBase()}/media/albums/${aid}_3x4.jpg` : "";

              return (
                <div
                  key={`${aid}-${idx}`}
                  className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="h-16 w-12 flex-none overflow-hidden rounded bg-zinc-100">
                      <CoverImage src={cover} alt={title} className="h-full w-full object-cover" />
                    </div>
                    <div className="min-w-0">
                      <button
                        type="button"
                        className="line-clamp-2 text-left text-sm font-medium text-zinc-900 hover:underline"
                        onClick={() => aid && props.onOpenComic(aid)}
                        disabled={!aid}
                      >
                        {title}
                      </button>
                      <div className="mt-1 text-xs text-zinc-600">
                        {author ? `作者：${author} · ` : ""}
                        {category ? `分类：${category} · ` : ""}
                        AID：{aid || "—"}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="h-8 flex-none rounded-md border border-zinc-200 bg-white px-2 text-sm text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
                    onClick={() => aid && props.onOpenComic(aid)}
                    disabled={!aid}
                  >
                    详情
                  </button>
                </div>
              );
            })}
            {!list.length && !loading ? <div className="text-sm text-zinc-600">暂无结果</div> : null}
          </div>
        )}

        {list.length ? (
          <>
            <div ref={scrollSentinelRef} className="h-px w-full" aria-hidden="true" />
            <div className="flex items-center justify-center gap-2 py-3 text-xs text-zinc-500">
              {loading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  正在加载更多…
                </>
              ) : exhausted ? (
                <span>已经到底了 · 共 {list.length} 条</span>
              ) : (
                <span>继续下滑自动加载下一批（每次 {batchSize} 条）</span>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
