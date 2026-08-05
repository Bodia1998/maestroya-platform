import * as React from "react";
import Link, { type LinkProps } from "next/link";

import { cn } from "@/shared/utils/cn";

/**
 * Module 30.8 — Motion & Microinteractions.
 *
 * The "clickable list-item card" hover treatment — subtle lift + deeper
 * shadow — was hand-duplicated verbatim (`shadow-sm transition-all
 * hover:-translate-y-0.5 hover:shadow-md`) across `KPICard`, `QuoteCard`,
 * `RequestCard`, `AppointmentCard`, `JobCard`, `CompanyCard`, and two
 * dashboard pages (`support-tickets`, `disputes`) — 9 occurrences total.
 * Centralized here as the single source of truth; `LinkCard` below wraps
 * the also-duplicated `Link` + focus-ring + `Card` combo those same call
 * sites all repeated.
 *
 * `motion-reduce:hover:translate-y-0` is deliberate on top of the global
 * `prefers-reduced-motion` rule in `globals.css`: that rule zeroes out
 * *durations*, but a 0.01ms transform still repaints the card in its
 * shifted position on hover — this additionally cancels the transform
 * itself so a reduced-motion user sees no positional shift at all.
 */
export const cardHoverClassName =
  "shadow-sm transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-md motion-reduce:hover:translate-y-0";

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-xl border border-border bg-card text-card-foreground shadow-sm",
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col gap-1.5 p-6", className)} {...props} />
  ),
);
CardHeader.displayName = "CardHeader";

export const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref as React.Ref<HTMLHeadingElement>}
      className={cn("text-lg font-semibold leading-tight tracking-tight", className)}
      {...props}
    />
  ),
);
CardTitle.displayName = "CardTitle";

export const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
  ),
);
CardDescription.displayName = "CardDescription";

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
  ),
);
CardContent.displayName = "CardContent";

export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center gap-3 p-6 pt-0", className)} {...props} />
  ),
);
CardFooter.displayName = "CardFooter";

export interface LinkCardProps
  extends LinkProps,
    Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  /** Class names for the inner `Card` itself (padding/layout) — `className` targets the outer `Link`. */
  cardClassName?: string;
}

/**
 * A whole `Card` acting as a navigation link — the "clickable list-item
 * card" pattern (`Link` wrapping a hover-lift `Card`, with a visible focus
 * ring on the link) that `QuoteCard`, `RequestCard`, `AppointmentCard`,
 * `JobCard`, `CompanyCard`, and the support-tickets/disputes list pages
 * all previously hand-rolled identically. `KPICard` keeps its own
 * `href`-optional variant (it can render as either a plain `Card` or a
 * link, which doesn't fit this always-a-link shape) but reuses
 * `cardHoverClassName` for the same visual treatment.
 */
export const LinkCard = React.forwardRef<HTMLAnchorElement, LinkCardProps>(
  ({ className, cardClassName, children, ...props }, ref) => (
    <Link
      ref={ref}
      className={cn(
        "block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
      {...props}
    >
      <Card className={cn(cardHoverClassName, cardClassName)}>{children}</Card>
    </Link>
  ),
);
LinkCard.displayName = "LinkCard";
