import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Trash2 } from "lucide-react";

import { cn } from "@/lib/cn";

export const SWIPE_DELETE_PX = 64;

export function swipeDeleteTravel(dx: number, rtl: boolean): number {
  return rtl ? dx : -dx;
}

export function swipeDeleteAction(travel: number): "delete" | "stay" {
  return travel >= SWIPE_DELETE_PX ? "delete" : "stay";
}

export function canSwipeDeleteBot(bot: { defaultBot?: unknown; yourAccess?: string | null }): boolean {
  return !bot.defaultBot && bot.yourAccess !== "view";
}

function dragHost(node: HTMLElement): HTMLElement | null {
  let host: HTMLElement | null = node.parentElement;
  while (host) {
    if (host.draggable) return host;
    host = host.parentElement;
  }
  return null;
}

export function SwipeToDelete({ enabled, label, onDelete, className, children }: {
  enabled: boolean;
  label: string;
  onDelete: () => void;
  className?: string;
  children: ReactNode;
}) {
  const slide = useRef<HTMLDivElement>(null);
  const origin = useRef<{ x: number; y: number; id: number } | null>(null);
  const locked = useRef<"x" | "y" | null>(null);
  const travel = useRef(0);
  const suppressClick = useRef(false);
  const host = useRef<HTMLElement | null>(null);

  const place = (next: number) => {
    travel.current = next;
    const rtl = document.documentElement.dir === "rtl";
    const shift = rtl ? next : -next;
    if (slide.current) slide.current.style.transform = shift === 0 ? "" : `translateX(${shift}px)`;
  };
  const releaseHost = () => {
    if (host.current) host.current.draggable = true;
    host.current = null;
  };
  const end = (commit: boolean) => {
    const action = commit ? swipeDeleteAction(travel.current) : "stay";
    if (locked.current === "x" && travel.current > 8) suppressClick.current = true;
    origin.current = null;
    locked.current = null;
    place(0);
    releaseHost();
    if (action === "delete") onDelete();
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled || event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest("button, input, textarea, a, [data-bot-actions]")) return;
    origin.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
    locked.current = null;
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = origin.current;
    if (!start || event.pointerId !== start.id) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!locked.current) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      locked.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (locked.current === "y") {
        origin.current = null;
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      const draggable = dragHost(event.currentTarget);
      if (draggable) {
        draggable.draggable = false;
        host.current = draggable;
      }
    }
    if (locked.current !== "x") return;
    const rtl = document.documentElement.dir === "rtl";
    place(Math.min(112, Math.max(0, swipeDeleteTravel(dx, rtl))));
  };

  return (
    <div
      className={cn(enabled && "relative overflow-hidden touch-pan-y", className)}
      data-swipe-delete={enabled ? "" : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={enabled ? onPointerMove : undefined}
      onPointerUp={enabled ? () => end(true) : undefined}
      onPointerCancel={enabled ? () => end(false) : undefined}
      onClickCapture={(event) => {
        if (!suppressClick.current) return;
        suppressClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {enabled && (
        <div aria-hidden="true" className={cn("pointer-events-none absolute inset-y-0 flex w-28 items-center bg-danger px-4 text-panel", "right-0 justify-end rtl:right-auto rtl:left-0 rtl:justify-start")}>
          <Trash2 size={16} />
          <span className="ms-2 text-[13px] font-medium">{label}</span>
        </div>
      )}
      <div ref={slide} className={enabled ? "relative bg-[var(--swipe-cover,var(--tile,transparent))]" : undefined}>{children}</div>
    </div>
  );
}
