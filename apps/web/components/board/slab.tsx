"use client";

import Link from "next/link";
import { useEffect, useRef, type CSSProperties, type MouseEventHandler, type ReactNode, type Ref } from "react";
import { cn } from "@/lib/utils";
import { type BoardState, railColor } from "./board-state";

type Common = {
  depth?: "sm" | "md" | "lg";
  state?: BoardState;
  selected?: boolean;
  className?: string;
  children: ReactNode;
};

type SlabProps =
  | (Common & { href: string; onClick?: never; type?: never; disabled?: never })
  | (Common & { href?: never; onClick: MouseEventHandler<HTMLButtonElement>; type?: "button" | "submit"; disabled?: boolean })
  | (Common & { href?: never; onClick?: never; type: "submit"; disabled?: boolean })
  | (Common & { href?: never; onClick?: never; type?: never; disabled?: never });

const MAX_TILT_DEG = 3;

// Moves the viewpoint with the pointer: the extrusion vector and a small
// rotation both follow it, so the edge you see is the edge that would face
// you. The viewer is kept below the slab (you look up at a departure board),
// so the underside stays visible and the slab never reads as flat.
function useViewpoint(enabled: boolean) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    const canTrack = window.matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)");
    let frame = 0;

    const reset = () => {
      cancelAnimationFrame(frame);
      for (const prop of ["--slab-dx", "--slab-dy", "--slab-rx", "--slab-ry"]) el.style.removeProperty(prop);
    };

    const onMove = (event: PointerEvent) => {
      if (!canTrack.matches || event.pointerType !== "mouse") return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect();
        const px = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const py = ((event.clientY - rect.top) / rect.height) * 2 - 1;
        const depth = parseFloat(getComputedStyle(el).getPropertyValue("--slab-depth")) || 8;
        el.style.setProperty("--slab-dx", `${depth * (0.3 + 0.5 * px)}px`);
        el.style.setProperty("--slab-dy", `${depth * (0.6 + 0.4 * py)}px`);
        el.style.setProperty("--slab-rx", `${py * MAX_TILT_DEG}deg`);
        el.style.setProperty("--slab-ry", `${-px * MAX_TILT_DEG}deg`);
      });
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", reset);
    canTrack.addEventListener("change", reset);
    return () => {
      reset();
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", reset);
      canTrack.removeEventListener("change", reset);
    };
  }, [enabled]);

  return ref;
}

export function Slab(props: SlabProps) {
  const { depth = "md", state, selected, className, children } = props;
  const interactive = Boolean(props.href || props.onClick || props.type) && !props.disabled;
  const ref = useViewpoint(interactive);

  const rail = state ? railColor(state) : undefined;
  const shared = {
    className: cn("slab p-4 text-left", rail && "pl-[calc(1rem+6px)]", props.disabled && "opacity-60", className),
    "data-depth": depth,
    "data-interactive": interactive || undefined,
    "data-selected": selected || undefined,
    style: rail ? ({ "--rail-color": rail } as CSSProperties) : undefined,
  };
  const content = (
    <>
      {rail && <span className="slab-rail" aria-hidden />}
      {children}
    </>
  );

  if (props.href) {
    return (
      <Link href={props.href} ref={ref as Ref<HTMLAnchorElement>} {...shared}>
        {content}
      </Link>
    );
  }

  if (props.onClick || props.type) {
    return (
      <button
        ref={ref as Ref<HTMLButtonElement>}
        type={props.type ?? "button"}
        onClick={props.onClick}
        disabled={props.disabled}
        {...shared}
      >
        {content}
      </button>
    );
  }

  return (
    <div ref={ref as Ref<HTMLDivElement>} {...shared}>
      {content}
    </div>
  );
}
