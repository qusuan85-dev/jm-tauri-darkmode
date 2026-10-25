import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import Button from "./Button";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmDialog(props: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const onCancelRef = useRef(props.onCancel);
  const busyRef = useRef(props.busy);

  useEffect(() => {
    onCancelRef.current = props.onCancel;
    busyRef.current = props.busy;
  });

  useEffect(() => {
    if (!props.open) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = Math.max(
      0,
      window.innerWidth - document.documentElement.clientWidth,
    );

    // Prevent the page behind the modal from scrolling while it is open.
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      const currentPadding = Number.parseFloat(
        window.getComputedStyle(document.body).paddingRight,
      ) || 0;
      document.body.style.paddingRight = `${currentPadding + scrollbarWidth}px`;
    }
    cancelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!busyRef.current) {
          event.preventDefault();
          onCancelRef.current();
        }
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialogRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
    };
  }, [props.open]);

  if (!props.open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/55 p-4 backdrop-blur-sm sm:items-center"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        if (event.target === event.currentTarget && !busyRef.current) {
          onCancelRef.current();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-busy={props.busy || undefined}
        aria-labelledby={titleId}
        aria-describedby={props.description ? descriptionId : undefined}
        className="w-full max-w-sm rounded-xl border border-zinc-200 bg-surface p-5 text-zinc-900 shadow-2xl"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <h2 id={titleId} className="text-base font-semibold">
          {props.title}
        </h2>
        {props.description ? (
          <div id={descriptionId} className="mt-2 text-sm leading-6 text-zinc-600">
            {props.description}
          </div>
        ) : null}
        <div className="mt-5 flex gap-2">
          <Button
            ref={cancelRef}
            className="h-9 flex-1 rounded-md border border-zinc-300 bg-surface text-sm font-medium hover:bg-zinc-50"
            disabled={props.busy}
            onClick={props.onCancel}
          >
            {props.cancelLabel ?? "取消"}
          </Button>
          <Button
            className={[
              "h-9 flex-1 rounded-md border text-sm font-medium text-white",
              props.danger
                ? "border-red-600 bg-red-600 hover:bg-red-700"
                : "border-zinc-900 bg-zinc-900 hover:bg-zinc-800",
            ].join(" ")}
            loading={props.busy}
            onClick={props.onConfirm}
          >
            {props.confirmLabel ?? "确认"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
