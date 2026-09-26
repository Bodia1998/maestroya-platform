import type { getFormatter } from "next-intl/server";

type Formatter = Awaited<ReturnType<typeof getFormatter>>;

/**
 * Module 120 — Multilingual Localization: locale-aware replacement for
 * `formatAppointmentWindow` on the professional appointment/job pages
 * (that shared helper formats with the runtime's default locale).
 * Presentation-only — no scheduling rule lives here.
 */
export function formatAppointmentWindowLocalized(
  format: Formatter,
  windowTemplate: (values: { start: string; end: string }) => string,
  start: Date | null,
  end: Date | null,
  emptyLabel: string,
): string {
  if (!start || !end) return emptyLabel;
  return windowTemplate({
    start: format.dateTime(start, { dateStyle: "medium", timeStyle: "short" }),
    end: format.dateTime(end, { timeStyle: "short" }),
  });
}
