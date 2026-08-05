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
export function formatAppointmentWindow(
  start: Date | null,
  end: Date | null,
  emptyLabel: string = "Not set",
): string {
  if (!start || !end) return emptyLabel;
  return `${start.toLocaleString()} – ${end.toLocaleTimeString()}`;
}
