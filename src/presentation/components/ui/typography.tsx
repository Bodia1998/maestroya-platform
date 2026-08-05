import * as React from "react";
import { type VariantProps, cva } from "class-variance-authority";

import { cn } from "@/shared/utils/cn";

const headingVariants = cva("font-semibold tracking-tight text-foreground", {
  variants: {
    level: {
      h1: "text-4xl sm:text-5xl",
      h2: "text-3xl sm:text-4xl",
      h3: "text-2xl sm:text-3xl",
      h4: "text-xl sm:text-2xl",
      h5: "text-lg sm:text-xl",
      h6: "text-base sm:text-lg",
    },
  },
  defaultVariants: { level: "h1" },
});

export interface HeadingProps
  extends React.HTMLAttributes<HTMLHeadingElement>,
    VariantProps<typeof headingVariants> {
  /** Element actually rendered; defaults to `level`. Lets you keep the visual size while fixing the outline (e.g. an `<h2>` styled like an `h1`). */
  as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
}

/** Semantic heading with a design-system size scale decoupled from the HTML tag. */
export const Heading = React.forwardRef<HTMLHeadingElement, HeadingProps>(
  ({ className, level = "h1", as, ...props }, ref) => {
    const Tag = as ?? level ?? "h1";
    return (
      <Tag ref={ref} className={cn(headingVariants({ level }), className)} {...props} />
    );
  },
);
Heading.displayName = "Heading";

const textVariants = cva("text-foreground", {
  variants: {
    size: {
      xs: "text-xs",
      sm: "text-sm",
      base: "text-base",
      lg: "text-lg",
      xl: "text-xl",
    },
    weight: {
      normal: "font-normal",
      medium: "font-medium",
      semibold: "font-semibold",
      bold: "font-bold",
    },
    tone: {
      default: "text-foreground",
      muted: "text-muted-foreground",
      primary: "text-primary",
      success: "text-success",
      warning: "text-warning",
      danger: "text-danger",
    },
  },
  defaultVariants: { size: "base", weight: "normal", tone: "default" },
});

export interface TextProps
  extends React.HTMLAttributes<HTMLElement>,
    VariantProps<typeof textVariants> {
  as?: "p" | "span" | "div" | "label";
}

/** Body text primitive — the size/weight/tone scale used everywhere prose isn't a `<Heading>`. */
export const Text = React.forwardRef<HTMLElement, TextProps>(
  ({ className, size, weight, tone, as = "p", ...props }, ref) => {
    const Tag = as as "p";
    return (
      <Tag
        ref={ref as React.Ref<HTMLParagraphElement>}
        className={cn(textVariants({ size, weight, tone }), className)}
        {...props}
      />
    );
  },
);
Text.displayName = "Text";
