import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SegmentOption<T extends string> = {
  value: T;
  label: ReactNode;
  /** Optional leading icon (kept small; icons stay the app's Hugeicons). */
  icon?: ReactNode;
};

/**
 * Segmented control (spec §3): replaces every tab row and separate range pill.
 * `bg-muted` track, `rounded-xl`, 4px padding; the active segment is a white
 * card with a faint shadow. Values are controlled by the caller, so the same
 * component drives both local filters and route switching (pass an onChange
 * that navigates for tab-style use).
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className,
  size = "md",
  disabled,
  "aria-label": ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly SegmentOption<T>[];
  className?: string;
  size?: "sm" | "md";
  /** Grey out and refuse clicks — used to stop rapid filter toggles stacking heavy reads. */
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      aria-disabled={disabled}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-xl bg-muted p-1",
        disabled && "opacity-60",
        className,
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30",
              size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
              active
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
              disabled && "pointer-events-none",
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
