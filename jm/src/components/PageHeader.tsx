import type { ReactNode } from "react";

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
};

export default function PageHeader(props: PageHeaderProps) {
  return (
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        {props.eyebrow ? (
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
            {props.eyebrow}
          </div>
        ) : null}
        <h1 className="text-[26px] font-medium leading-none text-zinc-900">{props.title}</h1>
        {props.description ? (
          <p className="mt-2 max-w-2xl text-sm leading-5 text-zinc-500">{props.description}</p>
        ) : null}
      </div>
      {props.action ? <div className="flex flex-none items-center gap-2">{props.action}</div> : null}
    </header>
  );
}
