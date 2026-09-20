/**
 * Which albums currently have a local reading cache (一键缓存), as a tiny shared
 * store.
 *
 * Every list page and the detail page wants to show a「已缓存」badge, and each of
 * them would otherwise have to ask the backend for the same list. The set is read
 * once, shared through a subscription, and refreshed explicitly after anything
 * that adds or removes cached pages.
 */
import { useEffect, useState } from "react";

type Listener = () => void;

let aids: ReadonlySet<string> = new Set<string>();
let loaded = false;
let inflight: Promise<ReadonlySet<string>> | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of Array.from(listeners)) {
    try {
      listener();
    } catch {
      // a broken listener must not stop the others
    }
  }
}

/** Reloads the cached-album ids from the backend. Safe to call often. */
export function refreshCachedAlbums(): Promise<ReadonlySet<string>> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const rows = await invoke<Array<{ aid?: unknown }>>("api_read_cache_list");
      const next = new Set<string>();
      if (Array.isArray(rows)) {
        for (const row of rows) {
          const aid = row?.aid;
          if (aid == null) continue;
          const text = String(aid).trim();
          if (text) next.add(text);
        }
      }
      aids = next;
      loaded = true;
      return next;
    } catch {
      // Keep whatever we had: the badge is a nicety, never worth an error toast.
      return aids;
    } finally {
      inflight = null;
      emit();
    }
  })();
  return inflight;
}

/** Current set, subscribing the component to later refreshes. */
export function useCachedAlbums(): ReadonlySet<string> {
  const [snapshot, setSnapshot] = useState<ReadonlySet<string>>(aids);

  useEffect(() => {
    const listener = () => setSnapshot(aids);
    listeners.add(listener);
    if (!loaded) void refreshCachedAlbums();
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return snapshot;
}

export function isCachedAid(set: ReadonlySet<string>, aid: unknown): boolean {
  if (aid == null) return false;
  const text = String(aid).trim();
  return text.length > 0 && set.has(text);
}
