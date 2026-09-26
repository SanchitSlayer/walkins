import {
  type ButtonHTMLAttributes,
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

type Surface = "housing" | "stock";

const INPUT_SURFACE: Record<Surface, string> = {
  housing: "bg-housing-raised text-stock border-housing-rule placeholder:text-housing-muted [color-scheme:dark]",
  stock: "bg-transparent text-ink border-ink-muted placeholder:text-ink-muted [color-scheme:light]",
};

export const BoardInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { surface?: Surface; board?: boolean }
>(function BoardInput({ surface = "housing", board = false, className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-11 w-full border px-3 disabled:opacity-60",
        board ? "type-board-md" : "type-body",
        INPUT_SURFACE[surface],
        className,
      )}
      {...props}
    />
  );
});

// Form actions are flat: a raised slab is something you pick up and go to,
// while a form's own buttons stay printed onto the panel that holds them.
const BUTTON_SURFACE: Record<Surface, Record<"primary" | "quiet", string>> = {
  housing: {
    primary: "bg-stock text-ink border-stock hover:bg-stock-edge",
    quiet: "text-stock border-housing-rule hover:bg-housing-raised",
  },
  stock: {
    primary: "bg-ink text-stock border-ink hover:bg-housing-raised",
    quiet: "text-ink border-ink-muted hover:bg-stock-edge",
  },
};

// Exported for links that act as buttons, which can't be nested in a <button>.
export function boardButtonClass(surface: Surface = "housing", variant: "primary" | "quiet" = "primary") {
  return cn(
    "type-meta inline-flex min-h-11 items-center justify-center border px-5 disabled:cursor-not-allowed disabled:opacity-60",
    BUTTON_SURFACE[surface][variant],
  );
}

export function BoardButton({
  surface = "housing",
  variant = "primary",
  type = "button",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { surface?: Surface; variant?: "primary" | "quiet" }) {
  return <button type={type} className={cn(boardButtonClass(surface, variant), className)} {...props} />;
}

export function BoardSelect({
  surface = "housing",
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { surface?: Surface }) {
  return <select className={cn("type-body h-11 w-full border px-2 disabled:opacity-60", INPUT_SURFACE[surface], className)} {...props} />;
}

export function BoardField({
  label,
  hint,
  surface = "housing",
  className,
  children,
}: {
  label: string;
  hint?: string;
  surface?: Surface;
  className?: string;
  children: ReactNode;
}) {
  const muted = surface === "housing" ? "text-housing-muted" : "text-ink-muted";
  return (
    <label className={cn("grid content-start gap-1.5", className)}>
      <span className={cn("type-meta", muted)}>{label}</span>
      {children}
      {hint && <span className={cn("type-meta", muted)}>{hint}</span>}
    </label>
  );
}
