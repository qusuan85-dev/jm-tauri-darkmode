import { LoaderCircle } from "lucide-react";

export default function Loading(props: { className?: string; label?: string }) {
  const label = props.label ?? "加载中";
  return (
    <div
      className={[
        "flex min-h-28 flex-col items-center justify-center gap-2.5 py-6 text-sm text-zinc-500",
        props.className ?? "",
      ].join(" ")}
      role="status"
      aria-label={label}
    >
      <span className="relative flex h-10 w-10 items-center justify-center rounded-pill bg-zinc-200/70">
        <LoaderCircle className="h-5 w-5 animate-spin text-accent" />
      </span>
      <span className="text-xs tracking-wide">{label}</span>
    </div>
  );
}
