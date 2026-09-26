/**
 * 签到（每日打卡）。
 *
 * 后端命令早就有（`api_daily` / `api_daily_check`），之前只有 App 启动时的自动打卡在用，
 * 没有任何界面。这里的取值都按接口实际返回的字段来：
 *
 *   GET /daily?user_id=…  →  daily_id / event_name / currentProgress /
 *                            three_days_coin / three_days_exp / seven_days_coin / seven_days_exp /
 *                            record（按周分组的日历，每天 {date, signed, bonus}）
 *   POST /daily_chk       →  { msg: "Jcoin:40 EXP:40" }   ← 奖励就在这句话里
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { CalendarCheck, Coins, Loader2, RefreshCw, Sparkles } from "lucide-react";

import type { Session } from "../auth/session";
import { isAccountSession } from "../auth/session";
import { isAuthExpiredError } from "../auth/errors";
import Button from "../components/Button";
import Loading from "../components/Loading";
import { useToast } from "../components/Toast";

const AUTO_SIGN_KEY = "jm_auto_sign";

type CalendarCell = {
  date: string;
  signed: boolean | null;
  bonus: boolean;
};

type DailyInfo = {
  daily_id?: string | number;
  event_name?: string;
  currentProgress?: string | number;
  three_days_coin?: string | number;
  three_days_exp?: string | number;
  seven_days_coin?: string | number;
  seven_days_exp?: string | number;
  record?: CalendarCell[][];
  /** 网页端还会返回这个字段：今日已签到时为 "finished" */
  error?: string;
  /** 连续签到天数（网页端字段，接口可能不返回） */
  oldStep?: string | number;
};

function toText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/** `Jcoin:40 EXP:40` → { coin: "40", exp: "40" }（顺序/空格/全角冒号都容错） */
export function parseReward(msg: string): { coin: string; exp: string } {
  const coin = /J\s*coin\s*[:：]\s*(\d+)/i.exec(msg);
  const exp = /EXP\s*[:：]\s*(\d+)/i.exec(msg);
  return { coin: coin?.[1] ?? "", exp: exp?.[1] ?? "" };
}

/** 今日是否已签到：优先看日历里今天那一格，其次看 error === "finished"。 */
export function isSignedToday(info: DailyInfo | undefined): boolean {
  if (!info) return false;
  const today = String(new Date().getDate()).padStart(2, "0");
  const weeks = Array.isArray(info.record) ? info.record : [];
  for (const week of weeks) {
    if (!Array.isArray(week)) continue;
    for (const cell of week) {
      if (cell && String(cell.date) === today && cell.signed === true) return true;
    }
  }
  return info.error === "finished";
}

function progressText(info: DailyInfo | undefined): string {
  const raw = toText(info?.currentProgress);
  if (!raw) return "";
  return /%$/.test(raw) ? raw : `${raw}%`;
}

function readAutoSign(): boolean {
  try {
    return localStorage.getItem(AUTO_SIGN_KEY) === "1";
  } catch {
    return false;
  }
}

export default function DailyPage(props: {
  session: Session;
  onAuthExpired: () => void;
  /** 确保拿到真实账号会话；无法自动登录时 resolve(false)。 */
  ensureLogin?: () => Promise<boolean>;
}) {
  const [signing, setSigning] = useState(false);
  const [reward, setReward] = useState<{ coin: string; exp: string; text: string; at: number } | null>(
    null,
  );
  const [actionMessage, setActionMessage] = useState("");
  const [autoSign, setAutoSign] = useState(readAutoSign);
  const { showToast } = useToast();

  const userId = String(props.session.user?.uid ?? "").trim();
  const canSignIn = isAccountSession(props.session);
  // 回调用 ref 存一份，确保 effect 只依赖 canSignIn，不会因回调身份变化反复触发
  const ensureLoginRef = useRef(props.ensureLogin);
  ensureLoginRef.current = props.ensureLogin;

  /**
   * 进入页面时如果当前会话签不了到（游客态或 cookie 为空），先尝试自动登录；
   * 成功后 session 会更新，下面的 SWR key 随之变化并重新拉取。
   */
  useEffect(() => {
    if (canSignIn) return;
    let cancelled = false;
    setActionMessage("正在自动登录…");
    void (async () => {
      const ok = (await ensureLoginRef.current?.()) ?? false;
      if (cancelled) return;
      setActionMessage(ok ? "" : "需要登录后才能签到，请先登录账号。");
    })();
    return () => {
      cancelled = true;
    };
  }, [canSignIn]);

  const {
    data: daily,
    error: dailyError,
    isValidating,
    mutate,
  } = useSWR(
    canSignIn ? ["daily", userId, props.session.cookies] : null,
    async ([, uid, cookies]) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<any>("api_daily", { userId: uid, cookies });
    },
    {
      revalidateOnFocus: false,
      onError: (err) => {
        if (isAuthExpiredError(err)) props.onAuthExpired();
      },
    },
  );

  const info: DailyInfo | undefined = useMemo(() => {
    if (!daily) return undefined;
    return (daily.data ?? daily) as DailyInfo;
  }, [daily]);

  const signed = isSignedToday(info);
  const loading = isValidating && !daily;
  // 会话还不能签到时页面处于「等登录」状态，用同一套 loading 外观展示
  const awaitingLogin = !canSignIn;

  const errorText =
    dailyError && !isAuthExpiredError(dailyError)
      ? dailyError instanceof Error
        ? dailyError.message
        : String(dailyError)
      : "";

  useEffect(() => {
    try {
      localStorage.setItem(AUTO_SIGN_KEY, autoSign ? "1" : "0");
    } catch {
      // ignore
    }
  }, [autoSign]);

  const checkIn = useCallback(async () => {
    // 会话签不了到就先自动登录；登上了就让用户再点一次，
    // 因为本次闭包里的 cookies / daily_id 还是旧的。
    if (!canSignIn) {
      setSigning(true);
      setActionMessage("正在自动登录…");
      const ok = (await ensureLoginRef.current?.()) ?? false;
      setSigning(false);
      setActionMessage(ok ? "" : "需要登录后才能签到，请先登录账号。");
      if (ok) showToast({ ok: true, text: "已自动登录，请再次点击签到" });
      return;
    }
    if (!userId) {
      setActionMessage("未获取到用户 ID，请重新登录后再试。");
      return;
    }
    setSigning(true);
    setActionMessage("");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const dailyId = info?.daily_id != null ? String(info.daily_id) : "";
      if (!dailyId) {
        setActionMessage("签到信息里没有 daily_id，请先刷新再试。");
        return;
      }
      const result = await invoke<any>("api_daily_check", {
        userId,
        dailyId,
        cookies: props.session.cookies,
      });
      const data = result?.data ?? result ?? {};
      const message = toText(data?.msg) || toText(data?.message) || toText(result?.msg);
      const parsed = parseReward(message);
      const already =
        /已\s*签\s*到|已經簽到|簽到過|已完成|今天已經簽到過了/.test(message) ||
        (!parsed.coin && !parsed.exp && toText(data?.status) !== "ok" && !/成功/.test(message));

      if (parsed.coin || parsed.exp) {
        setReward({
          coin: parsed.coin,
          exp: parsed.exp,
          text: message,
          at: Date.now(),
        });
        showToast({
          ok: true,
          text: `签到成功${parsed.coin ? ` +${parsed.coin} 金币` : ""}${parsed.exp ? ` +${parsed.exp} 经验` : ""}`,
        });
      } else if (already) {
        setActionMessage(message || "今天已经签过到了。");
        showToast({ ok: true, text: "今天已经签过到了" });
      } else {
        setActionMessage(message || "签到失败：服务端没有返回奖励信息。");
        showToast({ ok: false, text: `签到失败：${message || "未知原因"}` });
      }
      await mutate();
    } catch (e) {
      if (isAuthExpiredError(e)) {
        props.onAuthExpired();
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      setActionMessage(msg);
      showToast({ ok: false, text: `签到失败：${msg}` });
    } finally {
      setSigning(false);
    }
  }, [info?.daily_id, mutate, props, showToast, userId, canSignIn]);

  const weeks = useMemo(() => {
    const raw = Array.isArray(info?.record) ? info!.record : [];
    return raw.filter((week): week is CalendarCell[] => Array.isArray(week));
  }, [info]);

  const todayKey = String(new Date().getDate()).padStart(2, "0");

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {/* 今日状态 + 手动签到 */}
      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col">
            <div className="flex items-center gap-2 text-base font-semibold text-zinc-900">
              <CalendarCheck className="h-4 w-4" />
              {info?.event_name || "每日签到"}
            </div>
            <div className="mt-1 text-sm text-zinc-600" data-daily-status={signed ? "signed" : "unsigned"}>
              {awaitingLogin
                ? actionMessage || "正在自动登录…"
                : loading
                  ? "正在读取签到信息…"
                  : signed
                    ? "今天已经签过到了，明天再来～"
                    : "今天还没签到"}
              {!awaitingLogin && progressText(info) ? ` · 连续进度 ${progressText(info)}` : ""}
              {!awaitingLogin && toText(info?.oldStep) ? ` · 连续 ${toText(info?.oldStep)} 天` : ""}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex h-9 items-center gap-1 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
              onClick={() => void mutate()}
              disabled={awaitingLogin || isValidating || signing}
            >
              {isValidating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              刷新
            </button>
            <Button
              className="h-9 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
              onClick={() => void checkIn()}
              disabled={awaitingLogin || loading || signing}
              loading={signing}
            >
              {signed ? "再签一次" : "立即签到"}
            </Button>
          </div>
        </div>

        {errorText ? (
          <div className="mt-3 rounded-md border border-zinc-200 bg-white p-2 text-sm text-red-600">
            {errorText}
          </div>
        ) : null}
        {/* 等待登录时状态行已经在展示同一句提示，这里不再重复渲染 */}
        {!awaitingLogin && actionMessage ? (
          <div
            data-daily-message
            className="mt-3 rounded-md border border-zinc-200 bg-white p-2 text-sm text-zinc-700"
          >
            {actionMessage}
          </div>
        ) : null}

        {reward ? (
          <div className="mt-3 rounded-lg border border-teal-200 bg-teal-50 p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-teal-800">
              <Sparkles className="h-4 w-4" />
              签到成功
              <span className="text-xs font-normal text-teal-700">
                {new Date(reward.at).toLocaleTimeString()}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {reward.coin ? (
                <span
                  data-daily-reward="coin"
                  className="inline-flex items-center gap-1 rounded-md bg-white px-3 py-1.5 text-sm font-semibold text-amber-600 shadow-sm"
                >
                  <Coins className="h-4 w-4" />+{reward.coin} 金币
                </span>
              ) : null}
              {reward.exp ? (
                <span
                  data-daily-reward="exp"
                  className="inline-flex items-center gap-1 rounded-md bg-white px-3 py-1.5 text-sm font-semibold text-teal-600 shadow-sm"
                >
                  <Sparkles className="h-4 w-4" />+{reward.exp} 经验
                </span>
              ) : null}
              {!reward.coin && !reward.exp ? (
                <span className="text-sm text-teal-800">{reward.text || "签到成功"}</span>
              ) : null}
            </div>
            {reward.text ? (
              <div className="mt-2 break-words text-xs text-teal-700">服务端返回：{reward.text}</div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* 奖励说明 */}
      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="mb-3 text-sm font-medium text-zinc-900">连续奖励</div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-md border border-zinc-200 p-3">
            <div className="text-zinc-900">连续满 3 天</div>
            <div className="mt-1 text-xs text-zinc-600">
              {toText(info?.three_days_coin) ? `+${toText(info?.three_days_coin)} 金币` : "—"}
              {" · "}
              {toText(info?.three_days_exp) ? `+${toText(info?.three_days_exp)} 经验` : "—"}
            </div>
          </div>
          <div className="rounded-md border border-zinc-200 p-3">
            <div className="text-zinc-900">连续满 7 天</div>
            <div className="mt-1 text-xs text-zinc-600">
              {toText(info?.seven_days_coin) ? `+${toText(info?.seven_days_coin)} 金币` : "—"}
              {" · "}
              {toText(info?.seven_days_exp) ? `+${toText(info?.seven_days_exp)} 经验` : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* 打卡日历 */}
      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="mb-3 text-sm font-medium text-zinc-900">本月打卡</div>
        {loading ? (
          <Loading />
        ) : weeks.length === 0 ? (
          <div className="rounded-md border border-dashed border-zinc-200 p-4 text-center text-sm text-zinc-500">
            暂时拿不到打卡日历。点右上角「刷新」再试一次。
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-7 gap-1 text-center text-xs text-zinc-500">
              {["一", "二", "三", "四", "五", "六", "日"].map((d) => (
                <div key={d}>{d}</div>
              ))}
            </div>
            {weeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7 gap-1">
                {week.map((cell, ci) => {
                  const isToday = String(cell?.date) === todayKey;
                  const done = cell?.signed === true;
                  const missed = cell?.signed === false;
                  const bonus = Boolean(cell?.bonus);
                  return (
                    <div
                      key={`${wi}-${ci}`}
                      data-daily-cell={String(cell?.date ?? "")}
                      data-daily-signed={done ? "1" : "0"}
                      className={[
                        "flex h-9 flex-col items-center justify-center rounded-md border text-xs",
                        done
                          ? "border-teal-500 bg-teal-500 font-medium text-white"
                          : missed
                            ? "border-zinc-200 bg-zinc-100 text-zinc-400"
                            : "border-zinc-200 bg-white text-zinc-500",
                        isToday ? "ring-2 ring-zinc-900 ring-offset-1" : "",
                      ].join(" ")}
                      title={bonus ? "双倍/活动日" : undefined}
                    >
                      <span>{cell?.date ?? ""}</span>
                      {bonus ? <span className="text-[9px] leading-none">★</span> : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm bg-teal-500" />
            已签到
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm border border-zinc-200 bg-zinc-100" />
            未签到
          </span>
          <span className="inline-flex items-center gap-1">★ 活动/双倍日</span>
        </div>
      </div>

      {/* 自动打卡 */}
      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <label className="flex cursor-pointer items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-sm font-medium text-zinc-900">自动打卡</span>
            <span className="block text-xs text-zinc-500">
              打开后，每次登录会先检查今天是否已签到，没签到就自动签一次
            </span>
          </span>
          <input
            type="checkbox"
            className="h-4 w-4 flex-none accent-zinc-900"
            checked={autoSign}
            onChange={(e) => setAutoSign(e.currentTarget.checked)}
          />
        </label>
      </div>
    </div>
  );
}
