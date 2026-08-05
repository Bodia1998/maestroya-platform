import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression coverage for the restyled ServiceRequestForm (module 30.4).
 * Field names / validation / submit wiring are unchanged from before the
 * restyle — this guards that the new shared form components didn't break
 * label association or the accessible-error wiring.
 */
const mockPush = vi.fn();
const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

const mockCreateServiceRequestAction = vi.fn();
const mockUpdateServiceRequestAction = vi.fn();
vi.mock("@/app/(dashboard)/requests/actions", () => ({
  createServiceRequestAction: (...args: unknown[]) => mockCreateServiceRequestAction(...args),
  updateServiceRequestAction: (...args: unknown[]) => mockUpdateServiceRequestAction(...args),
}));

const { ServiceRequestForm } = await import("../../../src/app/(dashboard)/requests/service-request-form");

const categories = [{ id: "123e4567-e89b-12d3-a456-426614174000", name: "Plumbing" }];

beforeEach(() => {
  mockPush.mockReset();
  mockRefresh.mockReset();
  mockCreateServiceRequestAction.mockReset();
  mockUpdateServiceRequestAction.mockReset();
});

describe("ServiceRequestForm (create mode)", () => {
  it("associates every top-level field with its label", () => {
    render(<ServiceRequestForm mode="create" categories={categories} request={null} />);
    expect(screen.getByLabelText("Service category", { exact: false })).toBeTruthy();
    expect(screen.getByLabelText("Title", { exact: false })).toBeTruthy();
    expect(screen.getByLabelText("Description", { exact: false })).toBeTruthy();
    expect(screen.getByLabelText("Urgency", { exact: false })).toBeTruthy();
    expect(screen.getByLabelText(/Budget min \(EUR\)/)).toBeTruthy();
    expect(screen.getByLabelText(/Budget max \(EUR\)/)).toBeTruthy();
  });

  it("shows validation errors, wired via aria-invalid/aria-describedby, when submitting with empty required fields", async () => {
    render(<ServiceRequestForm mode="create" categories={categories} request={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Post request" }));

    const titleError = await screen.findByText("Enter a title.");
    expect(titleError).toBeTruthy();

    const titleInput = screen.getByLabelText("Title", { exact: false });
    expect(titleInput).toHaveAttribute("aria-invalid", "true");
    expect(titleInput).toHaveAttribute("aria-describedby", "title-error");
    expect(titleError.id).toBe("title-error");

    const descriptionInput = screen.getByLabelText("Description", { exact: false });
    expect(descriptionInput).toHaveAttribute("aria-invalid", "true");
    expect(descriptionInput).toHaveAttribute("aria-describedby", "description-error");

    expect(mockCreateServiceRequestAction).not.toHaveBeenCalled();
  });

  it("submits the expected payload and navigates to the new request on success", async () => {
    mockCreateServiceRequestAction.mockResolvedValue({ success: true, id: "req-1" });

    render(<ServiceRequestForm mode="create" categories={categories} request={null} />);

    fireEvent.change(screen.getByLabelText("Service category", { exact: false }), {
      target: { value: "123e4567-e89b-12d3-a456-426614174000" },
    });
    fireEvent.change(screen.getByLabelText("Title", { exact: false }), { target: { value: "Fix leaking kitchen tap" } });
    fireEvent.change(screen.getByLabelText("Description", { exact: false }), {
      target: { value: "The tap under the sink drips constantly." },
    });
    fireEvent.change(screen.getByPlaceholderText("Street address"), { target: { value: "Calle Mayor 1" } });
    fireEvent.change(screen.getByPlaceholderText("City"), { target: { value: "Madrid" } });
    fireEvent.change(screen.getByPlaceholderText("Postal code"), { target: { value: "28001" } });

    fireEvent.click(screen.getByRole("button", { name: "Post request" }));

    await waitFor(() => expect(mockCreateServiceRequestAction).toHaveBeenCalledTimes(1));
    const submitted = mockCreateServiceRequestAction.mock.calls[0]![0];
    expect(submitted).toMatchObject({
      categoryId: "123e4567-e89b-12d3-a456-426614174000",
      title: "Fix leaking kitchen tap",
      description: "The tap under the sink drips constantly.",
      location: expect.objectContaining({ line1: "Calle Mayor 1", city: "Madrid", postalCode: "28001" }),
    });
    expect(mockPush).toHaveBeenCalledWith("/requests/req-1");
  });

  it("maps server-side field errors from a failed submission back onto the form", async () => {
    // All values here are individually valid per createServiceRequestSchema
    // (so the zodResolver lets the submit reach the action at all) — the
    // fieldError below models a server-only business rule (e.g. a
    // duplicate-title check) that zod alone can't express, so this
    // actually exercises the setError()-based mapping path rather than
    // client-side validation short-circuiting it.
    mockCreateServiceRequestAction.mockResolvedValue({
      success: false,
      error: "Please fix the errors below.",
      fieldErrors: { title: ["You already have an open request with this title."] },
    });

    render(<ServiceRequestForm mode="create" categories={categories} request={null} />);

    fireEvent.change(screen.getByLabelText("Service category", { exact: false }), {
      target: { value: "123e4567-e89b-12d3-a456-426614174000" },
    });
    fireEvent.change(screen.getByLabelText("Title", { exact: false }), { target: { value: "Fix leaking kitchen tap" } });
    fireEvent.change(screen.getByLabelText("Description", { exact: false }), { target: { value: "Some description." } });
    fireEvent.change(screen.getByPlaceholderText("Street address"), { target: { value: "Calle Mayor 1" } });
    fireEvent.change(screen.getByPlaceholderText("City"), { target: { value: "Madrid" } });
    fireEvent.change(screen.getByPlaceholderText("Postal code"), { target: { value: "28001" } });

    fireEvent.click(screen.getByRole("button", { name: "Post request" }));

    await waitFor(() => expect(mockCreateServiceRequestAction).toHaveBeenCalledTimes(1));

    const error = await screen.findByText("You already have an open request with this title.");
    expect(error).toBeTruthy();
    expect(screen.getByLabelText("Title", { exact: false })).toHaveAttribute("aria-invalid", "true");
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe("ServiceRequestForm (edit mode)", () => {
  const request = {
    id: "req-1",
    categoryId: "123e4567-e89b-12d3-a456-426614174000",
    title: "Fix leaking kitchen tap",
    description: "The tap under the sink drips constantly.",
    urgency: "MEDIUM",
    budgetMin: null,
    budgetMax: null,
    location: {
      line1: "Calle Mayor 1",
      line2: null,
      city: "Madrid",
      province: null,
      postalCode: "28001",
      country: "ES",
      latitude: null,
      longitude: null,
    },
  };

  it("prefills every field from the existing request", () => {
    render(<ServiceRequestForm mode="edit" categories={categories} request={request} />);
    expect(screen.getByLabelText("Title", { exact: false })).toHaveValue("Fix leaking kitchen tap");
    expect(screen.getByLabelText("Description", { exact: false })).toHaveValue("The tap under the sink drips constantly.");
    expect(screen.getByPlaceholderText("City")).toHaveValue("Madrid");
  });

  it("calls updateServiceRequestAction and shows a success message on save", async () => {
    mockUpdateServiceRequestAction.mockResolvedValue({ success: true });
    render(<ServiceRequestForm mode="edit" categories={categories} request={request} />);

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mockUpdateServiceRequestAction).toHaveBeenCalledWith("req-1", expect.anything()));
    expect(await screen.findByText("Service request updated.")).toBeTruthy();
  });
});
