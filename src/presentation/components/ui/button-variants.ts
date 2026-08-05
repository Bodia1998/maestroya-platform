import { type VariantProps, cva } from "class-variance-authority";

/**
 * `buttonVariants` — the CVA class-name recipe shared by `Button` (an
 * interactive `<button>`, genuinely client-side) and `ButtonLink` (a
 * `next/link` styled the same way, which is plain markup and has no
 * "use client" directive of its own).
 *
 * Deliberately its own module, with no "use client" directive. `cva()`
 * just builds a class-name string — it does nothing that requires the
 * browser — so it belongs with the app's other shared styling utilities
 * (like `cn()`), usable from Server Components. Previously this lived in
 * `button.tsx`, which is a Client Component (`Button` needs `onClick`
 * etc.); that made `buttonVariants` a client-only export by construction,
 * even though nothing about it is actually client-only. Any Server
 * Component importing `ButtonLink` (which calls `buttonVariants()` to
 * compute its class name) then failed to prerender with "Attempted to
 * call buttonVariants() from the server but buttonVariants is on the
 * client" — Next.js does not allow a Server Component to invoke a
 * function from a "use client" module, even a pure one.
 */
export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] motion-reduce:active:scale-100 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover",
        accent: "bg-accent text-accent-foreground shadow-xs hover:bg-accent-hover",
        outline: "border border-border bg-background hover:bg-muted",
        ghost: "hover:bg-muted",
        secondary: "bg-muted text-foreground hover:bg-border/60",
        danger: "bg-danger text-danger-foreground shadow-xs hover:opacity-90",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-5 py-2.5",
        sm: "h-9 rounded-md px-3.5 text-sm",
        lg: "h-12 rounded-lg px-7 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type ButtonVariantProps = VariantProps<typeof buttonVariants>;
