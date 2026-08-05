import { describe, expect, it } from "vitest";

import { formatAppointmentWindow } from "@/shared/utils/format-appointment-window";

describe("formatAppointmentWindow", () => {
  it("formats a start/end window as a locale start string and end time", () => {
    const start = new Date("2026-08-10T10:00:00");
    const end = new Date("2026-08-10T11:30:00");
    expect(formatAppointmentWindow(start, end)).toBe(`${start.toLocaleString()} – ${end.toLocaleTimeString()}`);
  });

  it("returns the default fallback when start is null", () => {
    expect(formatAppointmentWindow(null, new Date())).toBe("Not set");
  });

  it("returns the default fallback when end is null", () => {
    expect(formatAppointmentWindow(new Date(), null)).toBe("Not set");
  });

  it("returns the default fallback when both are null", () => {
    expect(formatAppointmentWindow(null, null)).toBe("Not set");
  });

  it("uses a custom fallback label when provided", () => {
    expect(formatAppointmentWindow(null, null, "No time proposed yet")).toBe("No time proposed yet");
  });
});
