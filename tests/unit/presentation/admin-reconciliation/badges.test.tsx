import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ResolutionStatusBadge,
  RunStatusBadge,
  SeverityBadge,
} from "@/app/(dashboard)/admin/reconciliation/_components/badges";

describe("SeverityBadge", () => {
  it("labels CRITICAL as Critical", () => {
    render(<SeverityBadge severity="CRITICAL" />);
    expect(screen.getByText("Critical")).toBeTruthy();
  });

  it("labels INFO as Low", () => {
    render(<SeverityBadge severity="INFO" />);
    expect(screen.getByText("Low")).toBeTruthy();
  });
});

describe("ResolutionStatusBadge", () => {
  it("never reuses the shared StatusBadge's success color for an OPEN (unresolved) discrepancy", () => {
    // Regression guard for the exact collision this component's own doc
    // comment warns about: `StatusBadge` maps a Service Request's `OPEN`
    // to "success" (green) — that would be actively misleading for an
    // unresolved financial discrepancy, which needs admin attention.
    const { container } = render(<ResolutionStatusBadge status="OPEN" />);
    expect(container.textContent).toBe("Open");
    expect(container.querySelector(".text-success")).toBeNull();
  });

  it("labels RESOLVED as Resolved", () => {
    render(<ResolutionStatusBadge status="RESOLVED" />);
    expect(screen.getByText("Resolved")).toBeTruthy();
  });
});

describe("RunStatusBadge", () => {
  it.each([
    ["RUNNING", "Running"],
    ["COMPLETED", "Completed"],
    ["FAILED", "Failed"],
  ])("labels %s as %s", (status, label) => {
    render(<RunStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeTruthy();
  });
});
