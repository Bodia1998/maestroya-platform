import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PasswordInput } from "@/components/ui/password-input";

describe("PasswordInput", () => {
  it("renders a password-type input by default", () => {
    render(<PasswordInput aria-label="Password" />);
    const input = screen.getByLabelText("Password");
    expect(input).toHaveAttribute("type", "password");
  });

  it("reveals the value as text when the toggle is clicked", () => {
    render(<PasswordInput aria-label="Password" />);
    const input = screen.getByLabelText("Password");
    const toggle = screen.getByRole("button", { name: "Mostrar contraseña" });

    fireEvent.click(toggle);

    expect(input).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Ocultar contraseña" })).toBeTruthy();
  });

  it("hides the value again on a second toggle click", () => {
    render(<PasswordInput aria-label="Password" />);
    const input = screen.getByLabelText("Password");
    const toggle = screen.getByRole("button", { name: "Mostrar contraseña" });

    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Ocultar contraseña" }));

    expect(input).toHaveAttribute("type", "password");
  });

  it("accepts custom toggle labels", () => {
    render(
      <PasswordInput aria-label="Password" toggleLabel={{ show: "Reveal", hide: "Conceal" }} />,
    );
    expect(screen.getByRole("button", { name: "Reveal" })).toBeTruthy();
  });

  it("lets the user type into the field", () => {
    render(<PasswordInput aria-label="Password" />);
    const input = screen.getByLabelText("Password") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "s3cr3t" } });

    expect(input.value).toBe("s3cr3t");
  });
});
