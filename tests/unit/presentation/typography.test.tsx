import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Heading, Text } from "@/components/ui/typography";

describe("Heading", () => {
  it("renders the level's tag by default", () => {
    render(<Heading level="h3">Section title</Heading>);
    expect(screen.getByRole("heading", { level: 3, name: "Section title" })).toBeTruthy();
  });

  it("lets `as` decouple the rendered tag from the visual size", () => {
    render(
      <Heading level="h1" as="h2">
        Styled like h1, outlined as h2
      </Heading>,
    );
    expect(screen.getByRole("heading", { level: 2 })).toBeTruthy();
  });
});

describe("Text", () => {
  it("renders as a paragraph by default", () => {
    render(<Text>Body copy</Text>);
    const el = screen.getByText("Body copy");
    expect(el.tagName).toBe("P");
  });

  it("supports rendering as span/div/label", () => {
    const { rerender } = render(<Text as="span">Inline</Text>);
    expect(screen.getByText("Inline").tagName).toBe("SPAN");

    rerender(<Text as="label">Label text</Text>);
    expect(screen.getByText("Label text").tagName).toBe("LABEL");
  });
});
