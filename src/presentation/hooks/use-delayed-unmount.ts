"use client";

import * as React from "react";

/**
 * Module 30.8 — Motion & Microinteractions.
 *
 * Keeps a portal-rendered overlay (`Dialog`, `Drawer`) mounted for
 * `durationMs` after `active` flips to `false`, so its CSS exit animation
 * (e.g. `animate-fade-out`) has time to actually play instead of the
 * element vanishing instantly.
 *
 * Root cause this fixes: `tailwind.config.ts` already defines `fade-out`,
 * `slide-out-right` (and, as of this module, `slide-out-left`) keyframes,
 * but nothing in the codebase ever used them — every `if (!open) return
 * null;` guard unmounted the overlay the instant `open` went false, so
 * modals and drawers opened with a smooth animation but closed with an
 * abrupt snap. Call sites swap `animate-fade-in`/`animate-slide-*` for
 * `animate-fade-out`/`animate-slide-out-*` while `closing` is true.
 */
export function useDelayedUnmount(active: boolean, durationMs = 200) {
  const [state, setState] = React.useState<"closed" | "open" | "closing">(active ? "open" : "closed");

  React.useEffect(() => {
    if (active) {
      setState("open");
      return;
    }
    setState((prev) => (prev === "closed" ? "closed" : "closing"));
  }, [active]);

  React.useEffect(() => {
    if (state !== "closing") return;
    const timeout = setTimeout(() => setState("closed"), durationMs);
    return () => clearTimeout(timeout);
  }, [state, durationMs]);

  return { shouldRender: state !== "closed", closing: state === "closing" };
}
