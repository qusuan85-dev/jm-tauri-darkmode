/**
 * Accent (theme colour) handling.
 *
 * The choice is expressed as a `data-accent` attribute on <html>; the actual
 * colours live in `src/index.css` so each hue has a light and a dark variant
 * with hand-checked contrast. Everything accent-coloured in the UI resolves
 * through the `--jm-accent*` custom properties.
 *
 * `index.html` mirrors this resolution before the first paint (see the inline
 * script there) so the app never flashes the wrong hue on cold start.
 */

export type AccentKey = "default" | "blue" | "purple" | "cyan" | "green" | "amber" | "pink";

const KEY_ACCENT = "jm_accent";
const ACCENT_EVENT = "jm:accent";

export const DEFAULT_ACCENT: AccentKey = "blue";

/** `swatch` is only used to paint the picker dots. */
export const ACCENTS: { key: AccentKey; label: string; swatch: string }[] = [
  { key: "blue", label: "蓝", swatch: "#2563eb" },
  { key: "purple", label: "紫", swatch: "#7c3aed" },
  { key: "cyan", label: "青", swatch: "#0e7490" },
  { key: "green", label: "绿", swatch: "#166534" },
  { key: "amber", label: "橙", swatch: "#b45309" },
  { key: "pink", label: "粉", swatch: "#be185d" },
  { key: "default", label: "默认", swatch: "#52525b" },
];

export function isAccentKey(value: unknown): value is AccentKey {
  return ACCENTS.some((a) => a.key === value);
}

export function getAccent(): AccentKey {
  try {
    const raw = localStorage.getItem(KEY_ACCENT);
    if (isAccentKey(raw)) return raw;
  } catch {
    // localStorage unavailable
  }
  return DEFAULT_ACCENT;
}

export function accentSwatch(key: AccentKey = getAccent()): string {
  return ACCENTS.find((a) => a.key === key)?.swatch ?? ACCENTS[0].swatch;
}

/** Applies `key` to the document and returns the accent actually in effect. */
export function applyAccent(key: AccentKey = getAccent()): AccentKey {
  document.documentElement.dataset.accent = key;
  return key;
}

export function setAccent(key: AccentKey): AccentKey {
  try {
    localStorage.setItem(KEY_ACCENT, key);
  } catch {
    // localStorage unavailable
  }
  const applied = applyAccent(key);
  window.dispatchEvent(new Event(ACCENT_EVENT));
  return applied;
}

export function subscribeAccent(callback: () => void): () => void {
  const handler = () => callback();
  window.addEventListener(ACCENT_EVENT, handler);
  return () => window.removeEventListener(ACCENT_EVENT, handler);
}

/** Wires up cross-tab synchronisation. Returns a cleanup function. */
export function initAccent(): () => void {
  applyAccent();
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY_ACCENT) return;
    applyAccent();
    window.dispatchEvent(new Event(ACCENT_EVENT));
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}
