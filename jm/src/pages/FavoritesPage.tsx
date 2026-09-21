import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import useSWR from "swr";
import { CheckSquare, FolderInput, Loader2, Square, Trash2, X } from "lucide-react";

import type { Session } from "../auth/session";
import { isAuthExpiredError } from "../auth/errors";
import CoverImage from "../components/CoverImage";
import Button from "../components/Button";
import ListViewToggle from "../components/ListViewToggle";
import Loading from "../components/Loading";
import { useToast } from "../components/Toast";
import { getImgBase } from "../config/endpoints";
import { getReadProgress } from "../reading/progress";

type FavoriteSort = "mr" | "mp";

function aidOf(item: any): string {
  const raw = item?.id ?? item?.aid;
  return typeof raw === "string" || typeof raw === "number" ? String(raw) : "";
}

function titleOf(item: any, index: number): string {
  if (typeof item?.name === "string") return item.name;
  if (typeof item?.title === "string") return item.title;
  if (typeof item?.album_name === "string") return item.album_name;
  return `收藏 ${index + 1}`;
}

function authorOf(item: any): string {
  if (typeof item?.author === "string") return item.author;
  if (typeof item?.author_name === "string") return item.author_name;
  return "";
}

/** Scroll positions, so returning from a comic lands back where you were. */
const scrollKey = (folderId: string, sort: FavoriteSort, page: number) =>
  `jm_favorites_scroll:${folderId}:${sort}:${page}`;

export default function FavoritesPage(props: {
  session: Session;
  onAuthExpired: () => void;
  onOpenComic: (aid: string) => void;
  onOpenReader: (
    aid: string,
    chapterId: string,
    chapterTitle: string,
    chapters: Array<{ id: string | number; sort?: string | number; name?: string }>,
    startPage?: number,
  ) => void;
}) {
  const viewKey = "jm_view_favorites";
  const [viewMode, setViewMode] = useState<"list" | "card">(() => {
    try {
      const v = localStorage.getItem(viewKey);
      return v === "card" ? "card" : "list";
    } catch {
      return "list";
    }
  });

  /**
   * 当前收藏夹 / 页码 / 排序放在 URL 里。
   *
   * 之前它们是组件内部状态，而进入详情页时记录的返回地址只有 `/home/favorites`，
   * 于是从本子返回就掉回默认收藏夹（页码、排序同样复位）。放进 URL 后返回地址天然带参数。
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const favoriteFolderId = searchParams.get("folder")?.trim() || "0";
  const favoriteSort: FavoriteSort = searchParams.get("sort") === "mp" ? "mp" : "mr";
  const parsedPage = Number(searchParams.get("page") ?? "1");
  const favoritePage = Number.isFinite(parsedPage) && parsedPage > 0 ? Math.floor(parsedPage) : 1;

  const patchParams = useCallback(
    (patch: { folder?: string; sort?: FavoriteSort; page?: number }) => {
      const next = new URLSearchParams(searchParams);
      const folder = patch.folder ?? favoriteFolderId;
      const sort = patch.sort ?? favoriteSort;
      const page = patch.page ?? favoritePage;
      // 只保留非默认值，URL 干净一些
      if (folder && folder !== "0") next.set("folder", folder);
      else next.delete("folder");
      if (sort && sort !== "mr") next.set("sort", sort);
      else next.delete("sort");
      if (page > 1) next.set("page", String(page));
      else next.delete("page");
      setSearchParams(next, { replace: true });
    },
    [favoriteFolderId, favoritePage, favoriteSort, searchParams, setSearchParams],
  );

  const [actionError, setActionError] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [toggleLoadingMap, setToggleLoadingMap] = useState<Record<string, boolean>>({});
  const [batchMode, setBatchMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number; failed: number } | null>(
    null,
  );
  const [batchError, setBatchError] = useState("");
  const [movePanelOpen, setMovePanelOpen] = useState(false);
  const [selectAllBusy, setSelectAllBusy] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    try {
      localStorage.setItem(viewKey, viewMode);
    } catch {
      // ignore
    }
  }, [viewMode, viewKey]);

  const {
    data: favoriteData,
    error: favoriteError,
    isValidating,
    mutate,
  } = useSWR(
    ["favorites", favoritePage, favoriteSort, favoriteFolderId, props.session.cookies],
    async ([, page, sort, folderId, cookies]) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<any>("api_favorites", {
        page: String(page),
        sort,
        folderId,
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

  const favoriteErrorText =
    favoriteError && !isAuthExpiredError(favoriteError)
      ? favoriteError instanceof Error
        ? favoriteError.message
        : String(favoriteError)
      : "";
  const favoriteLoading = isValidating && !favoriteData;

  const favoriteList: any[] = Array.isArray(favoriteData?.list) ? favoriteData.list : [];
  const pageAids = useMemo(
    () => favoriteList.map((item) => aidOf(item)).filter((aid) => aid && aid !== "-1"),
    [favoriteList],
  );

  // 从详情页返回时把滚动位置放回去（列表通常能立刻从 SWR 缓存渲染出来）
  const scrollRestoredRef = useRef(false);
  useEffect(() => {
    scrollRestoredRef.current = false;
  }, [favoriteFolderId, favoriteSort, favoritePage]);
  useEffect(() => {
    if (scrollRestoredRef.current || !favoriteData) return;
    scrollRestoredRef.current = true;
    let saved = 0;
    try {
      saved = Number(sessionStorage.getItem(scrollKey(favoriteFolderId, favoriteSort, favoritePage)) ?? "0");
    } catch {
      saved = 0;
    }
    if (saved > 0) window.scrollTo({ top: saved });
  }, [favoriteData, favoriteFolderId, favoritePage, favoriteSort]);
  useEffect(
    () => () => {
      try {
        if (window.scrollY > 0) {
          sessionStorage.setItem(
            scrollKey(favoriteFolderId, favoriteSort, favoritePage),
            String(Math.round(window.scrollY)),
          );
        }
      } catch {
        // ignore
      }
    },
    [favoriteFolderId, favoritePage, favoriteSort],
  );

  const toggleFavorite = async (aid: string) => {
    if (!aid) return;
    setToggleLoadingMap((prev) => ({ ...prev, [aid]: true }));
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("api_favorite_toggle", { aid, cookies: props.session.cookies });
      await mutate();
      showToast({ ok: true, text: "已取消收藏" });
    } catch (e) {
      if (isAuthExpiredError(e)) {
        props.onAuthExpired();
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      showToast({ ok: false, text: `取消收藏失败：${msg}` });
    } finally {
      setToggleLoadingMap((prev) => ({ ...prev, [aid]: false }));
    }
  };

  const formatChapterTitle = (c: { id: string | number; sort?: string | number; name?: string }) =>
    `第${c.sort ?? "?"}话${c.name ? `：${c.name}` : ""}`;

  const openReaderFromAid = async (aid: string, progress: ReturnType<typeof getReadProgress>) => {
    setActionError("");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const raw = await invoke<any>("api_album", {
        id: aid,
        cookies: props.session.cookies,
      });
      const series = Array.isArray(raw?.series) ? raw.series : [];
      const chapters =
        series.length > 0
          ? [...series].sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0))
          : [
              {
                id: raw?.id ?? aid,
                sort: 1,
                name: "",
              },
            ];

      const first = chapters[0];
      const target =
        progress?.chapterId != null
          ? chapters.find((c) => String(c.id) === String(progress.chapterId))
          : null;
      const chosen = target ?? first ?? { id: aid, sort: 1, name: "" };
      const chapterId = String(chosen.id ?? aid);
      const chapterTitle = formatChapterTitle(chosen);
      const startPage = target ? progress?.pageIndex ?? 1 : 1;
      props.onOpenReader(aid, chapterId, chapterTitle, chapters, startPage);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setActionError(msg);
    }
  };

  const addFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    setActionError("");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("api_favorite_folder_add", { name, cookies: props.session.cookies });
      setNewFolderName("");
      await mutate();
    } catch (e) {
      if (isAuthExpiredError(e)) {
        props.onAuthExpired();
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      setActionError(msg);
    }
  };

  const delFolder = async (folderId: string) => {
    if (!folderId || folderId === "0") return;
    setActionError("");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("api_favorite_folder_del", {
        folderId,
        cookies: props.session.cookies,
      });
      patchParams({ folder: "0", page: 1 });
      await mutate();
    } catch (e) {
      if (isAuthExpiredError(e)) {
        props.onAuthExpired();
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      setActionError(msg);
    }
  };

  const favoriteFolders: Array<{ name: string; id: string }> = [];
  try {
    const folderList = favoriteData?.folder_list;
    if (Array.isArray(folderList)) {
      for (const f of folderList) {
        const name = typeof f?.name === "string" ? f.name : "";
        const id = typeof f?.FID === "string" || typeof f?.FID === "number" ? String(f.FID) : "";
        if (name && id) favoriteFolders.push({ name, id });
      }
    }
  } catch {
    // ignore
  }

  const header = useMemo(() => {
    if (!favoriteData) return "";
    try {
      const total = favoriteData?.total;
      if (total != null) return `第 ${favoritePage} 页 · 共 ${String(total)} 条`;
    } catch {
      // ignore
    }
    return `第 ${favoritePage} 页`;
  }, [favoriteData, favoritePage]);

  // ---------------------------------------------------------------- 批量整理

  const exitBatch = useCallback(() => {
    setBatchMode(false);
    setSelected(new Set());
    setBatchProgress(null);
    setBatchError("");
    setMovePanelOpen(false);
  }, []);

  const toggleSelect = useCallback((aid: string) => {
    if (!aid) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(aid)) next.delete(aid);
      else next.add(aid);
      return next;
    });
  }, []);

  const selectPage = useCallback(() => {
    setSelected((prev) => new Set([...prev, ...pageAids]));
  }, [pageAids]);

  const invertPage = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const aid of pageAids) {
        if (next.has(aid)) next.delete(aid);
        else next.add(aid);
      }
      return next;
    });
  }, [pageAids]);

  /** 全选该收藏夹的所有页（逐页拉取，避免只选中当前页）。 */
  const selectWholeFolder = useCallback(async () => {
    setSelectAllBusy(true);
    setBatchError("");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const acc = new Set<string>(selected);
      let total = Number.POSITIVE_INFINITY;
      const MAX_PAGES = 100;
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const data = await invoke<any>("api_favorites", {
          page: String(page),
          sort: favoriteSort,
          folderId: favoriteFolderId,
          cookies: props.session.cookies,
        });
        const list: any[] = Array.isArray(data?.list) ? data.list : [];
        for (const item of list) {
          const aid = aidOf(item);
          if (aid && aid !== "-1") acc.add(aid);
        }
        const rawTotal = Number(data?.total);
        if (Number.isFinite(rawTotal)) total = rawTotal;
        if (list.length === 0 || acc.size >= total) break;
      }
      setSelected(acc);
    } catch (e) {
      if (isAuthExpiredError(e)) {
        props.onAuthExpired();
        return;
      }
      setBatchError(e instanceof Error ? e.message : String(e));
    } finally {
      setSelectAllBusy(false);
    }
  }, [favoriteFolderId, favoriteSort, props, selected]);

  /** 批量执行：两个动作共用一套进度与失败汇总。 */
  const runBatch = useCallback(
    async (verb: string, action: (aid: string) => Promise<unknown>) => {
      const aids = Array.from(selected);
      if (!aids.length) return;
      setBatchBusy(true);
      setBatchError("");
      setBatchProgress({ done: 0, total: aids.length, failed: 0 });
      const failureDetails: string[] = [];
      let failed = 0;
      let done = 0;
      try {
        for (const aid of aids) {
          try {
            await action(aid);
          } catch (e) {
            if (isAuthExpiredError(e)) {
              props.onAuthExpired();
              return;
            }
            failed += 1;
            // 只留前几条明细，但计数照实累计
            if (failureDetails.length < 3) {
              failureDetails.push(`${aid}：${e instanceof Error ? e.message : String(e)}`);
            }
          } finally {
            done += 1;
            setBatchProgress({ done, total: aids.length, failed });
          }
        }
      } finally {
        setBatchBusy(false);
      }
      setSelected(new Set());
      setMovePanelOpen(false);
      await mutate();
      showToast({
        ok: failed === 0,
        text:
          failed === 0
            ? `${verb}完成（${aids.length} 个）`
            : `${verb}完成：${aids.length - failed} 个成功，${failed} 个失败`,
      });
      if (failed) {
        setBatchError(`失败 ${failed} 个：${failureDetails.join("；")}${failed > failureDetails.length ? " …" : ""}`);
      }
    },
    [mutate, props, selected, showToast],
  );

  const batchMove = useCallback(
    async (folderId: string, folderName: string) => {
      const { invoke } = await import("@tauri-apps/api/core");
      await runBatch(`移动到「${folderName}」`, (aid) =>
        invoke("api_favorite_folder_move", { aid, folderId, cookies: props.session.cookies }),
      );
    },
    [props.session.cookies, runBatch],
  );

  const batchUnfavorite = useCallback(async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    await runBatch("取消收藏", (aid) =>
      invoke("api_favorite_toggle", { aid, cookies: props.session.cookies }),
    );
  }, [props.session.cookies, runBatch]);

  const selectedCount = selected.size;
  const allPageSelected = pageAids.length > 0 && pageAids.every((aid) => selected.has(aid));

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-600 shadow-sm">
        收藏(在线) · {header}
      </div>

      <div className="min-w-0 overflow-hidden rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="text-sm font-medium text-zinc-900">列表</div>
          <button
            type="button"
            className={[
              "inline-flex h-8 items-center gap-1 rounded-md border px-3 text-sm",
              batchMode
                ? "border-zinc-900 bg-zinc-900 font-medium text-white hover:bg-zinc-800"
                : "border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50",
            ].join(" ")}
            data-batch-toggle
            onClick={() => (batchMode ? exitBatch() : setBatchMode(true))}
          >
            {batchMode ? <X className="h-3.5 w-3.5" /> : <CheckSquare className="h-3.5 w-3.5" />}
            {batchMode ? "退出批量" : "批量整理"}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            className="h-9 rounded-md border border-zinc-200 bg-white px-2 text-sm"
            value={favoriteSort}
            onChange={(e) => patchParams({ sort: e.currentTarget.value as FavoriteSort, page: 1 })}
            disabled={batchMode}
          >
            <option value="mr">按收藏时间</option>
            <option value="mp">按更新时间</option>
          </select>
          <select
            className="h-9 min-w-[140px] rounded-md border border-zinc-200 bg-white px-2 text-sm"
            value={favoriteFolderId}
            onChange={(e) => patchParams({ folder: e.currentTarget.value, page: 1 })}
            disabled={batchMode}
          >
            <option value="0">默认文件夹</option>
            {favoriteFolders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm hover:bg-zinc-50"
              onClick={() => patchParams({ page: Math.max(1, favoritePage - 1) })}
              disabled={favoriteLoading || favoritePage <= 1}
            >
              上一页
            </button>
            <button
              type="button"
              className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm hover:bg-zinc-50"
              onClick={() => patchParams({ page: favoritePage + 1 })}
              disabled={favoriteLoading}
            >
              下一页
            </button>
            <button
              type="button"
              className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm hover:bg-zinc-50"
              onClick={() => void mutate()}
              disabled={favoriteLoading}
            >
              刷新
            </button>
          </div>
          <ListViewToggle value={viewMode} onChange={setViewMode} />
        </div>

        {batchMode ? (
          <div className="mt-3 rounded-md border border-zinc-900/20 bg-zinc-50 p-3" data-batch-bar>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium text-zinc-900">已选 {selectedCount} 个</span>
              <button
                type="button"
                className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs hover:bg-zinc-50 disabled:opacity-60"
                onClick={allPageSelected ? () => setSelected(new Set()) : selectPage}
                disabled={batchBusy || pageAids.length === 0}
              >
                {allPageSelected ? "取消本页" : "全选本页"}
              </button>
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 text-xs hover:bg-zinc-50 disabled:opacity-60"
                onClick={() => void selectWholeFolder()}
                disabled={batchBusy || selectAllBusy}
              >
                {selectAllBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                全选该收藏夹（所有页）
              </button>
              <button
                type="button"
                className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs hover:bg-zinc-50 disabled:opacity-60"
                onClick={invertPage}
                disabled={batchBusy || pageAids.length === 0}
              >
                反选本页
              </button>
              <button
                type="button"
                className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs hover:bg-zinc-50 disabled:opacity-60"
                onClick={() => setSelected(new Set())}
                disabled={batchBusy || selectedCount === 0}
              >
                清空选择
              </button>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-batch-move
                className="inline-flex h-9 items-center gap-1 rounded-md bg-zinc-900 px-3 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
                onClick={() => setMovePanelOpen((v) => !v)}
                disabled={batchBusy || selectedCount === 0}
              >
                <FolderInput className="h-4 w-4" />
                移动到收藏夹
              </button>
              <button
                type="button"
                data-batch-unfavorite
                className="inline-flex h-9 items-center gap-1 rounded-md border border-zinc-200 bg-white px-3 text-sm text-red-600 hover:bg-zinc-50 disabled:opacity-60"
                onClick={() => void batchUnfavorite()}
                disabled={batchBusy || selectedCount === 0}
              >
                <Trash2 className="h-4 w-4" />
                取消收藏
              </button>
              {batchBusy && batchProgress ? (
                <span className="text-xs text-zinc-600" data-batch-progress>
                  正在处理 {batchProgress.done}/{batchProgress.total}
                  {batchProgress.failed ? ` · 失败 ${batchProgress.failed}` : ""}
                </span>
              ) : null}
            </div>

            {movePanelOpen ? (
              <div className="mt-3 rounded-md border border-zinc-200 bg-white p-3" data-batch-move-panel>
                <div className="mb-2 text-sm font-medium text-zinc-900">
                  把选中的 {selectedCount} 个本子移动到：
                </div>
                <div className="flex flex-wrap gap-2">
                  {favoriteFolders.length === 0 ? (
                    <div className="text-sm text-zinc-500">还没有其它收藏夹，先建一个。</div>
                  ) : null}
                  {favoriteFolders.map((folder) => (
                    <button
                      key={folder.id}
                      type="button"
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
                      data-batch-move-target={folder.id}
                      onClick={() => void batchMove(folder.id, folder.name)}
                      disabled={batchBusy || folder.id === favoriteFolderId}
                      title={folder.id === favoriteFolderId ? "已经在这个收藏夹里" : undefined}
                    >
                      {folder.name}
                      {folder.id === favoriteFolderId ? (
                        <span className="text-xs text-zinc-400">（当前）</span>
                      ) : null}
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    className="h-8 min-w-[160px] flex-1 rounded-md border border-zinc-200 bg-white px-3 text-sm"
                    placeholder="新建收藏夹名称"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.currentTarget.value)}
                  />
                  <button
                    type="button"
                    className="h-8 rounded-md border border-zinc-200 bg-white px-3 text-sm hover:bg-zinc-50 disabled:opacity-60"
                    onClick={() => void addFolder()}
                    disabled={!newFolderName.trim() || batchBusy}
                  >
                    新建
                  </button>
                </div>
              </div>
            ) : null}

            {batchError ? (
              <div className="mt-2 rounded-md border border-zinc-200 bg-white p-2 text-xs text-red-600">
                {batchError}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              className="h-9 flex-1 rounded-md border border-zinc-200 bg-white px-3 text-sm"
              placeholder="新建收藏文件夹名称"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.currentTarget.value)}
            />
            <button
              type="button"
              className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm hover:bg-zinc-50"
              onClick={() => void addFolder()}
              disabled={!newFolderName.trim() || favoriteLoading}
            >
              新建
            </button>
            <button
              type="button"
              className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm text-red-600 hover:bg-zinc-50"
              onClick={() => void delFolder(favoriteFolderId)}
              disabled={favoriteFolderId === "0" || favoriteLoading}
            >
              删除当前文件夹
            </button>
          </div>
        )}

        {favoriteErrorText || actionError ? (
          <div className="mt-3 rounded-md border border-zinc-200 bg-white p-2 text-sm text-red-600">
            {favoriteErrorText || actionError}
          </div>
        ) : null}

        {favoriteLoading ? (
          <Loading />
        ) : (
          <div className="mt-3 text-sm text-zinc-600">当前页 {favoriteList.length} 条</div>
        )}

        {viewMode === "card" ? (
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
            {favoriteList.map((item, idx) => {
              const aid = aidOf(item);
              const title = titleOf(item, idx);
              const author = authorOf(item);
              const progress = aid ? getReadProgress(aid) : null;
              const cover = aid ? `${getImgBase()}/media/albums/${aid}_3x4.jpg` : "";
              const picked = Boolean(aid) && selected.has(aid);
              return (
                <div
                  key={`${aid}-${idx}`}
                  data-favorite-card={aid}
                  data-favorite-picked={picked ? "1" : "0"}
                  className={[
                    "flex h-full flex-col overflow-hidden rounded-md border bg-white",
                    picked ? "border-zinc-900 ring-2 ring-zinc-900/20" : "border-zinc-200",
                  ].join(" ")}
                >
                  <button
                    type="button"
                    className="relative aspect-[3/4] w-full overflow-hidden bg-zinc-100"
                    onClick={() => (batchMode ? toggleSelect(aid) : aid && props.onOpenComic(aid))}
                    disabled={!aid}
                  >
                    <CoverImage src={cover} alt={title} aid={aid} className="h-full w-full object-cover" />
                    {batchMode ? (
                      <span className="absolute left-1 top-1 rounded bg-white/90 p-0.5 text-zinc-900 shadow-sm">
                        {picked ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                      </span>
                    ) : null}
                  </button>
                  <div className="flex flex-1 flex-col gap-1 p-2">
                    <button
                      type="button"
                      className="line-clamp-2 text-left text-sm font-medium text-zinc-900 hover:underline"
                      onClick={() => (batchMode ? toggleSelect(aid) : aid && props.onOpenComic(aid))}
                      disabled={!aid}
                    >
                      {title}
                    </button>
                    <div className="truncate text-xs text-zinc-600">
                      {author ? `作者：${author}` : "作者：—"}
                    </div>
                    <div className="truncate text-xs text-zinc-500">AID：{aid || "—"}</div>
                    {batchMode ? null : (
                      <div className="mt-auto flex items-center gap-2">
                        <button
                          type="button"
                          className="h-7 flex-1 rounded-md border border-zinc-200 bg-white text-xs text-zinc-900 hover:bg-zinc-50"
                          onClick={() => aid && openReaderFromAid(aid, progress)}
                          disabled={!aid || favoriteLoading}
                        >
                          {progress?.chapterId ? "继续阅读" : "阅读"}
                        </button>
                        <Button
                          className="h-7 flex-1 rounded-md border border-zinc-200 bg-white text-xs text-red-600 hover:bg-zinc-50"
                          onClick={() => aid && toggleFavorite(aid)}
                          disabled={!aid || favoriteLoading}
                          loading={!!toggleLoadingMap[aid]}
                        >
                          取消收藏
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-3 flex min-w-0 flex-col gap-2">
            {favoriteList.map((item, idx) => {
              const aid = aidOf(item);
              const title = titleOf(item, idx);
              const author = authorOf(item);
              const progress = aid ? getReadProgress(aid) : null;
              const cover = aid ? `${getImgBase()}/media/albums/${aid}_3x4.jpg` : "";
              const picked = Boolean(aid) && selected.has(aid);
              return (
                <div
                  key={`${aid}-${idx}`}
                  data-favorite-row={aid}
                  data-favorite-picked={picked ? "1" : "0"}
                  className={[
                    "flex min-w-0 items-center gap-3 overflow-hidden rounded-md border bg-white px-3 py-2",
                    picked ? "border-zinc-900 ring-2 ring-zinc-900/20" : "border-zinc-200",
                  ].join(" ")}
                >
                  {batchMode ? (
                    <button
                      type="button"
                      className="flex-none text-zinc-700"
                      aria-label={`选择 ${title}`}
                      onClick={() => toggleSelect(aid)}
                      disabled={!aid}
                    >
                      {picked ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                    </button>
                  ) : null}
                  <div className="relative h-16 w-12 flex-none overflow-hidden rounded bg-zinc-100">
                    <CoverImage src={cover} alt={title} aid={aid} className="h-full w-full object-cover" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      className="line-clamp-2 w-full text-left text-sm font-medium text-zinc-900 hover:underline"
                      onClick={() => (batchMode ? toggleSelect(aid) : aid && props.onOpenComic(aid))}
                      disabled={!aid}
                    >
                      {title}
                    </button>
                    <div className="truncate text-xs text-zinc-600">
                      {author ? `作者：${author} · ` : ""}
                      AID：{aid || "—"}
                    </div>
                  </div>
                  {batchMode ? null : (
                    <div className="flex flex-none items-center gap-2">
                      <button
                        type="button"
                        className="h-8 whitespace-nowrap rounded-md border border-zinc-200 bg-white px-2 text-sm text-zinc-900 hover:bg-zinc-50"
                        onClick={() => aid && openReaderFromAid(aid, progress)}
                        disabled={!aid || favoriteLoading}
                      >
                        {progress?.chapterId ? "继续阅读" : "阅读"}
                      </button>
                      <Button
                        className="h-8 whitespace-nowrap rounded-md border border-zinc-200 bg-white px-2 text-sm text-red-600 hover:bg-zinc-50"
                        onClick={() => aid && toggleFavorite(aid)}
                        disabled={!aid || favoriteLoading}
                        loading={!!toggleLoadingMap[aid]}
                      >
                        取消收藏
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
