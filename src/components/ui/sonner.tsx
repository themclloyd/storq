/**
 * Toast chrome for the whole app.
 *
 * Sonner ships a stock white/black card with saturated variant colours (that is what
 * `richColors` turns on), which sits badly on the token palette every badge and banner
 * in the product is built from. Each variant here borrows the same soft tint its
 * in-page counterpart uses — `success-soft`, `warning-soft`, `destructive-soft` — so a
 * toast reads as part of the screen instead of a block dropped on top of it.
 *
 * The background and border live on the per-variant keys, not on `toast`: sonner merges
 * both lists onto one element, and two utilities for the same property would resolve by
 * stylesheet order rather than by intent.
 *
 * `group-[.toaster]:` doubles the selector weight so these beat sonner's injected
 * defaults, exactly like the shadcn baseline this file started from.
 */
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

// Shape only — no colours, so a variant can own them without a conflict.
const SHAPE =
  "group toast group-[.toaster]:items-start group-[.toaster]:gap-3 group-[.toaster]:rounded-2xl " +
  "group-[.toaster]:border group-[.toaster]:px-3.5 group-[.toaster]:py-3 group-[.toaster]:shadow-lg";

const NEUTRAL =
  "group-[.toaster]:border-border group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground";

const VARIANTS = {
  default: NEUTRAL,
  info: NEUTRAL,
  loading: NEUTRAL,
  success:
    "group-[.toaster]:border-success/25 group-[.toaster]:bg-success-soft group-[.toaster]:text-foreground",
  error:
    "group-[.toaster]:border-destructive/25 group-[.toaster]:bg-destructive-soft group-[.toaster]:text-foreground",
  warning:
    "group-[.toaster]:border-warning/40 group-[.toaster]:bg-warning-soft group-[.toaster]:text-warning-foreground",
} as const;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      toastOptions={{
        classNames: {
          ...VARIANTS,
          toast: SHAPE,
          title:
            "group-[.toast]:text-[13px] group-[.toast]:font-medium group-[.toast]:leading-snug",
          description: "group-[.toast]:text-xs group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:rounded-lg group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:rounded-lg group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          closeButton: "group-[.toast]:border-border group-[.toast]:bg-background",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
