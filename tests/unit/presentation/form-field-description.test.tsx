import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FormFieldDescription, FormFieldError } from "@/components/forms/form-field-description";

describe("FormFieldDescription", () => {
  it("renders the provided text", () => {
    render(<FormFieldDescription>We only use this to contact you.</FormFieldDescription>);
    expect(screen.getByText("We only use this to contact you.")).toBeTruthy();
  });

  it("renders with the given id so it can be referenced by aria-describedby", () => {
    render(<FormFieldDescription id="phone-hint">Include country code.</FormFieldDescription>);
    const node = screen.getByText("Include country code.");
    expect(node.id).toBe("phone-hint");
  });
});

describe("FormFieldError", () => {
  it("renders the provided error message", () => {
    render(<FormFieldError>This field is required.</FormFieldError>);
    expect(screen.getByText("This field is required.")).toBeTruthy();
  });

  it("renders with an alert role so assistive tech announces it", () => {
    render(<FormFieldError>This field is required.</FormFieldError>);
    expect(screen.getByRole("alert").textContent).toBe("This field is required.");
  });

  it("renders with the given id so it can be referenced by aria-describedby", () => {
    render(<FormFieldError id="phone-error">Invalid phone number.</FormFieldError>);
    expect(screen.getByRole("alert").id).toBe("phone-error");
  });

  it("renders nothing when children is falsy, so call sites can pass errors.field?.message directly", () => {
    const { container } = render(<FormFieldError>{undefined}</FormFieldError>);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders nothing for an empty string message", () => {
    const { container } = render(<FormFieldError>{""}</FormFieldError>);
    expect(container).toBeEmptyDOMElement();
  });
});
