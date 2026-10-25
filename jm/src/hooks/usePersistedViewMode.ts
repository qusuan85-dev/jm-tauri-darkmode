import { useEffect, useState } from "react";

import { readStorage, writeStorage } from "../utils/storage";

export type ViewMode = "list" | "card";

export function readViewMode(key: string, fallback: ViewMode = "list"): ViewMode {
  const stored = readStorage(key);
  if (stored === "card" || stored === "list") return stored;
  return fallback;
}

/** Persist a page's list/card preference without repeating storage plumbing. */
export function usePersistedViewMode(key: string, fallback: ViewMode = "list") {
  const [viewMode, setViewMode] = useState<ViewMode>(() => readViewMode(key, fallback));

  useEffect(() => {
    writeStorage(key, viewMode);
  }, [key, viewMode]);

  return [viewMode, setViewMode] as const;
}
