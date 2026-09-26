/**
 * Booking & Scheduling module (Module 10) — the "start – end" window label
 * every appointment list/detail page renders, previously hand-duplicated
 * (byte-for-byte identical logic, only the "nothing scheduled yet" fallback
 * text differed) across:
 *   - (dashboard)/appointments/page.tsx
 *   - (dashboard)/appointments/[id]/page.tsx
 *   - (dashboard)/dashboard/professional/appointments/page.tsx
 *   - (dashboard)/dashboard/professional/appointments/[id]/page.tsx
 *
 * Presentation-only formatting — never touches scheduling business rules
 * (those live in domain/services/appointment-state.ts).
 */
import type { useFormatter } from "next-intl";

/** The subset of next-intl's `useFormatter()` / `getFormatter()` this helper needs (type-only import). */
export type AppointmentWindowFormatter = Pick<ReturnType<typeof useFormatter>, "dateTime">;

/**
 * Module 120 — Multilingual Localization: pass `format` (next-intl's
 * formatter for the active locale) and a localized `emptyLabel`. Without a
 * formatter the legacy runtime-default `toLocaleString()` output is kept
 * for callers not yet migrated.
 */
export function formatAppointmentWindow(
  start: Date | null,
  end: Date | null,
  emptyLabel: string = "Not set", // i18n-ignore: legacy default; migrated callers pass a localized label
  format?: AppointmentWindowFormatter,
): string {
  if (!start || !end) return emptyLabel;
  if (format) {
    return `${format.dateTime(start, { dateStyle: "medium", timeStyle: "short" })} – ${format.dateTime(end, { timeStyle: "short" })}`;
  }
  return `${start.toLocaleString()} – ${end.toLocaleTimeString()}`;
}
