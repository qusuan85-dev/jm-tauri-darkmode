import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, Home, RefreshCw } from "lucide-react";

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  error: Error | null;
};

export default class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled application error", error, info.componentStack);
  }

  private reload = () => {
    window.location.reload();
  };

  private goHome = () => {
    window.location.hash = "#/home/home";
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="safe-area-top flex min-h-[100dvh] items-center justify-center bg-zinc-100 p-5 text-zinc-900">
        <section
          className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
          role="alert"
          aria-labelledby="app-error-title"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-pill bg-red-500/10 text-red-600">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h1 id="app-error-title" className="mt-5 text-xl font-semibold">
            页面暂时无法显示
          </h1>
          <p className="mt-2 text-sm leading-6 text-zinc-600">
            某个页面模块加载失败，或遇到了未处理的异常。重新加载通常可以恢复，已保存的登录状态不会丢失。
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-pill bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800"
              onClick={this.reload}
            >
              <RefreshCw className="h-4 w-4" />
              重新加载
            </button>
            <button
              type="button"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-pill border border-zinc-300 px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              onClick={this.goHome}
            >
              <Home className="h-4 w-4" />
              返回首页
            </button>
          </div>
          <details className="mt-5 rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
            <summary className="cursor-pointer select-none">错误详情</summary>
            <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-words font-mono">
              {this.state.error.message || String(this.state.error)}
            </pre>
          </details>
        </section>
      </main>
    );
  }
}
