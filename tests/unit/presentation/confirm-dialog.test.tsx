import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";

function renderDialog(overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn().mockResolvedValue({ success: true });
  render(
    <ConfirmDialog
      triggerLabel="Withdraw this quote"
      title="Withdraw this quote?"
      description="The customer will no longer be able to accept it."
      confirmLabel="Yes, withdraw quote"
      pendingLabel="Withdrawing…"
      onConfirm={onConfirm}
      {...overrides}
    />,
  );
  return { onConfirm };
}

describe("ConfirmDialog", () => {
  it("renders only the trigger button when closed", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "Withdraw this quote" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens a real modal dialog when the trigger is clicked", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Withdraw this quote" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByText("Withdraw this quote?")).toBeTruthy();
    expect(screen.getByText("The customer will no longer be able to accept it.")).toBeTruthy();
  });

  it("closes without confirming when Cancel is clicked", async () => {
    // The dialog now plays a ~200ms exit animation (Module 30.8) before
    // unmounting, so it briefly stays in the DOM after the close trigger —
    // wait for the delayed unmount instead of asserting synchronous removal.
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Withdraw this quote" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("closes on Escape", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Withdraw this quote" }));
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("calls onConfirm and closes the dialog on success", async () => {
    const { onConfirm } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Withdraw this quote" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, withdraw quote" }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows the server error and keeps the dialog open on failure", async () => {
    const onConfirm = vi.fn().mockResolvedValue({ success: false, error: "Cannot withdraw right now." });
    renderDialog({ onConfirm });
    fireEvent.click(screen.getByRole("button", { name: "Withdraw this quote" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, withdraw quote" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText("Cannot withdraw right now.")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("renders extra children content inside the dialog body", () => {
    renderDialog({ children: <p>Extra field content</p> });
    fireEvent.click(screen.getByRole("button", { name: "Withdraw this quote" }));
    expect(screen.getByText("Extra field content")).toBeTruthy();
  });

  it("applies destructive styling to the title and confirm button when destructive", () => {
    renderDialog({ destructive: true });
    fireEvent.click(screen.getByRole("button", { name: "Withdraw this quote" }));
    expect(screen.getByText("Withdraw this quote?").className).toContain("text-danger");
  });
});
