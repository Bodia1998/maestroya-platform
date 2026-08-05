import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Drawer, DrawerClose, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";

function renderDrawer(open: boolean, onOpenChange = vi.fn()) {
  return {
    onOpenChange,
    ...render(
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerClose onClose={() => onOpenChange(false)} />
        <DrawerHeader>
          <DrawerTitle>Navigation</DrawerTitle>
        </DrawerHeader>
        <p>Drawer body content</p>
      </Drawer>,
    ),
  };
}

describe("Drawer", () => {
  it("renders nothing when closed", () => {
    renderDrawer(false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders its content as a modal dialog when open", () => {
    renderDrawer(true);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByText("Drawer body content")).toBeTruthy();
    expect(screen.getByText("Navigation")).toBeTruthy();
  });

  it("calls onOpenChange(false) when the close button is clicked", () => {
    const { onOpenChange } = renderDrawer(true);

    fireEvent.click(screen.getByRole("button", { name: /cerrar/i }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("calls onOpenChange(false) when the backdrop is clicked", () => {
    const onOpenChange = vi.fn();
    render(
      <Drawer open onOpenChange={onOpenChange}>
        <p>content</p>
      </Drawer>,
    );

    // The Drawer renders via a portal into `document.body`, so it never
    // becomes a descendant of RTL's `container` — querying `container`
    // directly would always find nothing. `screen` searches the whole
    // document (including portals), so we scope from the dialog itself:
    // the backdrop is its `aria-hidden` sibling within the portal root.
    const dialog = screen.getByRole("dialog");
    const backdrop = dialog.parentElement?.querySelector('[aria-hidden="true"]');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("calls onOpenChange(false) on Escape", () => {
    const onOpenChange = vi.fn();
    render(
      <Drawer open onOpenChange={onOpenChange}>
        <p>content</p>
      </Drawer>,
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
