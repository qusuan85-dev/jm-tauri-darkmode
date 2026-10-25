import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  HashRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";

import type { LoginResult, Session } from "./auth/session";
import { clearSession, isAccountSession, loadSession, saveSession } from "./auth/session";
import Loading from "./components/Loading";
import SideNav from "./components/SideNav";
import StartupSplash from "./components/StartupSplash";
import { ToastProvider, useToast } from "./components/Toast";
import HomePage from "./pages/HomePage";
import {
  createReadingWorkFromChapters,
  normalizeReadingWork,
} from "./reading/navigation";
import type { ChapterNavItem, ReadingSource, ReadingTarget, ReadingWork } from "./reading/navigation";
import { readStorage, writeStorage } from "./utils/storage";
import { decodeUtf8Base64 } from "./utils/utf8Base64";

const ComicDetailPage = lazy(() => import("./pages/ComicDetailPage"));
const ReadingPage = lazy(() => import("./pages/ReadingPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const FavoritesPage = lazy(() => import("./pages/FavoritesPage"));
const CachedPage = lazy(() => import("./pages/CachedPage"));
const DailyPage = lazy(() => import("./pages/DailyPage"));
const CategoryRankPage = lazy(() => import("./pages/CategoryRankPage"));
const HistoryPage = lazy(() => import("./pages/HistoryPage"));
const SearchPage = lazy(() => import("./pages/SearchPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));

type HomeSub =
  | "home"
  | "favorites"
  | "cached"
  | "daily"
  | "category_rank"
  | "history"
  | "search"
  | "settings";

type ReadingState = {
  work?: ReadingWork;
  chapterTitle?: string;
  chapters?: ChapterNavItem[];
  startPage?: number;
  homeSub?: HomeSub;
  fromPath?: string;
  returnTo?: {
    path: string;
    fromPath?: string;
    historyBack?: boolean;
  };
  source?: ReadingSource;
};

function buildReadingPath(aid: string, chapterId: string, chapterTitle?: string) {
  const params = new URLSearchParams();
  if (chapterTitle) params.set("ct", chapterTitle);
  const qs = params.toString();
  return qs ? `/reading/${aid}/${chapterId}?${qs}` : `/reading/${aid}/${chapterId}`;
}

function isSignedToday(record: unknown): boolean {
  const today = new Date().getDate();
  if (!Array.isArray(record)) return false;
  for (const row of record) {
    if (!Array.isArray(row)) continue;
    for (const item of row) {
      const date = Number((item as { date?: unknown }).date);
      const signed = Boolean((item as { signed?: unknown }).signed);
      if (!Number.isNaN(date) && date === today) return signed;
    }
  }
  return false;
}

function extractDailyId(data: any): string {
  const raw = data?.daily_id ?? data?.dailyId ?? data?.dailyID ?? data?.dailyId;
  if (raw == null) return "";
  return String(raw);
}

function normalizeHomeSub(value?: string): HomeSub {
  switch (value) {
    case "favorites":
    case "cached":
    case "daily":
    case "category_rank":
    case "history":
    case "search":
    case "settings":
    case "home":
      return value;
    default:
      return "home";
  }
}

function homeTitle(sub: HomeSub) {
  switch (sub) {
    case "favorites":
      return "在线收藏";
    case "cached":
      return "已缓存";
    case "daily":
      return "签到";
    case "category_rank":
      return "分类与排行";
    case "history":
      return "浏览记录";
    case "search":
      return "搜索";
    case "settings":
      return "设置";
    default:
      return "首页";
  }
}

// 静默补登的上限：避免接口持续报失效时无限重登刷屏
const MAX_SILENT_LOGIN = 3;
const SILENT_LOGIN_TIMEOUT_MS = 10_000;

function withTimeout<T>(task: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    task.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function autoSignEnabled(): boolean {
  return readStorage("jm_auto_sign") === "1";
}

function RequireSession(props: { session: Session | null; children: React.ReactElement }) {
  const location = useLocation();
  if (!props.session) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return props.children;
}

function LoginRoute(props: { session: Session | null; onLoggedIn: (s: Session) => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  if (props.session) return <Navigate to="/home/home" replace />;

  const from = (
    location.state as
      | { from?: { pathname?: string; search?: string; hash?: string } }
      | null
  )?.from;
  const fromPath = from?.pathname
    ? `${from.pathname}${from.search ?? ""}${from.hash ?? ""}`
    : "";
  const target = fromPath && fromPath !== "/login" ? fromPath : "/home/home";

  return (
    <LoginPage
      onLoggedIn={(s) => {
        props.onLoggedIn(s);
        navigate(target, { replace: true });
      }}
    />
  );
}

function clearBackendSession(): void {
  void (async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("api_session_clear");
    } catch {
      // ignore
    }
  })();
}

function HomeLayout(props: {
  session: Session;
  onLogout: () => void;
  onAuthExpired: () => void;
  ensureLogin: () => Promise<boolean>;
}) {
  const location = useLocation();
  const activeSub = normalizeHomeSub(location.pathname.split("/")[2]);
  const user = props.session.user;

  return (
    <div className="safe-area-top home-mobile-safe-bottom min-h-screen bg-zinc-100 p-4 text-zinc-900 sm:p-6">
      <div className="mx-auto flex w-full min-w-0 max-w-[900px] flex-col gap-4">
        <div className="hidden items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-sm md:flex">
          <div className="flex flex-col">
            <div className="text-base font-semibold text-zinc-900">{homeTitle(activeSub)}</div>
            <div className="text-sm text-zinc-600">
              {user.username} · LV{user.level}
            </div>
          </div>
          <div className="rounded-pill bg-zinc-50 px-3 py-1.5 font-mono text-xs text-zinc-600">
            {Number(user.coin).toLocaleString()} coin
          </div>
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
          <div className="hidden md:block">
            <div className="sticky top-6">
              <SideNav
                variant="sidebar"
                user={{
                  username: user.username,
                  uid: user.uid,
                  level: user.level,
                  levelName: user.level_name,
                }}
              />
            </div>
          </div>

          <div className="min-w-0">
            <Suspense fallback={<Loading className="min-h-[45vh]" label="正在打开页面" />}>
              <Routes>
                <Route
                  path="home"
                  element={<HomeRoute session={props.session} onAuthExpired={props.onAuthExpired} />}
                />
                <Route
                  path="favorites"
                  element={<FavoritesRoute session={props.session} onAuthExpired={props.onAuthExpired} />}
                />
                <Route
                  path="cached"
                  element={<CachedRoute session={props.session} />}
                />
                <Route
                  path="daily"
                  element={
                    <DailyPage
                      session={props.session}
                      onAuthExpired={props.onAuthExpired}
                      ensureLogin={props.ensureLogin}
                    />
                  }
                />
                <Route
                  path="category_rank"
                  element={<CategoryRankRoute session={props.session} onAuthExpired={props.onAuthExpired} />}
                />
                <Route
                  path="history"
                  element={<HistoryRoute session={props.session} onAuthExpired={props.onAuthExpired} />}
                />
                <Route
                  path="search"
                  element={<SearchRoute session={props.session} onAuthExpired={props.onAuthExpired} />}
                />
                <Route
                  path="settings"
                  element={<SettingsPage session={props.session} onLogout={props.onLogout} />}
                />
                <Route path="" element={<Navigate to="home" replace />} />
              </Routes>
            </Suspense>
          </div>
        </div>
      </div>

      <div className="md:hidden">
        <SideNav variant="bottom" />
      </div>
    </div>
  );
}

function HomeRoute(props: { session: Session; onAuthExpired: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const fromPath = `${location.pathname}${location.search}`;
  const openComic = useCallback(
    (aid: string) => navigate(`/detail/${aid}`, { state: { fromPath } }),
    [fromPath, navigate],
  );

  return <HomePage session={props.session} onAuthExpired={props.onAuthExpired} onOpenComic={openComic} />;
}

function FavoritesRoute(props: { session: Session; onAuthExpired: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const fromPath = `${location.pathname}${location.search}`;
  const openComic = useCallback(
    (aid: string) => navigate(`/detail/${aid}`, { state: { fromPath } }),
    [fromPath, navigate],
  );
  const openReader = useCallback(
    (aid: string, chapterId: string, chapterTitle: string, chapters: ChapterNavItem[], startPage?: number) =>
      navigate(buildReadingPath(aid, chapterId, chapterTitle), {
        state: {
          work: createReadingWorkFromChapters(aid, chapters, "jm"),
          chapterTitle,
          chapters,
          startPage,
          homeSub: "favorites",
          fromPath,
          returnTo: { path: fromPath },
        } satisfies ReadingState,
      }),
    [fromPath, navigate],
  );

  return (
    <FavoritesPage
      session={props.session}
      onAuthExpired={props.onAuthExpired}
      onOpenComic={openComic}
      onOpenReader={openReader}
    />
  );
}

function CachedRoute(props: { session: Session }) {
  const navigate = useNavigate();
  const location = useLocation();
  const fromPath = `${location.pathname}${location.search}`;
  const openComic = useCallback(
    (aid: string) => navigate(`/detail/${aid}`, { state: { fromPath } }),
    [fromPath, navigate],
  );
  const openReader = useCallback(
    (aid: string, chapterId: string, chapterTitle: string, chapters: ChapterNavItem[], startPage?: number) =>
      navigate(buildReadingPath(aid, chapterId, chapterTitle), {
        state: {
          work: createReadingWorkFromChapters(aid, chapters, "jm"),
          chapterTitle,
          chapters,
          startPage,
          homeSub: "cached",
          fromPath,
          returnTo: { path: fromPath },
        } satisfies ReadingState,
      }),
    [fromPath, navigate],
  );

  return <CachedPage session={props.session} onOpenComic={openComic} onOpenReader={openReader} />;
}

function CategoryRankRoute(props: { session: Session; onAuthExpired: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const fromPath = `${location.pathname}${location.search}`;
  const openComic = useCallback(
    (aid: string) => navigate(`/detail/${aid}`, { state: { fromPath } }),
    [fromPath, navigate],
  );

  return (
    <CategoryRankPage
      session={props.session}
      onAuthExpired={props.onAuthExpired}
      onOpenComic={openComic}
      onOpenSearch={(query) => {
        writeStorage("jm_search_prefill", query);
        navigate("/home/search");
      }}
    />
  );
}

function HistoryRoute(props: { session: Session; onAuthExpired: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const fromPath = `${location.pathname}${location.search}`;
  const openComic = useCallback(
    (aid: string) => navigate(`/detail/${aid}`, { state: { fromPath } }),
    [fromPath, navigate],
  );
  const openReader = useCallback(
    (aid: string, chapterId: string, chapterTitle: string, chapters: ChapterNavItem[], startPage?: number) =>
      navigate(buildReadingPath(aid, chapterId, chapterTitle), {
        state: {
          work: createReadingWorkFromChapters(aid, chapters, "jm"),
          chapterTitle,
          chapters,
          startPage,
          homeSub: "history",
          fromPath,
          returnTo: { path: fromPath },
        } satisfies ReadingState,
      }),
    [fromPath, navigate],
  );
  return (
    <HistoryPage
      session={props.session}
      onAuthExpired={props.onAuthExpired}
      onOpenComic={openComic}
      onOpenReader={openReader}
    />
  );
}

function SearchRoute(props: { session: Session; onAuthExpired: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const fromPath = `${location.pathname}${location.search}`;
  const openComic = useCallback(
    (aid: string) => navigate(`/detail/${aid}`, { state: { fromPath } }),
    [fromPath, navigate],
  );

  return <SearchPage session={props.session} onAuthExpired={props.onAuthExpired} onOpenComic={openComic} />;
}

function DetailRoute(props: { session: Session; onAuthExpired: () => void }) {
  const { aid } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const fromPath = (location.state as { fromPath?: string } | null)?.fromPath;
  if (!aid) return <Navigate to="/home/home" replace />;

  return (
    <ComicDetailPage
      session={props.session}
      aid={aid}
      onBack={() => {
        if (fromPath) navigate(fromPath, { replace: true });
        else navigate(-1);
      }}
      onAuthExpired={props.onAuthExpired}
      onOpenSearch={(query) => {
        writeStorage("jm_search_prefill", query);
        navigate("/home/search");
      }}
      onOpenReader={(target: ReadingTarget, startPage) =>
        navigate(buildReadingPath(target.work.workId, target.chapterId, target.chapterTitle), {
          state: {
            work: target.work,
            chapterTitle: target.chapterTitle,
            chapters: target.work.chapters,
            startPage,
            fromPath: fromPath ?? `/detail/${aid}`,
            returnTo: {
              path: `/detail/${aid}`,
              fromPath,
              historyBack: true,
            },
          } satisfies ReadingState,
        })
      }
    />
  );
}

function ReadingRoute(props: { session: Session }) {
  const { aid, chapterId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as ReadingState;
  const searchParams = new URLSearchParams(location.search);

  if (!aid || !chapterId) return <Navigate to="/home/home" replace />;

  const fallbackChapters = Array.isArray(state.chapters) ? state.chapters : [];
  const source = state.source ?? "jm";
  const work = normalizeReadingWork(state.work, aid, fallbackChapters, source);
  const workId = work.workId || aid;
  const chapters = work.chapters;
  const chapterTitle = state.chapterTitle ?? searchParams.get("ct") ?? "";
  const startPage = typeof state.startPage === "number" ? state.startPage : undefined;
  const homeSub = normalizeHomeSub(state.homeSub);
  const legacyFromPath = state.fromPath ?? `/detail/${work.requestedAid || workId}`;
  const returnTo =
    state.returnTo && typeof state.returnTo.path === "string" && state.returnTo.path
      ? state.returnTo
      : { path: legacyFromPath };

  return (
    <ReadingPage
      session={props.session}
      aid={workId}
      chapterId={chapterId}
      chapterTitle={chapterTitle}
      chapters={chapters}
      startPage={startPage}
      backLabel={returnTo.path.startsWith("/detail/") ? "返回详情" : "返回列表"}
      onBack={() => {
        if (returnTo.historyBack) {
          navigate(-1);
          return;
        }
        navigate(returnTo.path, {
          replace: true,
          state: returnTo.fromPath ? { fromPath: returnTo.fromPath } : undefined,
        });
      }}
      onGoHome={() => navigate(`/home/${homeSub}`)}
      onOpenChapter={(nextId, nextTitle) =>
        navigate(buildReadingPath(workId, nextId, nextTitle), {
          replace: true,
          state: {
            work,
            chapterTitle: nextTitle,
            chapters,
            homeSub,
            fromPath: legacyFromPath,
            returnTo,
          } satisfies ReadingState,
        })
      }
    />
  );
}

function AppRoutes() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const navigate = useNavigate();
  const { showToast } = useToast();
  const autoSignRef = useRef<string | null>(null);
  const startupLoginTriedRef = useRef(false);
  const silentLoginCountRef = useRef(0);
  const silentLoginInFlightRef = useRef<Promise<boolean> | null>(null);
  const [startupCheckDone, setStartupCheckDone] = useState(
    () => isAccountSession(session),
  );

  const onLoggedIn = useCallback((s: Session) => {
    silentLoginCountRef.current = 0;
    // A fresh manual login gets one fresh automatic check-in attempt.
    autoSignRef.current = null;
    setSession(s);
  }, []);

  const onLogout = useCallback(() => {
    autoSignRef.current = null;
    clearSession();
    clearBackendSession();
    setSession(null);
  }, []);

  /**
   * 用已保存的账密静默补登。
   *
   * resolve(true) 表示最终拿到了可用会话；resolve(false) 表示没有可用凭据或补登失败
   * （失败时会把会话清空，让路由回到登录页）。页面可以 await 它再决定下一步，
   * 而不必只靠「会话被顶掉」这条间接路径。
   *
   * 并发去重：已经有一次补登在飞就复用同一次请求。否则 StrictMode 的 effect
   * 双调用、或多个页面同时撞上登录失效，会发出重复的 login。
   */
  const silentReLogin = useCallback((): Promise<boolean> => {
    const inflight = silentLoginInFlightRef.current;
    if (inflight) return inflight;

    let username = "";
    let password = "";
    try {
      if (readStorage("jm_save_password") !== "1") return Promise.resolve(false);
      if (readStorage("jm_auto_login") !== "1") return Promise.resolve(false);
      username = readStorage("jm_login_username") ?? "";
      const raw = readStorage("jm_login_password_b64") ?? "";
      if (raw) password = decodeUtf8Base64(raw);
    } catch {
      return Promise.resolve(false);
    }
    if (!username.trim() || !password) return Promise.resolve(false);
    if (silentLoginCountRef.current >= MAX_SILENT_LOGIN) return Promise.resolve(false);
    silentLoginCountRef.current += 1;

    const pending = (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const result = await withTimeout(
          invoke<LoginResult>("login", { username, password }),
          SILENT_LOGIN_TIMEOUT_MS,
          "自动登录超时，请手动登录",
        );
        const nextSession: Session = { ...result, savedAt: Date.now() };
        silentLoginCountRef.current = 0;
        saveSession(nextSession);
        setSession(nextSession);
        showToast({ ok: true, text: "登录态已自动刷新" });
        return true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        showToast({ ok: false, text: `自动登录失败：${msg}` });
        // 补登也失败才真正退回登录页；不再把「自动登录」关掉，
        // 否则下次启动就再也不会自动登录了。
        clearSession();
        clearBackendSession();
        setSession(null);
        return false;
      } finally {
        silentLoginInFlightRef.current = null;
      }
    })();

    silentLoginInFlightRef.current = pending;
    return pending;
  }, [showToast]);

  /**
   * 确保当前是「能拉数据」的会话：已经有就直接返回 true，否则尝试静默补登。
   * 供需要真实账号的页面（如签到）在进入时调用。
   */
  const ensureLogin = useCallback((): Promise<boolean> => {
    // 只有「真实账号」会话才算已登录；游客会话同样要触发补登
    if (isAccountSession(session)) return Promise.resolve(true);
    return silentReLogin();
  }, [session, silentReLogin]);

  const onAuthExpired = useCallback(() => {
    // 登录态失效时先用已保存的账密补登，成功就留在当前页面；
    // 只有没有可用凭据（或补登失败）时才清空并回登录页。
    void silentReLogin();
  }, [silentReLogin]);

  useEffect(() => {
    if (startupLoginTriedRef.current) return;
    startupLoginTriedRef.current = true;

    // 已有真实账号会话时直接进入；游客或无效会话才在启动阶段自动登录。
    if (isAccountSession(session)) {
      setStartupCheckDone(true);
      return;
    }
    void silentReLogin().finally(() => setStartupCheckDone(true));
  }, [session, silentReLogin]);

  useEffect(() => {
    if (!session) return;
    if (!autoSignEnabled()) return;

    // 游客/无效会话打不了卡，等真实登录后再由 ensureLogin 触发
    if (!isAccountSession(session)) return;
    const uid = String(session.user.uid ?? "").trim();
    if (!uid || autoSignRef.current === uid) return;
    autoSignRef.current = uid;

    let cancelled = false;
    const run = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const daily = await invoke<any>("api_daily", {
          userId: uid,
          cookies: session.cookies,
        });
        if (cancelled) return;
        const data = daily?.data ?? daily;
        const record = data?.record ?? data?.records ?? [];
        if (isSignedToday(record)) {
          showToast({ ok: true, text: "今日已打卡" });
          return;
        }
        const dailyId = extractDailyId(data);
        if (!dailyId) return;
        await invoke("api_daily_check", {
          userId: uid,
          dailyId,
          cookies: session.cookies,
        });
        showToast({ ok: true, text: "自动打卡成功" });
      } catch {
        // ignore auto sign errors
        showToast({ ok: false, text: "自动打卡失败" });
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [session, showToast]);

  const homeLayout = useMemo(
    () =>
      session ? (
        <HomeLayout
          session={session}
          onLogout={onLogout}
          onAuthExpired={onAuthExpired}
          ensureLogin={ensureLogin}
        />
      ) : null,
    [ensureLogin, onAuthExpired, onLogout, session],
  );

  if (!startupCheckDone) {
    return (
      <StartupSplash
        onManualLogin={() => {
          setStartupCheckDone(true);
          navigate("/login", { replace: true });
        }}
      />
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginRoute session={session} onLoggedIn={onLoggedIn} />} />
      <Route
        path="/home/*"
        element={<RequireSession session={session}>{homeLayout as React.ReactElement}</RequireSession>}
      />
      <Route
        path="/detail/:aid"
        element={
          <RequireSession session={session}>
            <DetailRoute session={session!} onAuthExpired={onAuthExpired} />
          </RequireSession>
        }
      />
      <Route
        path="/reading/:aid/:chapterId"
        element={
          <RequireSession session={session}>
            <ReadingRoute session={session!} />
          </RequireSession>
        }
      />
      <Route path="*" element={<Navigate to={session ? "/home/home" : "/login"} replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <HashRouter>
      <ToastProvider>
        <AppRoutes />
      </ToastProvider>
    </HashRouter>
  );
}
