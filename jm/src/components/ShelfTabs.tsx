import { NavLink } from "react-router-dom";

/**
 * The bottom bar carries one 书架 destination, so this segmented control is the
 * only way into 已缓存 / 浏览记录. Folding the three into one screen is what
 * let the tab bar drop from six cramped items to five.
 */
const TABS = [
  { to: "/home/favorites", label: "在线收藏" },
  { to: "/home/cached", label: "已缓存" },
  { to: "/home/history", label: "浏览记录" },
];

export default function ShelfTabs() {
  return (
    <div
      className="flex h-9 items-stretch rounded-pill bg-zinc-50 p-[3px]"
      role="tablist"
      aria-label="书架分区"
    >
      {TABS.map(({ to, label }) => (
        <NavLink
          key={to}
          to={to}
          role="tab"
          className={({ isActive }) =>
            [
              "flex flex-1 items-center justify-center rounded-pill px-3 text-xs transition-colors",
              isActive ? "bg-surface font-medium text-zinc-900" : "text-zinc-500",
            ].join(" ")
          }
        >
          {label}
        </NavLink>
      ))}
    </div>
  );
}
