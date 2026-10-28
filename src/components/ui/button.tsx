import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // 44px-friendly heights, a 10px corner and Apple's decelerating press curve:
  // a control should feel like a physical key under a thumb, not a link.
  // Disabled swaps the fill for the muted surface instead of fading the whole
  // control: at 40% opacity a white label on the blue fill drops under 2:1 and
  // "loading", not "not yet".
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] text-sm font-semibold cursor-pointer transition-[background-color,color,transform,opacity] duration-200 ease-native focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none active:scale-[0.97] [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Primary is flat `bg-primary` (no gradient), hover darkens ~6%.
        default: "bg-primary text-primary-foreground hover:brightness-[0.94]",
        // Tinted primary for large POS actions: soft surface, colored label.
        soft: "bg-primary-soft text-primary-soft-foreground hover:brightness-[0.95]",
        // The counter's money action: jet ink on white, and the only control a
        // cashier is meant to reach for last. Opacity (not brightness) so the
        // hover works in both a light and a dark palette.
        charge: "bg-charge text-charge-foreground hover:opacity-90",
        destructive: "bg-destructive-soft text-destructive hover:brightness-[0.97]",
        outline: "border border-input bg-card text-foreground hover:bg-muted",
        secondary: "bg-secondary text-secondary-foreground hover:brightness-[0.97]",
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground disabled:bg-transparent",
        accent: "bg-accent text-accent-foreground hover:brightness-[0.94]",
        success: "bg-success text-success-foreground hover:brightness-[0.94]",
        link: "text-primary underline-offset-4 hover:underline disabled:bg-transparent",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 px-3 text-xs",
        lg: "h-11 px-6 text-base",
        xl: "h-14 px-6 text-lg",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
