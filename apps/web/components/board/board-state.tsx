import { dayKey, type DriveStatus } from "@walkins/shared";
import { cn } from "@/lib/utils";

export type BoardState = "live" | "filling" | "closing" | "pending" | "draft" | "expired" | "cancelled";

export const FILLING_THRESHOLD = 0.7;

// Nothing moves a LIVE drive to EXPIRED yet (that job is Phase 4), so a live
// drive whose window has ended is derived as expired here. Once the job
// writes EXPIRED, that status maps straight through and this branch simply
// stops being reached. Closing today outranks filling up: time is the harder
// constraint for someone deciding whether to travel.
export function deriveBoardState(
  drive: { status: DriveStatus; endsAt: string; capacity: number; bookedCount?: number },
  now: Date,
): BoardState {
  switch (drive.status) {
    case "DRAFT":
      return "draft";
    case "PENDING":
      return "pending";
    case "CANCELLED":
      return "cancelled";
    case "EXPIRED":
      return "expired";
  }
  const endsAt = new Date(drive.endsAt);
  if (endsAt <= now) return "expired";
  if (dayKey(endsAt) === dayKey(now)) return "closing";
  if (drive.bookedCount !== undefined && drive.capacity > 0 && drive.bookedCount / drive.capacity >= FILLING_THRESHOLD) {
    return "filling";
  }
  return "live";
}

type Surface = "stock" | "housing";

type Shape = "dot" | "half" | "triangle" | "ring" | "square" | "dash" | "cross";

// Live and closing inks sit at almost the same luminance, so shape and label
// are what separate them for red-green colourblind users; colour is the fast
// glance, never the only carrier.
const STATES: Record<BoardState, { label: string; shape: Shape; tone: "live" | "filling" | "closing" | "pending" | null }> = {
  live: { label: "Live", shape: "dot", tone: "live" },
  filling: { label: "Filling up", shape: "half", tone: "filling" },
  closing: { label: "Closing today", shape: "triangle", tone: "closing" },
  pending: { label: "Pending review", shape: "ring", tone: "pending" },
  draft: { label: "Draft", shape: "square", tone: null },
  expired: { label: "Expired", shape: "dash", tone: null },
  cancelled: { label: "Cancelled", shape: "cross", tone: null },
};

// The token name rather than a var() reference, for consumers that need the
// resolved hex (MapLibre paint properties cannot read CSS variables).
export function stateToken(state: BoardState, surface: Surface): string {
  const tone = STATES[state].tone;
  if (!tone) {
    return surface === "stock" ? "--ink-muted" : "--housing-muted";
  }
  return `--${tone}-${surface === "stock" ? "ink" : "lamp"}`;
}

export function stateColor(state: BoardState, surface: Surface): string {
  return `var(${stateToken(state, surface)})`;
}

// The rail is printed onto stock; neutral states get no rail at all.
export function railColor(state: BoardState): string | undefined {
  return STATES[state].tone ? stateColor(state, "stock") : undefined;
}

export function stateLabel(state: BoardState): string {
  return STATES[state].label;
}

function ShapeGlyph({ shape }: { shape: Shape }) {
  const common = { width: "0.75em", height: "0.75em", viewBox: "0 0 12 12", "aria-hidden": true } as const;
  switch (shape) {
    case "dot":
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="5" fill="currentColor" />
        </svg>
      );
    case "half":
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6 1.75 A4.25 4.25 0 0 0 6 10.25 Z" fill="currentColor" />
        </svg>
      );
    case "triangle":
      return (
        <svg {...common}>
          <path d="M6 1 L11.5 11 H0.5 Z" fill="currentColor" />
        </svg>
      );
    case "ring":
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case "square":
      return (
        <svg {...common}>
          <rect x="1.75" y="1.75" width="8.5" height="8.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case "dash":
      return (
        <svg {...common}>
          <rect x="1" y="5" width="10" height="2" fill="currentColor" />
        </svg>
      );
    case "cross":
      return (
        <svg {...common}>
          <path d="M2 2 L10 10 M10 2 L2 10" stroke="currentColor" strokeWidth="1.75" />
        </svg>
      );
  }
}

export function StatusMark({
  state,
  surface,
  className,
}: {
  state: BoardState;
  surface: Surface;
  className?: string;
}) {
  const { label, shape } = STATES[state];
  return (
    <span
      className={cn("type-meta inline-flex items-center gap-1.5", className)}
      style={{ color: stateColor(state, surface) }}
    >
      <ShapeGlyph shape={shape} />
      {label}
    </span>
  );
}
