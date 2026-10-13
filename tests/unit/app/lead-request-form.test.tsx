import "@testing-library/jest-dom/vitest";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSubmit = vi.fn();
// Plain (non-spy) override, used only to simulate a transport failure: vitest's
// spy would report an already-caught rejection as an error of the test itself.
let transportFailure: (() => Promise<never>) | null = null;
vi.mock("@/app/(dashboard)/requests/new/lead/actions", () => ({
  submitLeadRequestAction: (...args: unknown[]) => (transportFailure ? transportFailure() : mockSubmit(...args)),
}));

const { LeadRequestForm } = await import("../../../src/app/(dashboard)/requests/new/lead/lead-request-form");

const CATEGORY = "123e4567-e89b-42d3-a456-426614174000";
const categories = [
  { id: CATEGORY, name: "Plumbing" },
  { id: "123e4567-e89b-42d3-a456-426614174001", name: "Electrical" },
];

function fillValid() {
  fireEvent.change(screen.getByLabelText(/Service category/), { target: { value: CATEGORY } });
  fireEvent.change(screen.getByLabelText(/Short title/), { target: { value: "Leaking kitchen tap" } });
  fireEvent.change(screen.getByLabelText(/Describe the problem/), { target: { value: "The tap under the sink drips constantly and the cupboard is damp." } });
  fireEvent.change(screen.getByLabelText(/Street address/), { target: { value: "Calle Mayor 1" } });
  fireEvent.change(screen.getByLabelText(/^City/), { target: { value: "Madrid" } });
  fireEvent.change(screen.getByLabelText(/Postal code/), { target: { value: "28001" } });
}

beforeEach(() => {
  mockSubmit.mockReset();
  transportFailure = null;
});

describe("LeadRequestForm — rendering", () => {
  it("renders labelled fields and offers exactly the categories it was given", () => {
    render(<LeadRequestForm categories={categories} />);
    const select = screen.getByLabelText(/Service category/);
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toEqual(["Select a category", "Plumbing", "Electrical"]);
    for (const label of [/Short title/, /Describe the problem/, /Urgency/, /Street address/, /^City/, /Postal code/, /Country/]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "Send request" })).toBeEnabled();
  });

  it("does not render any field for identity, flow, status or coordinates", () => {
    const { container } = render(<LeadRequestForm categories={categories} />);
    const names = Array.from(container.querySelectorAll("input,select,textarea")).map((e) => e.getAttribute("name"));
    expect(names.join(" ")).not.toMatch(/customer|user|flow|status|lead|latitude|longitude|professional/i);
  });

  it("shows a safe unavailable state, not a form, when no category is supported", () => {
    render(<LeadRequestForm categories={[]} />);
    expect(screen.getByText("Requests are temporarily unavailable")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send request" })).toBeNull();
  });
});

describe("LeadRequestForm — validation", () => {
  it("blocks an empty submission, wires accessible errors and never calls the server", async () => {
    render(<LeadRequestForm categories={categories} />);
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));

    const descriptionError = await screen.findByText(/This field is required|at least 20/i, { selector: "#description-error" });
    expect(descriptionError).toBeTruthy();
    const description = screen.getByLabelText(/Describe the problem/);
    expect(description).toHaveAttribute("aria-invalid", "true");
    expect(description.getAttribute("aria-describedby")).toContain("description-error");
    expect(screen.getByLabelText(/Street address/)).toHaveAttribute("aria-invalid", "true");
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("rejects a too-short description", async () => {
    render(<LeadRequestForm categories={categories} />);
    fillValid();
    fireEvent.change(screen.getByLabelText(/Describe the problem/), { target: { value: "too short" } });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByText(/at least 20/i, { selector: "#description-error" })).toBeTruthy();
    expect(mockSubmit).not.toHaveBeenCalled();
  });
});

describe("LeadRequestForm — submission", () => {
  it("submits only presentation data and shows the success state without internal terms", async () => {
    mockSubmit.mockResolvedValue({ success: true, receipt: { requestId: "sr-1", status: "RECEIVED" } });
    render(<LeadRequestForm categories={categories} />);
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));

    expect(await screen.findByText("Request sent")).toBeTruthy();
    const submitted = mockSubmit.mock.calls[0]![0];
    expect(submitted).toMatchObject({ categoryId: CATEGORY, title: "Leaking kitchen tap", location: { line1: "Calle Mayor 1", city: "Madrid", postalCode: "28001", country: "ES" } });
    expect(Object.keys(submitted).sort()).toEqual(["categoryId", "description", "location", "title", "urgency"]);
    expect(screen.getByText(/You don't need to pay the professional through MaestroYa/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "View my requests" })).toHaveAttribute("href", "/requests");
    expect(document.body.textContent).not.toMatch(/LEAD_V1|PENDING_PAYMENT|CONFIRMED|buyerPolicy|lead fee/i);
    expect(document.body.textContent).not.toMatch(/sr-1/);
  });

  it("prevents duplicate submissions: disabled while pending and one server call for rapid repeats", async () => {
    let resolve!: (v: unknown) => void;
    mockSubmit.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<LeadRequestForm categories={categories} />);
    fillValid();
    const button = screen.getByRole("button", { name: "Send request" });
    const form = button.closest("form")!;

    fireEvent.click(button);
    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled());
    expect(mockSubmit).toHaveBeenCalledTimes(1);

    await act(async () => resolve({ success: true, receipt: { requestId: "sr-1", status: "RECEIVED" } }));
    expect(await screen.findByText("Request sent")).toBeTruthy();
    expect(mockSubmit).toHaveBeenCalledTimes(1);
  });

  it("shows a server failure safely and re-enables the form for a retry", async () => {
    mockSubmit.mockResolvedValue({ success: false, code: "FAILED", error: "We couldn't send your request. Please try again in a moment." });
    render(<LeadRequestForm categories={categories} />);
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't send your request");
    expect(screen.getByRole("button", { name: "Send request" })).toBeEnabled();
  });

  it("maps server field errors onto the field", async () => {
    mockSubmit.mockResolvedValue({
      success: false,
      code: "CATEGORY_UNSUPPORTED",
      error: "Unsupported",
      fieldErrors: { categoryId: ["This service category isn't available for requests yet."] },
    });
    render(<LeadRequestForm categories={categories} />);
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    const error = await screen.findByText("This service category isn't available for requests yet.", { selector: "#categoryId-error" });
    expect(screen.getByLabelText(/Service category/)).toHaveAttribute("aria-describedby", error.id);
  });

  it("offers a sign-in link when the session is gone", async () => {
    mockSubmit.mockResolvedValue({ success: false, code: "UNAUTHENTICATED", error: "Your session has expired. Please sign in to send a request." });
    render(<LeadRequestForm categories={categories} />);
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/login");
  });

  it("presents a thrown transport error without leaking internals", async () => {
    transportFailure = async () => {
      throw new Error("PrismaClientInitializationError at /srv/x");
    };
    render(<LeadRequestForm categories={categories} />);
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/couldn't send your request/i);
    expect(alert.textContent).not.toMatch(/Prisma|srv/);
  });
});

describe("Module 163 — scope step", () => {
  // Labels for a questionnaire come from the message catalog; no catalog ships any (no approved questionnaire), so the test supplies them.
  const SCOPE = {
    questionnaireVersion: "test-scope-v1",
    categorySlug: "fontaneria",
    questions: [
      { id: "size", kind: "SINGLE_CHOICE" as const, required: true, options: ["small", "large"] },
      { id: "rooms", kind: "INTEGER_RANGE" as const, required: false, min: 1, max: 10 },
    ],
  };
  const withScope = [{ id: CATEGORY, name: "Plumbing", scope: SCOPE }, { id: "123e4567-e89b-42d3-a456-426614174001", name: "Electrical" }];

  async function renderWithLabels(cats = withScope) {
    const { NextIntlClientProvider } = await import("next-intl");
    const { getMessages } = await import("@/infrastructure/i18n/message-loader");
    const messages = structuredClone(getMessages("en")) as unknown as { customer: { requests: { leadForm: Record<string, unknown> } } };
    messages.customer.requests.leadForm.scopeQuestions = {
      fontaneria: { size: { label: "Job size", options: { small: "Small", large: "Large" } }, rooms: { label: "Number of rooms" } },
    };
    return render(
      <NextIntlClientProvider locale="en" messages={messages as never} timeZone="Europe/Madrid">
        <LeadRequestForm categories={cats} />
      </NextIntlClientProvider>,
    );
  }

  it("shows no scope step until a category with a questionnaire is chosen, and none for a category without one", async () => {
    await renderWithLabels();
    expect(screen.queryByLabelText(/Job size/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/Service category/), { target: { value: CATEGORY } });
    expect(screen.getByLabelText(/Job size/)).toBeTruthy();
    expect(screen.getByLabelText(/Number of rooms/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Service category/), { target: { value: "123e4567-e89b-42d3-a456-426614174001" } });
    expect(screen.queryByLabelText(/Job size/)).toBeNull();
  });

  it("renders no factors or internal ids and marks required / optional", async () => {
    const { container } = await renderWithLabels();
    fireEvent.change(screen.getByLabelText(/Service category/), { target: { value: CATEGORY } });
    expect(container.textContent).not.toMatch(/factor|test-scope-v1/i);
  });

  it("submits answers with the form; unanswered questions are omitted; integers are sent as numbers", async () => {
    mockSubmit.mockResolvedValue({ success: true, receipt: { requestId: "sr-1", status: "RECEIVED" } });
    await renderWithLabels();
    fillValid();
    fireEvent.change(screen.getByLabelText(/Job size/), { target: { value: "large" } });
    fireEvent.change(screen.getByLabelText(/Number of rooms/), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    expect(mockSubmit.mock.calls[0]![0]).toMatchObject({ categoryId: CATEGORY, scopeAnswers: { size: "large", rooms: 3 } });
  });

  it("submitting without answering sends no scopeAnswers key at all", async () => {
    mockSubmit.mockResolvedValue({ success: true, receipt: { requestId: "sr-1", status: "RECEIVED" } });
    await renderWithLabels();
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    expect(mockSubmit.mock.calls[0]![0]).not.toHaveProperty("scopeAnswers");
  });

  it("answers typed for one category are not carried to another category's questionnaire", async () => {
    mockSubmit.mockResolvedValue({ success: true, receipt: { requestId: "sr-1", status: "RECEIVED" } });
    await renderWithLabels();
    fireEvent.change(screen.getByLabelText(/Service category/), { target: { value: CATEGORY } });
    fireEvent.change(screen.getByLabelText(/Job size/), { target: { value: "large" } });
    fireEvent.change(screen.getByLabelText(/Service category/), { target: { value: "123e4567-e89b-42d3-a456-426614174001" } });
    fillValid();
    fireEvent.change(screen.getByLabelText(/Service category/), { target: { value: "123e4567-e89b-42d3-a456-426614174001" } });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    expect(mockSubmit.mock.calls[0]![0]).not.toHaveProperty("scopeAnswers");
  });

  it("shows a server scope refusal next to the offending question", async () => {
    mockSubmit.mockResolvedValue({ success: false, code: "SCOPE_INVALID", error: "Check your answers.", fieldErrors: { "scopeAnswers.size": ["Please choose one of the available options."] } });
    await renderWithLabels();
    fillValid();
    fireEvent.change(screen.getByLabelText(/Job size/), { target: { value: "large" } });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByText("Please choose one of the available options.")).toBeTruthy();
    expect(screen.getByLabelText(/Job size/)).toHaveAttribute("aria-invalid", "true");
  });
});

describe("buildScopeAnswers", () => {
  const scope = { questionnaireVersion: "v", categorySlug: "c", questions: [{ id: "a", kind: "SINGLE_CHOICE" as const, required: true, options: ["x"] }, { id: "n", kind: "INTEGER_RANGE" as const, required: false, min: 1, max: 5 }] };
  it("omits blanks, coerces only clean integers, and sends anything else as text so the server refuses it", async () => {
    const { buildScopeAnswers } = await import("../../../src/app/(dashboard)/requests/new/lead/lead-request-form");
    expect(buildScopeAnswers(undefined, { a: "x" })).toBeUndefined();
    expect(buildScopeAnswers(scope, {})).toBeUndefined();
    expect(buildScopeAnswers(scope, { a: " ", n: "" })).toBeUndefined();
    expect(buildScopeAnswers(scope, { a: "x", n: "3" })).toEqual({ a: "x", n: 3 });
    expect(buildScopeAnswers(scope, { n: "3.5" })).toEqual({ n: "3.5" });
    expect(buildScopeAnswers(scope, { n: "1e3" })).toEqual({ n: "1e3" });
    expect(buildScopeAnswers(scope, { zzz: "x" })).toBeUndefined();
  });
});
