import type * as React from "react";

import { Button, type ButtonProps } from "@/components/ui/button";

/**
 * The small outline submit button used inside a per-row (or detail-page)
 * mutation `<form action={...}>` in the admin panel — Suspend/Reactivate
 * (users, companies), Hide/Restore (portfolio, reviews). Previously a
 * hand-rolled `<button className="rounded-md border border-border px-2 py-1
 * text-xs …">` repeated at each call site with no focus-visible ring; now a
 * thin `size="sm"` wrapper over the shared `Button` primitive so it gets the
 * same focus ring, disabled state, and hover treatment as every other button
 * in the app for free.
 */
export function AdminRowActionButton({ className, ...props }: ButtonProps) {
  return <Button type="submit" variant="outline" size="sm" className={className} {...props} />;
}
