import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression coverage for the restyled QuoteForm (module 30.4). Field
 * names / validation / submit wiring are unchanged from before the
 * restyle — this guards that the new shared form components (plus the
 * targeted aria-describedby fixes made alongside this pass) didn't break
 * label association or the accessible-error wiring, including inside the
 * dynamic `items` field array.
 */
const mockPush = vi.fn();
const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

const mockCreateQuoteAction = vi.fn();
const mockUpdateQuoteAction = vi.fn();
vi.mock("@/app/(dashboard)/dashboard/professional/quotes/actions", () => ({
  createQuoteAction: (...args: unknown[]) => mockCreateQuoteAction(...args),
  updateQuoteAction: (...args: unknown[]) => mockUpdateQuoteAction(...args),
}));

const { QuoteForm } = await import(
  "../../../src/app/(dashboard)/dashboard/professional/quotes/quote-form"
);

beforeEach(() => {
  mockPush.mockReset();
  mockRefresh.mockReset();
  mockCreateQuoteAction.mockReset();
  mockUpdateQuoteAction.mockReset();
});

const CREATE_REQUEST_ID = "11111111-1111-4111-8111-111111111111";

describe("QuoteForm (create mode)", () => {
  it("associates the first item row's fields with their (visually hidden) labels", () => {
    render(<QuoteForm mode="create" requestId={CREATE_REQUEST_ID} quote={null} />);
    expect(screen.getByLabelText("Description")).toBeTruthy();
    expect(screen.getByLabelText("Quantity")).toBeTruthy();
    expect(screen.getByLabelText("Unit price")).toBeTruthy();
    expect(screen.getByLabelText("Item type")).toBeTruthy();
  });

  it("associates the notes and valid-until fields with their labels", () => {
    render(<QuoteForm mode="create" requestId={CREATE_REQUEST_ID} quote={null} />);
    expect(screen.getByLabelText(/Notes \/ proposal/)).toBeTruthy();
    expect(screen.getByLabelText(/Valid until/)).toBeTruthy();
  });

  it("adds another item row, each with its own accessibly-labeled fields", () => {
    render(<QuoteForm mode="create" requestId={CREATE_REQUEST_ID} quote={null} />);
    fireEvent.click(screen.getByRole("button", { name: /Add item/ }));
    expect(screen.getAllByLabelText("Description")).toHaveLength(2);
  });

  it("shows an item validation error wired via aria-invalid/aria-describedby on the affected item row", async () => {
    render(<QuoteForm mode="create" requestId={CREATE_REQUEST_ID} quote={null} />);

    // Leave description blank, submit — quantity/unitPrice default to
    // valid values (1 / 0) so only the description should fail.
    fireEvent.click(screen.getByRole("button", { name: "Create quote" }));

    const error = await screen.findByText("Enter a description for this item.");
    expect(error).toBeTruthy();

    const descriptionInput = screen.getByLabelText("Description");
    expect(descriptionInput).toHaveAttribute("aria-invalid", "true");
    expect(descriptionInput.getAttribute("aria-describedby")).toBe(error.id);

    expect(mockCreateQuoteAction).not.toHaveBeenCalled();
  });

  it("submits the expected payload for a single item and navigates on success", async () => {
    mockCreateQuoteAction.mockResolvedValue({ success: true, id: "quote-1" });

    render(<QuoteForm mode="create" requestId={CREATE_REQUEST_ID} quote={null} />);

    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Replace tap washer" } });
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Unit price"), { target: { value: "45" } });
    // validUntil is optional, but its native <input type="date"> submits ""
    // (not undefined) when left blank, and z.coerce.date() rejects "" as an
    // invalid date — so it must be given a valid future date for the
    // client-side zod validation to pass and the submit handler to run.
    fireEvent.change(screen.getByLabelText(/Valid until/), { target: { value: "2099-01-01" } });

    fireEvent.click(screen.getByRole("button", { name: "Create quote" }));

    await waitFor(() => expect(mockCreateQuoteAction).toHaveBeenCalledTimes(1));
    const [requestIdArg, payload] = mockCreateQuoteAction.mock.calls[0]!;
    expect(requestIdArg).toBe(CREATE_REQUEST_ID);
    expect(payload).toMatchObject({
      items: [expect.objectContaining({ description: "Replace tap washer", quantity: 1, unitPrice: 45 })],
    });
    expect(mockPush).toHaveBeenCalledWith("/dashboard/professional/quotes/quote-1");
  });
});

describe("QuoteForm (edit mode)", () => {
  const quote = {
    id: "quote-1",
    notes: "Existing notes",
    validUntil: null,
    items: [{ description: "Replace tap washer", quantity: 1, unitPrice: 45, category: "LABOR" as const }],
  };

  it("prefills notes and item fields from the existing quote", () => {
    render(<QuoteForm mode="edit" quote={quote} />);
    expect(screen.getByLabelText(/Notes \/ proposal/)).toHaveValue("Existing notes");
    expect(screen.getByLabelText("Description")).toHaveValue("Replace tap washer");
  });

  it("calls updateQuoteAction on save", async () => {
    mockUpdateQuoteAction.mockResolvedValue({ success: true });
    render(<QuoteForm mode="edit" quote={quote} />);

    // Same as the create-mode test: validUntil defaults to "" for this
    // quote (validUntil: null), and z.coerce.date() rejects "" — give it a
    // valid future date so client-side validation lets the submit through.
    fireEvent.change(screen.getByLabelText(/Valid until/), { target: { value: "2099-01-01" } });

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mockUpdateQuoteAction).toHaveBeenCalledWith("quote-1", expect.anything()));
  });
});
