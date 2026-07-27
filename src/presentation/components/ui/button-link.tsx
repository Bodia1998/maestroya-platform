import * as React from "react";
import Link, { type LinkProps } from "next/link";

import { cn } from "@/shared/utils/cn";
import { type ButtonVariantProps, buttonVariants } from "./button-variants";

export interface ButtonLinkProps
  extends LinkProps,
    ButtonVariantProps,
    Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {}

/**
 * A `next/link` styled as a Button. This project has no Radix `Slot`
 * dependency, so rather than add one purely for a `Button asChild` API,
 * a dedicated `ButtonLink` covers the (very common) "this is really a
 * navigation link, not an action" case — same visual variants as
 * `Button`, real `<a>` semantics (right-click "open in new tab", no JS
 * required to navigate, proper `next/link` prefetching).
 *
 * No "use client" here on purpose: `ButtonLink` is plain markup (a link,
 * not an interactive control) and is rendered directly from Server
 * Components across the homepage (`Hero`, `HowItWorks`, `ProfessionalCta`,
 * etc.). It imports `buttonVariants` from `./button-variants` — not from
 * `./button`, which is a "use client" module — specifically so it stays
 * server-renderable. See `./button-variants`'s doc comment for why.
 */
export const ButtonLink = React.forwardRef<HTMLAnchorElement, ButtonLinkProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <Link
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    );
  },
);
ButtonLink.displayName = "ButtonLink";
