import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Tooltip } from "@/components/ui/tooltip";

describe("Tooltip", () => {
  it("does not show its content until hovered", () => {
    render(
      <Tooltip content="Helpful hint" delayMs={0}>
        <button type="button">Target</button>
      </Tooltip>,
    );

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows the tooltip content on hover", async () => {
    render(
      <Tooltip content="Helpful hint" delayMs={0}>
        <button type="button">Target</button>
      </Tooltip>,
    );

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Target" }));

    await waitFor(() => expect(screen.getByRole("tooltip")).toHaveTextContent("Helpful hint"));
  });

  it("hides the tooltip on mouse leave", async () => {
    render(
      <Tooltip content="Helpful hint" delayMs={0}>
        <button type="button">Target</button>
      </Tooltip>,
    );

    const target = screen.getByRole("button", { name: "Target" });
    fireEvent.mouseEnter(target);
    await waitFor(() => expect(screen.getByRole("tooltip")).toBeTruthy());

    fireEvent.mouseLeave(target);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows on keyboard focus and hides on blur, for keyboard-only users", async () => {
    render(
      <Tooltip content="Helpful hint" delayMs={0}>
        <button type="button">Target</button>
      </Tooltip>,
    );

    const target = screen.getByRole("button", { name: "Target" });
    fireEvent.focus(target);
    await waitFor(() => expect(screen.getByRole("tooltip")).toBeTruthy());
    expect(target.getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);

    fireEvent.blur(target);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
