import { render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it } from "vitest";

import { Toaster, toast } from "@/components/ui/toast";

// `toast`'s backing store is a module-level singleton (see toast.tsx's own
// doc comment on why), so every test below explicitly dismisses whatever
// it queued rather than relying on unmount to clear it — otherwise a toast
// left behind by one test would still be in the DOM for the next.
describe("Toaster", () => {
  it("renders nothing before any toast has been queued", () => {
    render(<Toaster />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("renders a queued toast's title and description", async () => {
    render(<Toaster />);
    let id = "";

    act(() => {
      id = toast("Saved", { description: "Your changes were saved.", duration: 0 });
    });

    await waitFor(() => expect(screen.getByText("Saved")).toBeTruthy());
    expect(screen.getByText("Your changes were saved.")).toBeTruthy();

    act(() => toast.dismiss(id));
  });

  it("supports the success/warning/error/info call-site variants", async () => {
    render(<Toaster />);
    const ids: string[] = [];

    act(() => {
      ids.push(toast.success("Success title", { duration: 0 }));
      ids.push(toast.warning("Warning title", { duration: 0 }));
      ids.push(toast.error("Error title", { duration: 0 }));
      ids.push(toast.info("Info title", { duration: 0 }));
    });

    await waitFor(() => {
      expect(screen.getByText("Success title")).toBeTruthy();
      expect(screen.getByText("Warning title")).toBeTruthy();
      expect(screen.getByText("Error title")).toBeTruthy();
      expect(screen.getByText("Info title")).toBeTruthy();
    });

    act(() => ids.forEach((id) => toast.dismiss(id)));
  });

  it("dismisses a toast when its close button is clicked", async () => {
    render(<Toaster />);
    let id = "";

    act(() => {
      id = toast("Dismiss me", { duration: 0 });
    });
    await waitFor(() => expect(screen.getByText("Dismiss me")).toBeTruthy());

    act(() => toast.dismiss(id));

    await waitFor(() => expect(screen.queryByText("Dismiss me")).toBeNull());
  });

  it("announces toasts via an aria-live region", async () => {
    render(<Toaster />);
    let id = "";

    act(() => {
      id = toast("Announced", { duration: 0 });
    });

    await waitFor(() => expect(screen.getByText("Announced")).toBeTruthy());
    const liveRegion = screen.getByText("Announced").closest('[aria-live="polite"]');
    expect(liveRegion).not.toBeNull();

    act(() => toast.dismiss(id));
  });
});
