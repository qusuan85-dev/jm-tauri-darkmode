import { useRef } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";

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
  const location = useLocation();
  const navigate = useNavigate();
  const tabRefs = useRef<Array<HTMLAnchorElement | null>>([]);

  const moveTab = (event: React.KeyboardEvent<HTMLAnchorElement>, index: number) => {
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = TABS.length - 1;
    else return;

    event.preventDefault();
    navigate(TABS[nextIndex].to);
    tabRefs.current[nextIndex]?.focus();
  };

  return (
    <div
      className="flex h-9 items-stretch rounded-pill bg-zinc-50 p-[3px]"
      role="tablist"
      aria-label="书架分区"
    >
      {TABS.map(({ to, label }, index) => {
        const active = location.pathname === to;
        return (
          <NavLink
            key={to}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            to={to}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onKeyDown={(event) => moveTab(event, index)}
            className={[
              "flex flex-1 items-center justify-center rounded-pill px-3 text-xs transition-colors",
              active ? "bg-surface font-medium text-zinc-900" : "text-zinc-500",
            ].join(" ")}
          >
            {label}
          </NavLink>
        );
      })}
    </div>
  );
}
