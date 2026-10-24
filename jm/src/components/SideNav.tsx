import { type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  CalendarCheck,
  Clock,
  HardDriveDownload,
  Heart,
  Home,
  Library,
  Search,
  Settings,
  Tags,
  User,
} from "lucide-react";

/**
 * The three reader destinations (在线收藏 / 已缓存 / 浏览记录) are one screen
 * switched by a segmented control, so the bottom bar only ever carries five
 * top-level destinations. Six equally-weighted tabs were not scannable.
 */
const SHELF_PATHS = ["/home/favorites", "/home/cached", "/home/history"];

function Section(props: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="mb-3 text-sm font-medium text-zinc-900">{props.title}</div>
      {props.children}
    </div>
  );
}

export default function SideNav(props: {
  variant?: "sidebar" | "bottom";
  user?: { username: string; uid: unknown; level?: number; levelName?: string };
}) {
  const variant = props.variant ?? "sidebar";
  const iconClass = "h-4 w-4";
  const bottomIconClass = "h-5 w-5";
  const { pathname } = useLocation();

  if (variant === "bottom") {
    const bottomItems = [
      { key: "home" as const, label: "首页", Icon: Home, to: "/home/home" },
      { key: "shelf" as const, label: "书架", Icon: Library, to: "/home/favorites" },
      { key: "rank" as const, label: "排行", Icon: Tags, to: "/home/category_rank" },
      { key: "search" as const, label: "搜索", Icon: Search, to: "/home/search" },
      { key: "mine" as const, label: "我的", Icon: User, to: "/home/settings" },
    ];
    return (
      <div className="mobile-bottom-nav fixed left-0 right-0 z-30 px-4">
        <div className="glass glass-nav mx-auto flex w-full max-w-[900px] items-stretch rounded-pill p-1">
          {bottomItems.map(({ key, label, Icon, to }) => {
            const active =
              key === "shelf"
                ? SHELF_PATHS.some((p) => pathname.startsWith(p))
                : pathname.startsWith(to);
            return (
              <NavLink
                key={key}
                to={to}
                title={label}
                className={[
                  "flex flex-1 flex-col items-center justify-center gap-1 rounded-pill px-2 py-2 transition-colors",
                  active ? "text-zinc-900" : "text-zinc-500",
                ].join(" ")}
              >
                {/* A filled bar reads far faster than a colour shift, and it
                    survives every accent preset. */}
                <span
                  className={`h-[3px] w-4 rounded-full ${active ? "bg-accent" : ""}`}
                  aria-hidden="true"
                />
                <Icon className={bottomIconClass} />
                <span className={`text-[10px] ${active ? "font-medium" : ""}`}>{label}</span>
              </NavLink>
            );
          })}
        </div>
      </div>
    );
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
              收藏(在线)
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
