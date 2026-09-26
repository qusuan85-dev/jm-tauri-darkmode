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

/**
 * 是否是「真实账号」会话。
 *
 * 「跳过登录」存进来的游客会话虽然结构完整，但没有 uid、也没有 cookie，
 * 任何需要登录态的接口（收藏、签到…）都拿不到数据。需要登录态的地方
 * 应该用这个判断，而不是只看 session 是否非空。
 */
export function isAccountSession(value: unknown): value is Session {
  if (!isUsableSession(value)) return false;
  const uid = String(value.user.uid ?? "").trim();
  if (!uid || uid === "guest") return false;
  return Object.keys(value.cookies).length > 0;
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

