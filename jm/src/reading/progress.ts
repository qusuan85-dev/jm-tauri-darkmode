export type ReadProgress = {
  aid: string;
  source: "jm";
  updatedAt: number;
  title?: string;
  coverUrl?: string;
  chapterId?: string;
  chapterSort?: string;
  chapterName?: string;
  pageIndex?: number;
};

const KEY = "jm_read_progress_v2";

function makeKey(source: ReadProgress["source"], aid: string): string {
  return `${source}:${aid}`;
}

function loadAll(): Record<string, ReadProgress> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, ReadProgress>;
  } catch {
    return {};
  }
}

function saveAll(all: Record<string, ReadProgress>): void {
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function getReadProgress(source: ReadProgress["source"], aid: string): ReadProgress | null {
  const all = loadAll();
  return all[makeKey(source, aid)] ?? null;
}

export function coalesceReadProgress(
  source: ReadProgress["source"],
  canonicalAid: string,
  aliases: string[],
  metadata: Pick<ReadProgress, "title" | "coverUrl">,
): { progress: ReadProgress | null; removedAids: string[] } {
  const all = loadAll();
  const keys = [
    ...new Set([canonicalAid, ...aliases].map((aid) => makeKey(source, aid.trim())).filter(Boolean)),
  ];
  const existing = keys
    .map((key) => all[key])
    .filter((entry): entry is ReadProgress => Boolean(entry))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
  if (!existing) return { progress: null, removedAids: [] };

  const canonicalKey = makeKey(source, canonicalAid);
  const normalized: ReadProgress = {
    ...existing,
    aid: canonicalAid,
    source,
    title: metadata.title || existing.title,
    coverUrl: metadata.coverUrl || existing.coverUrl,
  };
  const removedAids = keys.filter((key) => key !== canonicalKey && Boolean(all[key]));
  for (const key of removedAids) delete all[key];
  all[canonicalKey] = normalized;
  saveAll(all);
  return { progress: normalized, removedAids };
}

export function getAllReadProgress(): ReadProgress[] {
  return Object.values(loadAll()).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

export function upsertReadProgress(entry: ReadProgress): void {
  const all = loadAll();
  all[makeKey(entry.source, entry.aid)] = entry;
  saveAll(all);
}

export function clearReadProgress(aid: string): void {
  const all = loadAll();
  delete all[makeKey("jm", aid)];
  // Purge any row an older build left behind under the removed source, so the
  // detritus does not linger in the user's history forever.
  delete all[`eh:${aid}`];
  saveAll(all);
}

export function clearReadProgressAliases(aids: string[]): void {
  const all = loadAll();
  for (const aid of new Set(aids.map((value) => value.trim()).filter(Boolean))) {
    delete all[makeKey("jm", aid)];
    delete all[`eh:${aid}`];
  }
  saveAll(all);
}
