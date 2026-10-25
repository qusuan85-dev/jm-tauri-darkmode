import type { ReactNode } from "react";
import { Inbox } from "lucide-react";

type EmptyStateProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
};

export default function EmptyState(props: EmptyStateProps) {
  return (
    <div
      className={[
        "rounded-lg border border-dashed border-zinc-300 bg-surface/60 text-center",
        props.compact ? "px-4 py-5" : "px-5 py-8",
      ].join(" ")}
    >
      <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-pill bg-zinc-50 text-zinc-400">
        <Inbox className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="mt-3 text-sm font-medium text-zinc-800">{props.title}</div>
      {props.description ? (
        <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-zinc-500">
          {props.description}
        </p>
      ) : null}
      {props.action ? <div className="mt-3 flex justify-center">{props.action}</div> : null}
    </div>
  );
}
