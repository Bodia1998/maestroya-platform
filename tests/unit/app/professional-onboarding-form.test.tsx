import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression coverage for the restyled ProfessionalOnboardingForm (module
 * 30.4). Field names / validation / submit wiring are unchanged from
 * before the restyle — this only guards that the new shared form
 * components (FormSection/FormFieldError/etc.) didn't break label
 * association or the accessible-error wiring for the fields that already
 * had it before the restyle.
 */
const mockUpdate = vi.fn();
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "authenticated", update: mockUpdate }),
}));

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockCompleteProfessionalOnboardingAction = vi.fn();
vi.mock("@/app/(dashboard)/dashboard/professional/actions", () => ({
  completeProfessionalOnboardingAction: (...args: unknown[]) =>
    mockCompleteProfessionalOnboardingAction(...args),
}));

const { ProfessionalOnboardingForm } = await import(
  "../../../src/app/(dashboard)/dashboard/professional/onboarding/professional-onboarding-form"
);

const categories = [
  { id: "123e4567-e89b-12d3-a456-426614174000", name: "Plumbing" },
  { id: "223e4567-e89b-12d3-a456-426614174001", name: "Electrical" },
];

beforeEach(() => {
  mockUpdate.mockReset().mockResolvedValue(undefined);
  mockPush.mockReset();
  mockCompleteProfessionalOnboardingAction.mockReset();
});

describe("ProfessionalOnboardingForm", () => {
  it("renders every category as a checkbox with a visible label", () => {
    render(<ProfessionalOnboardingForm categories={categories} />);
    expect(screen.getByRole("checkbox", { name: "Plumbing" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Electrical" })).toBeTruthy();
  });

  it("still associates the phone, service radius, and bio fields with their labels", () => {
    render(<ProfessionalOnboardingForm categories={categories} />);
    expect(screen.getByLabelText("Phone number")).toBeTruthy();
    expect(screen.getByLabelText(/Service radius \(km\)/)).toBeTruthy();
    expect(screen.getByLabelText(/Short professional description/)).toBeTruthy();
  });

  it("renders a RequiredBadge next to required section titles", () => {
    render(<ProfessionalOnboardingForm categories={categories} />);
    // RequiredBadge renders a visible "*" per field group, but is
    // aria-hidden so it doesn't pollute label/heading accessible names.
    const asterisks = screen.getAllByText("*");
    expect(asterisks.length).toBeGreaterThan(0);
  });

  it("shows validation errors, wired via aria-invalid/aria-describedby, when submitting with empty required fields", async () => {
    render(<ProfessionalOnboardingForm categories={categories} />);

    fireEvent.click(screen.getByRole("button", { name: /Finish setting up my professional profile/ }));

    const phoneError = await screen.findByText("Enter a valid phone number.");
    expect(phoneError).toBeTruthy();

    const phoneInput = screen.getByLabelText("Phone number");
    expect(phoneInput).toHaveAttribute("aria-invalid", "true");
    expect(phoneInput).toHaveAttribute("aria-describedby", "contactPhone-error");
    expect(phoneError.id).toBe("contactPhone-error");

    // `bio` is required by professionalOnboardingSchema (min(1)) even
    // though its label carries a RequiredBadge (not Optional) precisely
    // because of that — see the production fix in this same pass.
    const bioError = await screen.findByText("Add a short description.");
    const bioInput = screen.getByLabelText(/Short professional description/);
    expect(bioInput).toHaveAttribute("aria-invalid", "true");
    expect(bioInput).toHaveAttribute("aria-describedby", "bio-error");
    expect(bioError.id).toBe("bio-error");

    // serviceRadiusKm is deliberately NOT asserted as invalid here: an
    // empty number input coerces to 0 via z.coerce.number(), and 0 passes
    // .min(0) — leaving it blank is not actually a validation error.

    expect(mockCompleteProfessionalOnboardingAction).not.toHaveBeenCalled();
  });

  it("marks the bio field as required (matching the schema's min(1) rule), not optional", () => {
    render(<ProfessionalOnboardingForm categories={categories} />);
    const label = screen.getByText("Short professional description").closest("label");
    expect(label?.textContent).toContain("*");
    expect(label?.textContent).not.toContain("Opcional");
  });

  it("submits the expected payload shape and redirects on success", async () => {
    mockCompleteProfessionalOnboardingAction.mockResolvedValue({ success: true });

    render(<ProfessionalOnboardingForm categories={categories} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Plumbing" }));
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "+34600000000" } });
    fireEvent.change(screen.getByPlaceholderText("Street address"), { target: { value: "Carrer Major 12" } });
    fireEvent.change(screen.getByPlaceholderText("City"), { target: { value: "Gandia" } });
    fireEvent.change(screen.getByPlaceholderText("Postal code"), { target: { value: "46700" } });
    fireEvent.change(screen.getByLabelText(/Service radius \(km\)/), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText(/Short professional description/), {
      target: { value: "10 years fixing pipes." },
    });

    fireEvent.click(screen.getByRole("button", { name: /Finish setting up my professional profile/ }));

    await waitFor(() => expect(mockCompleteProfessionalOnboardingAction).toHaveBeenCalledTimes(1));
    const submitted = mockCompleteProfessionalOnboardingAction.mock.calls[0]![0];
    expect(submitted).toMatchObject({
      categoryIds: ["123e4567-e89b-12d3-a456-426614174000"],
      contactPhone: "+34600000000",
      serviceRadiusKm: 20,
      bio: "10 years fixing pipes.",
      address: expect.objectContaining({ line1: "Carrer Major 12", city: "Gandia", postalCode: "46700" }),
    });

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(mockPush).toHaveBeenCalledWith("/dashboard");
  });

  it("surfaces a server error instead of redirecting when the action fails", async () => {
    mockCompleteProfessionalOnboardingAction.mockResolvedValue({
      success: false,
      error: "A professional profile already exists for this account.",
    });

    render(<ProfessionalOnboardingForm categories={categories} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Plumbing" }));
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "+34600000000" } });
    fireEvent.change(screen.getByPlaceholderText("Street address"), { target: { value: "Carrer Major 12" } });
    fireEvent.change(screen.getByPlaceholderText("City"), { target: { value: "Gandia" } });
    fireEvent.change(screen.getByPlaceholderText("Postal code"), { target: { value: "46700" } });
    fireEvent.change(screen.getByLabelText(/Service radius \(km\)/), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText(/Short professional description/), {
      target: { value: "10 years fixing pipes." },
    });

    fireEvent.click(screen.getByRole("button", { name: /Finish setting up my professional profile/ }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("A professional profile already exists for this account.");
    expect(mockPush).not.toHaveBeenCalled();
  });
});
