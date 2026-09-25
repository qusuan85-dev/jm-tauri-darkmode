export type ApiUserInfo = {
  uid: unknown;
  username: string;
  level_name: string;
  level: number;
  coin: number;
  gender?: string;
  favorites: number;
  can_favorites: number;
  exp?: number;
  next_level_exp?: number;
};

export type LoginResult = {
  user: ApiUserInfo;
  cookies: Record<string, string>;
};

export type Session = LoginResult & {
  savedAt: number;
};

const SESSION_KEY = "jm_session_v1";

export function isUsableSession(value: unknown): value is Session {
  if (!value || typeof value !== "object") return false;
  const s = value as Partial<Session>;
  if (!s.user || typeof s.user !== "object") return false;
  if (typeof (s.user as { username?: unknown }).username !== "string") return false;
  if (!(s.user as { username: string }).username) return false;
  if (!s.cookies || typeof s.cookies !== "object") return false;
  return true;
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isUsableSession(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // ignore persistence errors
  }
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

