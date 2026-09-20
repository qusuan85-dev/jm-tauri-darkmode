/**
 * Application theme handling.
 *
 * Three modes are supported: an explicit `light` / `dark`, or `system` which
 * follows the OS setting and keeps following it while the app is open. The
 * resolved theme is expressed as a single `dark` class on <html>, which is what
 * the token layer in `src/index.css` reacts to.
 *
 * `index.html` contains a tiny inline copy of the resolution logic so the first
 * paint already has the right background (no white flash on cold start).
 */

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const KEY_THEME_MODE = "jm_theme_mode";
const THEME_EVENT = "jm:theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Mirrors `--jm-zinc-100` in index.css. */
const WINDOW_BACKGROUND: Record<ResolvedTheme, string> = {
  light: "#f4f4f5",
  dark: "#09090b",
};

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

export function getThemeMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(KEY_THEME_MODE);
    if (isThemeMode(raw)) return raw;
  } catch {
    // localStorage unavailable
  }
  return "system";
}

export function getSystemTheme(): ResolvedTheme {
  try {
    return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function resolveTheme(mode: ThemeMode = getThemeMode()): ResolvedTheme {
  return mode === "system" ? getSystemTheme() : mode;
}

let appliedTheme: ResolvedTheme | null = null;

/** Applies `mode` to the document and returns the theme actually in effect. */
export function applyTheme(mode: ThemeMode = getThemeMode()): ResolvedTheme {
  const resolved = resolveTheme(mode);
  const root = document.documentElement;

  root.classList.toggle("dark", resolved === "dark");
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  root.style.backgroundColor = WINDOW_BACKGROUND[resolved];

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", WINDOW_BACKGROUND[resolved]);

  if (appliedTheme !== resolved) {
    appliedTheme = resolved;
    syncSystemBars(resolved);
  }
  return resolved;
}

export function getAppliedTheme(): ResolvedTheme {
  return appliedTheme ?? resolveTheme();
}

export function setThemeMode(mode: ThemeMode): ResolvedTheme {
  try {
    if (mode === "system") localStorage.removeItem(KEY_THEME_MODE);
    else localStorage.setItem(KEY_THEME_MODE, mode);
  } catch {
    // localStorage unavailable
  }
  const resolved = applyTheme(mode);
  dispatch();
  return resolved;
}

export function subscribeTheme(callback: () => void): () => void {
  const handler = () => callback();
  window.addEventListener(THEME_EVENT, handler);
  return () => window.removeEventListener(THEME_EVENT, handler);
}

function dispatch() {
  window.dispatchEvent(new Event(THEME_EVENT));
}

/**
 * Native shell bridge, installed by `MainActivity` on Android.
 *
 * `tauri-plugin-edge-to-edge` derives the status/navigation bar icon colour from
 * the *system* night mode exactly once, when the plugin loads, and exposes no
 * command to change it later. Without this hand-off an explicit in-app theme
 * would leave the bar icons inverted (dark icons on a dark bar). On desktop and
 * in the browser the bridge is simply absent.
 */
type ShellBridge = {
  setDarkSystemBars?: (dark: boolean) => void;
};

function syncSystemBars(theme: ResolvedTheme) {
  const bridge = (window as unknown as { JMShell?: ShellBridge }).JMShell;
  if (typeof bridge?.setDarkSystemBars !== "function") return;
  try {
    bridge.setDarkSystemBars(theme === "dark");
  } catch {
    // Bridge present but unusable — nothing else to do.
  }
}

/**
 * Wires up system-theme following and cross-tab synchronisation. Returns a
 * cleanup function.
 */
export function initTheme(): () => void {
  applyTheme();

  let media: MediaQueryList | null = null;
  try {
    media = window.matchMedia(DARK_QUERY);
  } catch {
    media = null;
  }
  const onSystemChange = () => {
    if (getThemeMode() !== "system") return;
    applyTheme("system");
    dispatch();
  };
  media?.addEventListener("change", onSystemChange);

  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY_THEME_MODE) return;
    applyTheme();
    dispatch();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    media?.removeEventListener("change", onSystemChange);
    window.removeEventListener("storage", onStorage);
  };
}
