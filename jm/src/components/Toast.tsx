import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertCircle, CheckCircle2, X } from "lucide-react";

type ToastPayload = {
  ok: boolean;
  text: string;
  durationMs?: number;
};

type ToastState = {
  ok: boolean;
  text: string;
} | null;

type ToastContextValue = {
  showToast: (payload: ToastPayload) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}

export function ToastProvider(props: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null);
  const timerRef = useRef<number | null>(null);

  const dismiss = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setToast(null);
  }, []);

  const showToast = useCallback((payload: ToastPayload) => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setToast({ ok: payload.ok, text: payload.text });
    const duration = payload.durationMs ?? (payload.ok ? 1600 : 2200);
    timerRef.current = window.setTimeout(() => {
      setToast(null);
      timerRef.current = null;
    }, duration);
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {props.children}
      {toast ? (
        <div className="pointer-events-none fixed inset-x-4 top-[calc(var(--safe-area-top)+0.75rem)] z-40 flex justify-end">
          <div
            role={toast.ok ? "status" : "alert"}
            aria-live={toast.ok ? "polite" : "assertive"}
            className={`jm-toast-in pointer-events-auto flex max-w-sm items-start gap-2 rounded-xl px-3.5 py-3 text-sm text-white shadow-lg ${
              toast.ok ? "bg-teal-500/85" : "bg-red-600/85"
            }`}
          >
            {toast.ok ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
            ) : (
              <AlertCircle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
            )}
            <span className="min-w-0 flex-1 leading-5">{toast.text}</span>
            <button
              type="button"
              className="-mr-1 flex h-6 w-6 flex-none items-center justify-center rounded-pill text-white/75 hover:bg-white/10 hover:text-white"
              aria-label="关闭提示"
              onClick={dismiss}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}
