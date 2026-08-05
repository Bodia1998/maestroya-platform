import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

function renderAccordion(type: "single" | "multiple" = "single", defaultValue?: string | string[]) {
  return render(
    <Accordion type={type} defaultValue={defaultValue}>
      <AccordionItem value="a">
        <AccordionTrigger>Question A</AccordionTrigger>
        <AccordionContent>Answer A</AccordionContent>
      </AccordionItem>
      <AccordionItem value="b">
        <AccordionTrigger>Question B</AccordionTrigger>
        <AccordionContent>Answer B</AccordionContent>
      </AccordionItem>
    </Accordion>,
  );
}

describe("Accordion", () => {
  it("renders every trigger, with content collapsed by default", () => {
    renderAccordion();
    expect(screen.getByRole("button", { name: "Question A" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Question B" })).toBeTruthy();
    expect(screen.queryByText("Answer A")).toBeNull();
    expect(screen.queryByText("Answer B")).toBeNull();
  });

  it("expands an item's content on trigger click and flips aria-expanded", () => {
    renderAccordion();
    const triggerA = screen.getByRole("button", { name: "Question A" });

    fireEvent.click(triggerA);

    expect(triggerA.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Answer A")).toBeTruthy();
  });

  it("collapses an open item on a second click", () => {
    renderAccordion();
    const triggerA = screen.getByRole("button", { name: "Question A" });

    fireEvent.click(triggerA);
    fireEvent.click(triggerA);

    expect(triggerA.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Answer A")).toBeNull();
  });

  it("keeps at most one item open in single mode", () => {
    renderAccordion("single");

    fireEvent.click(screen.getByRole("button", { name: "Question A" }));
    fireEvent.click(screen.getByRole("button", { name: "Question B" }));

    expect(screen.queryByText("Answer A")).toBeNull();
    expect(screen.getByText("Answer B")).toBeTruthy();
  });

  it("allows multiple open items in multiple mode", () => {
    renderAccordion("multiple");

    fireEvent.click(screen.getByRole("button", { name: "Question A" }));
    fireEvent.click(screen.getByRole("button", { name: "Question B" }));

    expect(screen.getByText("Answer A")).toBeTruthy();
    expect(screen.getByText("Answer B")).toBeTruthy();
  });

  it("honors defaultValue to start with an item already open", () => {
    renderAccordion("single", "b");
    expect(screen.getByText("Answer B")).toBeTruthy();
    expect(screen.queryByText("Answer A")).toBeNull();
  });

  it("throws when AccordionTrigger is used outside AccordionItem", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      render(
        <Accordion>
          <AccordionTrigger>Orphan</AccordionTrigger>
        </Accordion>,
      ),
    ).toThrow();
    spy.mockRestore();
  });
});
