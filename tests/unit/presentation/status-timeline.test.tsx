import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusTimeline, type TimelineStep } from "@/components/dashboard/status-timeline";

const HAPPY_PATH: TimelineStep[] = [
  { key: "sent", label: "Sent", state: "complete" },
  { key: "viewed", label: "Viewed", state: "current" },
  { key: "accepted", label: "Accepted", state: "upcoming" },
];

describe("StatusTimeline", () => {
  it("renders every step's label", () => {
    render(<StatusTimeline steps={HAPPY_PATH} />);
    expect(screen.getByText("Sent")).toBeTruthy();
    expect(screen.getByText("Viewed")).toBeTruthy();
    expect(screen.getByText("Accepted")).toBeTruthy();
  });

  it("renders as an ordered list", () => {
    render(<StatusTimeline steps={HAPPY_PATH} />);
    expect(screen.getByRole("list").tagName).toBe("OL");
  });

  it("marks the current step with aria-current=step", () => {
    render(<StatusTimeline steps={HAPPY_PATH} />);
    const current = screen.getByText("Viewed");
    expect(current.getAttribute("aria-current")).toBe("step");
  });

  it("does not mark complete or upcoming steps as current", () => {
    render(<StatusTimeline steps={HAPPY_PATH} />);
    expect(screen.getByText("Sent").getAttribute("aria-current")).toBeNull();
    expect(screen.getByText("Accepted").getAttribute("aria-current")).toBeNull();
  });

  it("renders a danger step distinctly from the happy path", () => {
    const steps: TimelineStep[] = [
      { key: "sent", label: "Sent", state: "complete" },
      { key: "withdrawn", label: "Withdrawn", state: "danger" },
    ];
    render(<StatusTimeline steps={steps} />);
    const danger = screen.getByText("Withdrawn");
    expect(danger.className).toContain("text-danger");
  });

  it("renders one list item per step", () => {
    render(<StatusTimeline steps={HAPPY_PATH} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("merges a custom className onto the list", () => {
    render(<StatusTimeline steps={HAPPY_PATH} className="custom-class" />);
    expect(screen.getByRole("list").className).toContain("custom-class");
  });
});
