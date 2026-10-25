import { useEffect, useState } from "react";
import { BookOpen, LoaderCircle, LogIn } from "lucide-react";

const MANUAL_LOGIN_DELAY_MS = 4_000;

export default function StartupSplash(props: { onManualLogin: () => void }) {
  const [showManualLogin, setShowManualLogin] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setShowManualLogin(true), MANUAL_LOGIN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <main
      className="safe-area-top relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-zinc-100 p-6 text-zinc-900"
      role="status"
      aria-live="polite"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-28 h-72 w-72 rounded-pill bg-accent/10 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 -left-20 h-80 w-80 rounded-pill bg-accent/5 blur-3xl"
      />

      <div className="relative flex w-full max-w-sm flex-col items-center text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-accent-strong text-accent-fg shadow-lg shadow-accent/20">
          <BookOpen className="h-7 w-7" />
        </div>
        <div className="mt-5 font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-500">
          JM · PERSONAL READER
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">正在自动登录…</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-600">
          正在恢复上次的登录状态并准备书架，请稍候。
        </p>

        <div className="mt-6 flex items-center gap-2 text-sm text-zinc-500">
          <LoaderCircle className="h-4 w-4 animate-spin text-accent" />
          <span>正在连接安全会话</span>
        </div>

        <div className="mt-7 h-1 w-40 overflow-hidden rounded-pill bg-zinc-200">
          <div className="h-full w-1/2 animate-pulse rounded-pill bg-accent" />
        </div>

        {showManualLogin ? (
          <div className="mt-7 w-full rounded-lg border border-zinc-200 bg-white/90 p-3">
            <div className="text-xs leading-5 text-zinc-500">
              自动登录耗时较长，可以继续等待，或改用手动登录。
            </div>
            <button
              type="button"
              className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-pill border border-zinc-300 px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
              onClick={props.onManualLogin}
            >
              <LogIn className="h-4 w-4" />
              手动登录
            </button>
          </div>
        ) : null}
      </div>
    </main>
  );
}
