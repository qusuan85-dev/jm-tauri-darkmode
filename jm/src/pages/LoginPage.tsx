import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  WifiOff,
} from "lucide-react";

import type { LoginResult, Session } from "../auth/session";
import { saveSession } from "../auth/session";
import { decodeUtf8Base64, encodeUtf8Base64 } from "../utils/utf8Base64";

type TabKey = "login" | "register" | "verify" | "proxy";

type Tab = {
  key: TabKey;
  title: string;
};

const tabs: Tab[] = [
  { key: "login", title: "登录" },
  { key: "register", title: "注册" },
  { key: "verify", title: "验证" },
  { key: "proxy", title: "分流" },
];

const REGISTER_WEB_BASES = [
  "https://18-comicblade.art",
  "https://18comic-hok.vip",
  "https://18comic.vip",
  "https://jmcomic.me",
  "https://18comic-16promax.club",
  "https://18comic.tw",
  "https://18comic-doa.xyz",
];

function loadRegisterBase(): string {
  try {
    const v = localStorage.getItem("jm_register_web_base");
    if (v && /^https?:\/\//.test(v)) return v;
  } catch {
    // ignore
  }
  return REGISTER_WEB_BASES[0];
}

function saveRegisterBase(base: string) {
  try {
    localStorage.setItem("jm_register_web_base", base);
  } catch {
    // ignore
  }
}

function Field(props: { label: string; children: ReactNode }): ReactNode {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-[13px] font-medium text-zinc-700">{props.label}</span>
      {props.children}
    </label>
  );
}

function TextInput(props: ComponentPropsWithoutRef<"input">) {
  return (
    <input
      {...props}
      className={[
        "h-11 rounded-pill border border-zinc-300 bg-white px-4 text-sm text-zinc-900",
        "placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200",
        "disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500",
        props.className ?? "",
      ].join(" ")}
    />
  );
}

function PrimaryButton(
  props: ComponentPropsWithoutRef<"button"> & { loading?: boolean },
) {
  const { loading, disabled, children, className, ...rest } = props;
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={[
        "inline-flex h-11 w-full items-center justify-center gap-2 rounded-pill border border-zinc-200 bg-zinc-900 px-5 text-sm font-medium text-white",
        "transition-colors hover:bg-zinc-800 active:bg-zinc-950 disabled:cursor-not-allowed disabled:opacity-60",
        className ?? "",
      ].join(" ")}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {children}
    </button>
  );
}

function Divider() {
  return <div className="h-px w-full bg-zinc-200" />;
}

function LoginTab(props: { onLoggedIn: (session: Session) => void }) {
  const [savePassword, setSavePassword] = useState(() => {
    try {
      const v = localStorage.getItem("jm_save_password");
      if (v === "0") return false;
      if (v === "1") return true;
      return true;
    } catch {
      return true;
    }
  });

  const [loginUsername, setLoginUsername] = useState(() => {
    try {
      return localStorage.getItem("jm_login_username") ?? "";
    } catch {
      return "";
    }
  });

  const [loginPassword, setLoginPassword] = useState(() => {
    try {
      if (localStorage.getItem("jm_save_password") === "0") return "";
      const v = localStorage.getItem("jm_login_password_b64");
      if (!v) return "";
      return decodeUtf8Base64(v);
    } catch {
      return "";
    }
  });
  const [showPassword, setShowPassword] = useState(false);

  const [autoLogin, setAutoLogin] = useState(() => {
    try {
      const v = localStorage.getItem("jm_auto_login");
      if (v === "0") return false;
      if (v === "1") return true;
      return true;
    } catch {
      return true;
    }
  });
  const [loginFeedback, setLoginFeedback] = useState<{
    tone: "loading" | "success" | "error";
    text: string;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loginResult, setLoginResult] = useState<LoginResult | null>(null);

  const onSkipLogin = useCallback(() => {
    const session: Session = {
      user: {
        uid: "guest",
        username: "游客",
        level_name: "",
        level: 0,
        coin: 0,
        favorites: 0,
        can_favorites: 0,
      },
      cookies: {},
      savedAt: Date.now(),
    };
    try {
      saveSession(session);
    } catch {
      // ignore
    }
    props.onLoggedIn(session);
  }, [props.onLoggedIn]);

  const onLogin = useCallback(async () => {
    const username = loginUsername.trim();
    if (!username || !loginPassword) {
      setLoginFeedback({ tone: "error", text: "请输入用户名和密码" });
      return;
    }
    setIsSubmitting(true);
    setLoginFeedback({ tone: "loading", text: "正在验证账号…" });
    setLoginResult(null);

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<LoginResult>("login", {
        username,
        password: loginPassword,
      });
      setLoginResult(result);
      setLoginFeedback({
        tone: "success",
        text: `登录成功：${result.user.username}（LV${result.user.level}）`,
      });

      try {
        localStorage.setItem("jm_login_username", username);
        localStorage.setItem("jm_save_password", savePassword ? "1" : "0");
        localStorage.setItem("jm_auto_login", autoLogin && savePassword ? "1" : "0");
        if (savePassword) {
          localStorage.setItem("jm_login_password_b64", encodeUtf8Base64(loginPassword));
        } else {
          localStorage.removeItem("jm_login_password_b64");
        }
      } catch {
        // ignore persistence errors
      }

      const session: Session = { ...result, savedAt: Date.now() };
      saveSession(session);
      props.onLoggedIn(session);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLoginFeedback({ tone: "error", text: `登录失败：${msg}` });
    } finally {
      setIsSubmitting(false);
    }
  }, [autoLogin, loginPassword, loginUsername, props.onLoggedIn, savePassword]);

  const feedbackTone = loginFeedback?.tone;
  const feedbackClass =
    feedbackTone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : feedbackTone === "error"
        ? "border-red-200 bg-red-50 text-red-700"
        : "border-zinc-200 bg-zinc-50 text-zinc-600";

  return (
    <form
      className="flex min-h-[310px] flex-col gap-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        void onLogin();
      }}
    >
      <div className="flex items-start gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-xs leading-5 text-zinc-600">
        <WifiOff className="mt-0.5 h-3.5 w-3.5 flex-none text-zinc-500" />
        <span>如果无法连接或看图，请切换到「分流」选择其他线路。</span>
      </div>

      {loginFeedback ? (
        <div
          className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${feedbackClass}`}
          role={feedbackTone === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          {feedbackTone === "success" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" />
          ) : feedbackTone === "error" ? (
            <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
          ) : (
            <Loader2 className="mt-0.5 h-4 w-4 flex-none animate-spin" />
          )}
          <span>{loginFeedback.text}</span>
        </div>
      ) : null}

      {loginResult ? (
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-zinc-200 bg-white p-3 font-mono text-[11px] text-zinc-600">
          <div>UID · {String(loginResult.user.uid)}</div>
          <div>COOKIES · {Object.keys(loginResult.cookies).length}</div>
        </div>
      ) : null}

      <Field label="用户名">
        <TextInput
          name="username"
          value={loginUsername}
          onChange={(e) => setLoginUsername(e.currentTarget.value)}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="输入 JM 用户名"
          aria-invalid={feedbackTone === "error"}
          disabled={isSubmitting}
        />
      </Field>

      <Field label="密码">
        <div className="relative w-full">
          <TextInput
            name="password"
            type={showPassword ? "text" : "password"}
            value={loginPassword}
            onChange={(e) => setLoginPassword(e.currentTarget.value)}
            autoComplete="current-password"
            placeholder="输入密码"
            aria-invalid={feedbackTone === "error"}
            disabled={isSubmitting}
            className="w-full pr-10"
          />
          <button
            type="button"
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-2 text-zinc-500 hover:text-zinc-800"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "隐藏密码" : "显示密码"}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </Field>

      <div className="flex flex-wrap gap-x-6 gap-y-2 pt-0.5 text-sm text-zinc-800">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={savePassword}
            onChange={(e) => {
              const next = e.currentTarget.checked;
              setSavePassword(next);
              try {
                localStorage.setItem("jm_save_password", next ? "1" : "0");
                if (!next) localStorage.removeItem("jm_login_password_b64");
                if (!next) {
                  setAutoLogin(false);
                  localStorage.setItem("jm_auto_login", "0");
                }
              } catch {
                // ignore
              }
            }}
            disabled={isSubmitting}
          />
          保存密码
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={autoLogin}
            onChange={(e) => {
              const next = e.currentTarget.checked;
              setAutoLogin(next);
              try {
                localStorage.setItem("jm_auto_login", next ? "1" : "0");
              } catch {
                // ignore
              }
            }}
            disabled={isSubmitting || !savePassword}
          />
          <span className={!savePassword ? "text-zinc-400" : undefined}>自动登录</span>
        </label>
      </div>

      <div className="flex items-center gap-1.5 text-[11px] leading-5 text-zinc-500">
        <LockKeyhole className="h-3.5 w-3.5 flex-none" />
        凭据只保存在本机；关闭「保存密码」后不会自动登录。
      </div>

      <div className="mt-auto flex flex-col items-center gap-3 pt-1">
        <PrimaryButton type="submit" loading={isSubmitting}>
          {isSubmitting ? "登录中…" : "登录"}
        </PrimaryButton>
        <button
          type="button"
          className="text-xs font-medium text-blue-600 underline decoration-blue-600/30 underline-offset-4 hover:text-blue-500"
          onClick={onSkipLogin}
          disabled={isSubmitting}
        >
          跳过登录
        </button>
      </div>
    </form>
  );
}

function RegisterTab() {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [captcha, setCaptcha] = useState("");
  const [gender, setGender] = useState<"male" | "female">("male");
  const [webBase, setWebBase] = useState(() => loadRegisterBase());
  const [captchaImg, setCaptchaImg] = useState<string>("");
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [registerLoading, setRegisterLoading] = useState(false);
  const [registerMsg, setRegisterMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadCaptcha = useCallback(async () => {
    setCaptchaLoading(true);
    setRegisterMsg(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const b64 = await invoke<string>("api_register_captcha", { webBase });
      setCaptchaImg(`data:image/png;base64,${b64}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setRegisterMsg({ ok: false, text: `验证码加载失败：${msg}` });
    } finally {
      setCaptchaLoading(false);
    }
  }, [webBase]);

  const onRegister = useCallback(async () => {
    const cleanEmail = email.trim();
    const cleanUser = username.trim();
    if (!cleanEmail || !cleanUser || !password || !captcha.trim()) {
      setRegisterMsg({ ok: false, text: "请完整填写注册信息" });
      return;
    }
    setRegisterLoading(true);
    setRegisterMsg(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const res = await invoke<{ ok: boolean; message?: string }>("api_register", {
        username: cleanUser,
        email: cleanEmail,
        password,
        verification: captcha.trim(),
        gender,
        webBase,
      });
      if (res?.ok) {
        setRegisterMsg({ ok: true, text: res.message || "注册成功，请前往邮箱验证" });
      } else {
        setRegisterMsg({ ok: false, text: res?.message || "注册失败" });
        void loadCaptcha();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setRegisterMsg({ ok: false, text: `注册失败：${msg}` });
      void loadCaptcha();
    } finally {
      setRegisterLoading(false);
    }
  }, [captcha, email, gender, loadCaptcha, password, username, webBase]);

  useEffect(() => {
    void loadCaptcha();
  }, [loadCaptcha]);

  return (
    <div className="flex min-h-[230px] flex-col gap-3">
      <p className="text-sm text-zinc-700">如果无法使用，请自行网页注册</p>

      <div className="text-sm">
        <a
          className="text-zinc-900 underline underline-offset-4 hover:text-zinc-700"
          href="https://jmcomic.me"
          target="_blank"
          rel="noreferrer"
        >
          打开注册页面
        </a>
      </div>

      <Field label="邮箱：">
        <TextInput
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
          inputMode="email"
          autoComplete="email"
        />
      </Field>

      <Field label="用户名：">
        <TextInput
          value={username}
          onChange={(e) => setUsername(e.currentTarget.value)}
          autoComplete="username"
        />
      </Field>

      <Field label="注册线路">
        <select
          className="h-10 w-full rounded-pill border border-zinc-300 px-3.5 text-[13px] text-zinc-900"
          value={webBase}
          onChange={(e) => {
            const next = e.currentTarget.value;
            setWebBase(next);
            saveRegisterBase(next);
          }}
        >
          {REGISTER_WEB_BASES.map((url) => (
            <option key={url} value={url}>
              {url}
            </option>
          ))}
        </select>
      </Field>

      <Field label="密码：">
        <div className="relative w-full">
          <TextInput
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            autoComplete="new-password"
            className="w-full pr-10"
          />
          <button
            type="button"
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-2 text-zinc-500 hover:text-zinc-800"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "隐藏密码" : "显示密码"}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </Field>

      <Field label="验证码">
        <TextInput value={captcha} onChange={(e) => setCaptcha(e.target.value)} />
      </Field>

      <button
        type="button"
        className="flex items-center justify-center rounded-md border border-dashed border-zinc-200 p-3 text-center text-sm text-zinc-500 hover:bg-zinc-50"
        onClick={loadCaptcha}
        disabled={captchaLoading}
      >
        {captchaImg ? (
          <img src={captchaImg} alt="验证码" className="h-12 object-contain" />
        ) : (
          "点击加载验证码"
        )}
      </button>

      <div className="flex items-center gap-6 pt-1 text-sm text-zinc-800">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="gender"
            checked={gender === "male"}
            onChange={() => setGender("male")}
          />
          男
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="gender"
            checked={gender === "female"}
            onChange={() => setGender("female")}
          />
          女
        </label>
      </div>

      {registerMsg ? (
        <div
          className={`rounded-md border bg-white p-2 text-sm ${
            registerMsg.ok ? "border-emerald-200 text-emerald-700" : "border-red-200 text-red-600"
          }`}
        >
          {registerMsg.text}
        </div>
      ) : null}

      <div className="flex items-center justify-center pt-2">
        <PrimaryButton
          type="button"
          onClick={onRegister}
          loading={registerLoading}
        >
          注册
        </PrimaryButton>
      </div>
    </div>
  );
}

function VerifyTab() {
  const [resendEmail, setResendEmail] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [verifyUrl, setVerifyUrl] = useState("");
  const [busy, setBusy] = useState<"resend" | "reset" | "verify" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const webBase = loadRegisterBase();

  const callAction = useCallback(
    async (kind: "resend" | "reset" | "verify") => {
      setMsg(null);
      setBusy(kind);
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        if (kind === "resend") {
          const email = resendEmail.trim();
          if (!email) {
            setMsg({ ok: false, text: "请输入邮箱" });
            return;
          }
          const res = await invoke<{ ok: boolean; message?: string }>("api_register_verify", {
            email,
            webBase,
          });
          setMsg({
            ok: !!res?.ok,
            text: res?.message || (res?.ok ? "已发送验证邮件" : "发送失败"),
          });
        } else if (kind === "reset") {
          const email = resetEmail.trim();
          if (!email) {
            setMsg({ ok: false, text: "请输入邮箱" });
            return;
          }
          const res = await invoke<{ ok: boolean; message?: string }>("api_reset_password", {
            email,
            webBase,
          });
          setMsg({
            ok: !!res?.ok,
            text: res?.message || (res?.ok ? "已发送重置邮件" : "发送失败"),
          });
        } else {
          const url = verifyUrl.trim();
          if (!url) {
            setMsg({ ok: false, text: "请输入验证链接" });
            return;
          }
          const res = await invoke<{ ok: boolean; message?: string }>("api_verify_mail", {
            url,
            webBase,
          });
          setMsg({
            ok: !!res?.ok,
            text: res?.message || (res?.ok ? "验证成功" : "验证失败"),
          });
        }
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        setMsg({ ok: false, text: err });
      } finally {
        setBusy(null);
      }
    },
    [resendEmail, resetEmail, verifyUrl],
  );

  return (
    <div className="max-h-[230px] overflow-y-auto pr-1">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-zinc-700">如果你的邮件一直无法接受到验证连接</p>
        <p className="text-sm text-zinc-700">
          请前往官方Discord频道-未收到验证信协助区
        </p>

        <a
          className="inline-flex h-10 items-center justify-start rounded-pill border border-zinc-300 px-3.5 text-[13px] font-medium text-zinc-900 hover:bg-zinc-50"
          href="https://discord.com"
          target="_blank"
          rel="noreferrer"
        >
          官方Discord
        </a>

        <Divider />

        <div className="text-sm font-medium text-zinc-900">重新发送邮箱验证</div>
        <Field label="邮箱：">
          <TextInput
            value={resendEmail}
            onChange={(e) => setResendEmail(e.currentTarget.value)}
            inputMode="email"
            autoComplete="email"
          />
        </Field>
        <button
          type="button"
          className="h-10 rounded-md border border-zinc-200 bg-white text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
          onClick={() => void callAction("resend")}
          disabled={busy !== null}
        >
          发送
        </button>

        <Divider />

        <div className="text-sm font-medium text-zinc-900">重置密码</div>
        <Field label="邮箱：">
          <TextInput
            value={resetEmail}
            onChange={(e) => setResetEmail(e.currentTarget.value)}
            inputMode="email"
          />
        </Field>
        <button
          type="button"
          className="h-10 rounded-md border border-zinc-200 bg-white text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
          onClick={() => void callAction("reset")}
          disabled={busy !== null}
        >
          发送
        </button>

        <Divider />

        <div className="text-sm font-medium text-zinc-900">
          账号验证（如果你无法打开邮箱里的验证地址，可以复制到此处验证）
        </div>
        <Field label="地址：">
          <TextInput value={verifyUrl} onChange={(e) => setVerifyUrl(e.target.value)} />
        </Field>
        <button
          type="button"
          className="h-10 rounded-md border border-zinc-200 bg-white text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
          onClick={() => void callAction("verify")}
          disabled={busy !== null}
        >
          发送
        </button>

        {msg ? (
          <div
            className={`rounded-md border bg-white p-2 text-sm ${
              msg.ok ? "border-emerald-200 text-emerald-700" : "border-red-200 text-red-600"
            }`}
          >
            {msg.text}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ProxyTab() {
  const [proxyMode, setProxyMode] = useState<"none" | "http" | "socks" | "system">(
    "none",
  );
  const [httpProxy, setHttpProxy] = useState("");
  const [socksProxy, setSocksProxy] = useState("");
  const [httpsEnabled, setHttpsEnabled] = useState(true);
  const [useRegisterProxy, setUseRegisterProxy] = useState(false);
  const [ua, setUa] = useState("");
  const [proxyLoading, setProxyLoading] = useState(false);
  const [proxyMsg, setProxyMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [apiBase, setApiBase] = useState("");
  const [apiBaseList, setApiBaseList] = useState<string[]>([]);
  const [apiLatency, setApiLatency] = useState<Record<string, string>>({});
  const [apiLatencyLoading, setApiLatencyLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        setProxyLoading(true);
        const { invoke } = await import("@tauri-apps/api/core");
        const cfg = await invoke<{ socksProxy?: string | null }>("api_config_get");
        if (cancelled) return;
        setSocksProxy(typeof cfg?.socksProxy === "string" ? cfg.socksProxy : "");
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setProxyMsg({ ok: false, text: `读取代理配置失败：${msg}` });
      } finally {
        if (!cancelled) setProxyLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const current = await invoke<string>("api_api_base_current");
        const list = await invoke<string[]>("api_api_base_list");
        if (cancelled) return;
        setApiBase(current);
        setApiBaseList(Array.isArray(list) ? list : []);
      } catch {
        if (!cancelled) {
          setApiBase("");
          setApiBaseList([]);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const randomizeUa = useCallback(() => {
    const seed = Math.random().toString(16).slice(2, 10);
    setUa(`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (${seed})`);
  }, []);

  return (
    <div className="max-h-[230px] overflow-y-auto pr-1">
      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-2 text-sm text-zinc-800">
          <input
            type="radio"
            name="proxyMode"
            checked={proxyMode === "none"}
            onChange={() => setProxyMode("none")}
          />
          无代理
        </label>

        <div className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3">
          <label className="flex items-center gap-2 text-sm text-zinc-800">
            <input
              type="radio"
              name="proxyMode"
              checked={proxyMode === "http"}
              onChange={() => setProxyMode("http")}
            />
            <span className="min-w-[90px]">HTTP代理</span>
          </label>
          <Field label="代理地址">
            <TextInput
              value={httpProxy}
              onChange={(e) => setHttpProxy(e.currentTarget.value)}
              placeholder="http://127.0.0.1:10809"
            />
          </Field>
        </div>

        <div className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3">
          <label className="flex items-center gap-2 text-sm text-zinc-800">
            <input
              type="radio"
              name="proxyMode"
              checked={proxyMode === "socks"}
              onChange={() => setProxyMode("socks")}
            />
            <span className="min-w-[90px]">Sock5代理</span>
          </label>
          <Field label="代理地址">
            <TextInput
              value={socksProxy}
              onChange={(e) => setSocksProxy(e.currentTarget.value)}
              placeholder="socks5://127.0.0.1:1080"
            />
          </Field>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="h-9 rounded-pill border border-zinc-300 px-3.5 text-[13px] hover:bg-zinc-50 disabled:opacity-60"
              disabled={proxyLoading}
              onClick={() => {
                void (async () => {
                  try {
                    setProxyLoading(true);
                    setProxyMsg(null);
                    const { invoke } = await import("@tauri-apps/api/core");
                    const v = socksProxy.trim();
                    await invoke("api_config_set_socks_proxy", { proxy: v ? v : null });
                    setProxyMsg({ ok: true, text: "已保存（下次请求生效）" });
                    window.setTimeout(() => setProxyMsg(null), 1500);
                  } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    setProxyMsg({ ok: false, text: `保存失败：${msg}` });
                    window.setTimeout(() => setProxyMsg(null), 2500);
                  } finally {
                    setProxyLoading(false);
                  }
                })();
              }}
            >
              保存
            </button>
            <button
              type="button"
              className="h-9 rounded-pill border border-zinc-300 px-3.5 text-[13px] hover:bg-zinc-50 disabled:opacity-60"
              disabled={proxyLoading}
              onClick={() => {
                void (async () => {
                  const v = socksProxy.trim();
                  if (!v) {
                    setProxyMsg({ ok: false, text: "请先填写 SOCKS 代理地址" });
                    window.setTimeout(() => setProxyMsg(null), 2000);
                    return;
                  }
                  try {
                    setProxyLoading(true);
                    setProxyMsg(null);
                    const { invoke } = await import("@tauri-apps/api/core");
                    const result = await invoke<string>("api_proxy_check", { proxy: v });
                    setProxyMsg({ ok: true, text: result });
                    window.setTimeout(() => setProxyMsg(null), 2000);
                  } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    setProxyMsg({ ok: false, text: `验证失败：${msg}` });
                    window.setTimeout(() => setProxyMsg(null), 2500);
                  } finally {
                    setProxyLoading(false);
                  }
                })();
              }}
            >
              验证
            </button>
            <button
              type="button"
              className="h-9 rounded-pill border border-zinc-300 px-3.5 text-[13px] hover:bg-zinc-50 disabled:opacity-60"
              disabled={proxyLoading}
              onClick={() => setSocksProxy("")}
            >
              清空
            </button>
          </div>
          {proxyMsg ? (
            <div
              className={`rounded-md border bg-white p-2 text-sm ${
                proxyMsg.ok ? "border-emerald-200 text-emerald-700" : "border-red-200 text-red-600"
              }`}
            >
              {proxyMsg.text}
            </div>
          ) : null}
        </div>

        <label className="flex items-center gap-2 text-sm text-zinc-800">
          <input
            type="radio"
            name="proxyMode"
            checked={proxyMode === "system"}
            onChange={() => setProxyMode("system")}
          />
          使用系统代理
          <span className="ml-2 text-sm text-red-600">未检测到系统代理</span>
        </label>

        <Divider />

        <label className="flex items-center gap-2 text-sm text-zinc-800">
          <input
            type="checkbox"
            checked={httpsEnabled}
            onChange={(e) => setHttpsEnabled(e.currentTarget.checked)}
          />
          启用Https（如果出现连接被重置，建议关闭试试）
        </label>

        <label className="flex items-center gap-2 text-sm text-zinc-800">
          <input
            type="checkbox"
            checked={useRegisterProxy}
            onChange={(e) => setUseRegisterProxy(e.currentTarget.checked)}
          />
          使用注册分流（无法注册可尝试开启）
        </label>

        <div className="flex items-center gap-3">
          <div className="min-w-[90px] text-sm text-zinc-800">UA设置:</div>
          <button
            type="button"
            className="h-10 rounded-pill border border-zinc-300 px-3.5 text-[13px] font-medium text-zinc-900 hover:bg-zinc-50"
            onClick={randomizeUa}
          >
            随机生成
          </button>
        </div>
        <TextInput value={ua} onChange={(e) => setUa(e.currentTarget.value)} />

        <Divider />

        <div className="flex flex-col gap-2 text-sm">
          <div className="font-medium text-zinc-700">API Domain List</div>
          <div className="grid grid-cols-[1fr_80px] items-center gap-x-4 gap-y-2 text-xs">
            <div className="text-zinc-600">域名</div>
            <div className="text-center text-zinc-600">延迟</div>

            {apiBaseList.length ? (
              apiBaseList.map((base) => {
                const active = apiBase && base === apiBase;
                return (
                  <div key={base} className="contents">
                    <div
                      className={`truncate ${
                        active ? "text-emerald-600" : "text-zinc-700"
                      }`}
                    >
                      {base}
                      {active ? <span className="ml-1">当前</span> : null}
                    </div>
                    <div className="text-center text-zinc-500">
                      {apiLatency[base] ?? "—"}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="col-span-2 text-center text-xs text-zinc-500">
                暂无可用分流
              </div>
            )}
          </div>
          <button
            type="button"
            className="h-8 self-start rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
            disabled={apiLatencyLoading || apiBaseList.length === 0}
            onClick={() => {
              void (async () => {
                try {
                  setApiLatencyLoading(true);
                  const { invoke } = await import("@tauri-apps/api/core");
                  const result = await invoke<
                    Array<{ base: string; ms: number; ok: boolean; status?: number | null }>
                  >("api_api_base_latency");
                  const next: Record<string, string> = {};
                  for (const item of result ?? []) {
                    if (!item?.base) continue;
                    next[item.base] = item.ok ? `${item.ms}ms` : "失败";
                  }
                  setApiLatency(next);
                } catch {
                  setApiLatency({});
                } finally {
                  setApiLatencyLoading(false);
                }
              })();
            }}
          >
            {apiLatencyLoading ? (
              <span className="flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                测速中...
              </span>
            ) : (
              "测速"
            )}
          </button>
        </div>

        <Divider />

        <div className="flex flex-col gap-2 text-sm">
          <div className="font-medium text-zinc-700">图片分流</div>
          <div className="text-xs text-zinc-500">暂未接入分流列表</div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage(props: { onLoggedIn: (session: Session) => void }) {
  const [active, setActive] = useState<TabKey>("login");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const content = useMemo(() => {
    switch (active) {
      case "login":
        return <LoginTab onLoggedIn={props.onLoggedIn} />;
      case "register":
        return <RegisterTab />;
      case "verify":
        return <VerifyTab />;
      case "proxy":
        return <ProxyTab />;
      default:
        return null;
    }
  }, [active, props.onLoggedIn]);

  const moveTabFocus = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      let nextIndex = index;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = tabs.length - 1;
      else return;

      event.preventDefault();
      const next = tabs[nextIndex];
      setActive(next.key);
      tabRefs.current[nextIndex]?.focus();
    },
    [],
  );

  return (
    <div className="safe-area-top relative flex min-h-screen items-center justify-center overflow-hidden bg-zinc-100 p-4 text-zinc-900 sm:p-6">
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        aria-hidden="true"
        style={{
          backgroundImage:
            "radial-gradient(circle at 15% 15%, rgb(var(--jm-accent) / 0.12), transparent 30%), radial-gradient(circle at 85% 85%, rgb(var(--jm-accent) / 0.08), transparent 28%)",
        }}
      />

      <div className="relative grid w-full max-w-[920px] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_24px_80px_-44px_rgba(0,0,0,0.45)] lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)]">
        <aside className="hidden min-h-[620px] flex-col justify-between bg-zinc-900 p-8 text-white lg:flex">
          <div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-white/10">
              <BookOpen className="h-5 w-5" />
            </div>
            <div className="mt-10 font-mono text-[10px] uppercase tracking-[0.2em] text-white/55">
              JM COMIC READER
            </div>
            <h1 className="mt-3 max-w-[230px] text-[34px] font-medium leading-[1.08]">
              把阅读，
              <br />
              留给自己。
            </h1>
            <p className="mt-5 max-w-[250px] text-sm leading-6 text-white/65">
              登录后同步收藏、阅读进度与签到状态。凭据只保存在本机，可随时关闭自动登录。
            </p>
          </div>
          <div className="border-t border-white/10 pt-5">
            <div className="flex items-center gap-2 text-xs text-white/55">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              本地优先 · 隐私可控 · 自动恢复会话
            </div>
          </div>
        </aside>

        <section className="flex min-h-[520px] min-w-0 flex-col px-4 pb-5 pt-6 sm:px-6 lg:min-h-[620px] lg:px-8 lg:pb-7 lg:pt-8">
          <div className="flex items-center gap-2 lg:hidden">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 text-white">
              <BookOpen className="h-4 w-4" />
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
              JM COMIC READER
            </span>
          </div>

          <div className="mt-7 lg:mt-0">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
              ACCOUNT
            </div>
            <h2 className="text-[30px] font-medium leading-none text-zinc-900">账号中心</h2>
            <p className="mt-2 text-sm text-zinc-500">登录、注册或调整连接线路。</p>
          </div>

          <div
            className="mt-6 flex h-10 items-stretch rounded-pill border border-zinc-200 bg-zinc-50 p-[3px]"
            role="tablist"
            aria-label="账号功能"
          >
            {tabs.map((tab, index) => {
              const isActive = tab.key === active;
              return (
                <button
                  key={tab.key}
                  ref={(node) => {
                    tabRefs.current[index] = node;
                  }}
                  id={`login-tab-${tab.key}`}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`login-panel-${tab.key}`}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => setActive(tab.key)}
                  onKeyDown={(event) => moveTabFocus(event, index)}
                  className={[
                    "flex flex-1 items-center justify-center rounded-pill px-3 text-[13px] transition-colors",
                    isActive
                      ? "bg-surface font-medium text-zinc-900 shadow-sm"
                      : "text-zinc-500 hover:text-zinc-800",
                  ].join(" ")}
                >
                  {tab.title}
                </button>
              );
            })}
          </div>

          <div
            id={`login-panel-${active}`}
            role="tabpanel"
            aria-labelledby={`login-tab-${active}`}
            className="mt-4 flex min-h-0 flex-1 flex-col"
          >
            {content}
          </div>
        </section>
      </div>
    </div>
  );
}
