import { type ReactNode, useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  CalendarCheck,
  ChevronUp,
  Clock,
  HardDriveDownload,
  Heart,
  Home,
  Library,
  Search,
  Settings,
  Tags,
} from "lucide-react";

/** The three reader destinations share one mobile entry point. */
const SHELF_PATHS = ["/home/favorites", "/home/cached", "/home/history"];

const SHELF_ITEMS = [
  {
    to: "/home/favorites",
    label: "在线收藏",
    description: "同步到账号的收藏",
    Icon: Heart,
  },
  {
    to: "/home/cached",
    label: "已缓存",
    description: "无需网络即可阅读",
    Icon: HardDriveDownload,
  },
  {
    to: "/home/history",
    label: "浏览记录",
    description: "继续上次的阅读",
    Icon: Clock,
  },
];

function Section(props: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="mb-3 text-sm font-medium text-zinc-900">{props.title}</div>
      {props.children}
    </div>
  );
}

function MobileBottomNav() {
  const { pathname } = useLocation();
  const [readingOpen, setReadingOpen] = useState(false);
  const readingMenuRef = useRef<HTMLDivElement | null>(null);
  const readingButtonRef = useRef<HTMLButtonElement | null>(null);
  const firstShelfLinkRef = useRef<HTMLAnchorElement | null>(null);
  const readingActive = SHELF_PATHS.some((path) => pathname.startsWith(path));

  useEffect(() => {
    setReadingOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!readingOpen) return;

    const focusFrame = window.requestAnimationFrame(() => firstShelfLinkRef.current?.focus());
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!readingMenuRef.current?.contains(event.target as Node)) {
        setReadingOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setReadingOpen(false);
      readingButtonRef.current?.focus();
    };

    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [readingOpen]);

  const renderBottomLink = (
    to: string,
    label: string,
    Icon: typeof Home,
    active: boolean,
  ) => (
    <NavLink
      key={to}
      to={to}
      title={label}
      aria-current={active ? "page" : undefined}
      className={[
        "flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-[20px] px-1 py-2 transition-colors",
        active ? "text-zinc-900" : "text-zinc-500 hover:text-zinc-800",
      ].join(" ")}
    >
      <span
        className={`h-[3px] w-4 rounded-full ${active ? "bg-accent" : ""}`}
        aria-hidden="true"
      />
      <Icon className="h-5 w-5" aria-hidden="true" />
      <span className={`truncate text-[10px] ${active ? "font-medium" : ""}`}>{label}</span>
    </NavLink>
  );

  return (
    <div className="mobile-bottom-nav fixed left-0 right-0 z-30 px-4">
      <div
        ref={readingMenuRef}
        className="glass glass-nav relative mx-auto flex w-full max-w-[900px] items-stretch rounded-[24px] p-1"
      >
        {readingOpen ? (
          <div
            id="mobile-reading-menu"
            aria-label="阅读空间"
            className="absolute bottom-[calc(100%+10px)] left-0 right-0 rounded-xl border border-zinc-200 bg-white p-2 shadow-[0_18px_50px_-22px_rgba(0,0,0,0.45)]"
          >
            <div className="px-2 pb-2 pt-1 font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-400">
              阅读空间
            </div>
            <div className="grid gap-1">
              {SHELF_ITEMS.map(({ to, label, description, Icon }, index) => (
                <NavLink
                  key={to}
                  ref={index === 0 ? firstShelfLinkRef : undefined}
                  to={to}
                  aria-label={label}
                  className="flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-left hover:bg-zinc-50"
                >
                  <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-zinc-100 text-zinc-700">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-zinc-900">{label}</span>
                    <span className="block truncate text-[11px] text-zinc-500">{description}</span>
                  </span>
                </NavLink>
              ))}
            </div>
          </div>
        ) : null}

        {renderBottomLink("/home/home", "首页", Home, pathname === "/home/home")}

        <button
          ref={readingButtonRef}
          type="button"
          title="阅读"
          aria-label="阅读"
          aria-haspopup="true"
          aria-expanded={readingOpen}
          aria-controls={readingOpen ? "mobile-reading-menu" : undefined}
          onClick={() => setReadingOpen((open) => !open)}
          className={[
            "flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-[20px] px-1 py-2 transition-colors",
            readingActive || readingOpen
              ? "text-zinc-900"
              : "text-zinc-500 hover:text-zinc-800",
          ].join(" ")}
        >
          <span
            className={`h-[3px] w-4 rounded-full ${
              readingActive || readingOpen ? "bg-accent" : ""
            }`}
            aria-hidden="true"
          />
          <span className="relative">
            <Library className="h-5 w-5" aria-hidden="true" />
            <ChevronUp
              className={`absolute -right-2 -top-1 h-2.5 w-2.5 transition-transform ${
                readingOpen ? "rotate-180" : ""
              }`}
              aria-hidden="true"
            />
          </span>
          <span className={`text-[10px] ${readingActive ? "font-medium" : ""}`}>阅读</span>
        </button>

        {renderBottomLink(
          "/home/category_rank",
          "排行",
          Tags,
          pathname.startsWith("/home/category_rank"),
        )}
        {renderBottomLink(
          "/home/search",
          "搜索",
          Search,
          pathname.startsWith("/home/search"),
        )}
        {renderBottomLink(
          "/home/daily",
          "签到",
          CalendarCheck,
          pathname.startsWith("/home/daily"),
        )}
        {renderBottomLink(
          "/home/settings",
          "设置",
          Settings,
          pathname.startsWith("/home/settings"),
        )}
      </div>
    </div>
  );
}

export default function SideNav(props: {
  variant?: "sidebar" | "bottom";
  user?: { username: string; uid: unknown; level?: number; levelName?: string };
}) {
  const variant = props.variant ?? "sidebar";
  const iconClass = "h-4 w-4";

  if (variant === "bottom") {
    return <MobileBottomNav />;
  }

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    [
      "flex h-10 items-center rounded-md border px-3 text-left",
      isActive ? "nav-active" : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50",
    ].join(" ");

  return (
    <div className="flex flex-col gap-3">
      <Section title="导航">
        <div className="flex flex-col gap-2 text-sm">
          <NavLink to="/home/home" end className={navLinkClass}>
            <span className="flex items-center gap-2 leading-none">
              <Home className={iconClass} />
              首页
            </span>
          </NavLink>
          <NavLink to="/home/favorites" className={navLinkClass}>
            <span className="flex items-center gap-2 leading-none">
              <Heart className={iconClass} />
              在线收藏
            </span>
          </NavLink>
          <NavLink to="/home/cached" className={navLinkClass}>
            <span className="flex items-center gap-2 leading-none">
              <HardDriveDownload className={iconClass} />
              已缓存
            </span>
          </NavLink>
          <NavLink to="/home/daily" className={navLinkClass}>
            <span className="flex items-center gap-2 leading-none">
              <CalendarCheck className={iconClass} />
              签到
            </span>
          </NavLink>
          <NavLink to="/home/category_rank" className={navLinkClass}>
            <span className="flex items-center gap-2 leading-none">
              <Tags className={iconClass} />
              分类与排行
            </span>
          </NavLink>
          <NavLink to="/home/history" className={navLinkClass}>
            <span className="flex items-center gap-2 leading-none">
              <Clock className={iconClass} />
              浏览记录
            </span>
          </NavLink>
          <NavLink to="/home/search" className={navLinkClass}>
            <span className="flex items-center gap-2 leading-none">
              <Search className={iconClass} />
              搜索
            </span>
          </NavLink>
          <NavLink to="/home/settings" className={navLinkClass}>
            <span className="flex items-center gap-2 leading-none">
              <Settings className={iconClass} />
              设置
            </span>
          </NavLink>
        </div>
      </Section>

      {props.user ? (
        <Section title="登录信息">
          <div className="space-y-1 text-sm text-zinc-700">
            <div>{props.user.username}</div>
            <div>UID：{String(props.user.uid)}</div>
            {props.user.level != null ? <div>等级：LV{props.user.level}</div> : null}
            {props.user.levelName ? <div>称号：{props.user.levelName}</div> : null}
          </div>
        </Section>
      ) : null}
    </div>
  );
}
