import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression coverage for the restyled EditProfileForm (module 30.4).
 * Field names / validation / submit wiring are unchanged from before the
 * restyle — this guards that the new shared form components, plus the
 * targeted aria-describedby fixes made alongside this pass for `name`
 * and `phone`, work as intended.
 */
const mockUpdateProfileAction = vi.fn();
vi.mock("@/app/(dashboard)/profile/actions", () => ({
  updateProfileAction: (...args: unknown[]) => mockUpdateProfileAction(...args),
}));

const { EditProfileForm } = await import("../../../src/app/(dashboard)/profile/edit-profile-form");

const profile = {
  name: "Jane Doe",
  phone: "+34600000000",
  timezone: "Europe/Madrid",
  preferredLanguageId: null,
  notificationPreferences: null,
};

const address = {
  line1: "Calle Mayor 1",
  line2: null,
  city: "Madrid",
  province: null,
  postalCode: "28001",
  country: "ES",
};

const languages = [{ id: "lang-1", name: "Spanish", nativeName: "Español" }];

beforeEach(() => {
  mockUpdateProfileAction.mockReset();
});

describe("EditProfileForm", () => {
  it("associates the basics fields with their labels and prefills existing values", () => {
    render(<EditProfileForm profile={profile} address={address} languages={languages} />);
    expect(screen.getByLabelText("Display name")).toHaveValue("Jane Doe");
    expect(screen.getByLabelText(/Phone/)).toHaveValue("+34600000000");
    expect(screen.getByLabelText("Timezone")).toBeTruthy();
    expect(screen.getByLabelText("Preferred language")).toBeTruthy();
  });

  it("renders the three notification checkboxes with visible labels", () => {
    render(<EditProfileForm profile={profile} address={null} languages={languages} />);
    expect(screen.getByRole("checkbox", { name: "Marketing emails" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Service update emails" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "SMS appointment reminders" })).toBeTruthy();
  });

  it("shows a validation error, wired via aria-invalid/aria-describedby, for a too-short name", async () => {
    render(<EditProfileForm profile={profile} address={address} languages={languages} />);

    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "J" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    const error = await screen.findByText("Enter your name.");
    expect(error).toBeTruthy();

    const nameInput = screen.getByLabelText("Display name");
    expect(nameInput).toHaveAttribute("aria-invalid", "true");
    expect(nameInput).toHaveAttribute("aria-describedby", "name-error");
    expect(error.id).toBe("name-error");

    expect(mockUpdateProfileAction).not.toHaveBeenCalled();
  });

  it("submits the updated payload and shows a success message", async () => {
    mockUpdateProfileAction.mockResolvedValue({ success: true });
    render(<EditProfileForm profile={profile} address={address} languages={languages} />);

    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Jane Smith" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mockUpdateProfileAction).toHaveBeenCalledTimes(1));
    const submitted = mockUpdateProfileAction.mock.calls[0]![0];
    expect(submitted).toMatchObject({ name: "Jane Smith" });
    expect(await screen.findByText("Profile updated.")).toBeTruthy();
  });

  it("maps a server-side field error for phone back onto the form", async () => {
    mockUpdateProfileAction.mockResolvedValue({
      success: false,
      error: "Please fix the errors below.",
      fieldErrors: { phone: ["Enter a valid phone number."] },
    });

    render(<EditProfileForm profile={profile} address={address} languages={languages} />);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    const error = await screen.findByText("Enter a valid phone number.");
    const phoneInput = screen.getByLabelText(/Phone/);
    expect(phoneInput).toHaveAttribute("aria-invalid", "true");
    expect(phoneInput.getAttribute("aria-describedby")).toBe(error.id);
  });
});
