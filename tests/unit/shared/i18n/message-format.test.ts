import { describe, expect, it } from "vitest";

import { formatMessage } from "@/shared/i18n/message-format";

describe("interpolation", () => {
  it("substitutes named arguments", () => {
    expect(formatMessage("Hola, {name}", { name: "Ana" }, "es")).toBe("Hola, Ana");
  });

  it("renders a missing value as empty rather than 'undefined'", () => {
    expect(formatMessage("Hola, {name}", {}, "es")).toBe("Hola, ");
  });

  it("returns templates with no arguments untouched", () => {
    expect(formatMessage("Guardar", {}, "es")).toBe("Guardar");
  });
});

describe("number, date and time arguments", () => {
  it("formats numbers per locale", () => {
    expect(formatMessage("{n, number}", { n: 1234.5 }, "en")).toBe("1,234.5");
    expect(formatMessage("{n, number}", { n: 1234.5 }, "de")).toBe("1.234,5");
  });

  it("formats percentages", () => {
    expect(formatMessage("{n, number, percent}", { n: 0.25 }, "en")).toBe("25%");
  });

  it("formats dates and times through Intl", () => {
    const date = new Date(Date.UTC(2026, 0, 15, 12, 0, 0));
    const rendered = formatMessage("{d, date, long}", { d: date }, "en");
    expect(rendered).toContain("2026");
    expect(rendered).toContain("January");

    expect(formatMessage("{d, time, short}", { d: date }, "en")).toMatch(/\d/);
  });

  it("degrades to the raw value when the argument is not a number/date", () => {
    expect(formatMessage("{n, number}", { n: "abc" }, "en")).toBe("abc");
    expect(formatMessage("{d, date}", { d: "not-a-date" }, "en")).toBe("not-a-date");
  });
});

describe("plural", () => {
  const en = "{count, plural, =0 {No jobs} one {# job} other {# jobs}}";

  it("selects the exact =N branch before the category branch", () => {
    expect(formatMessage(en, { count: 0 }, "en")).toBe("No jobs");
  });

  it("selects by CLDR category and substitutes # with the formatted number", () => {
    expect(formatMessage(en, { count: 1 }, "en")).toBe("1 job");
    expect(formatMessage(en, { count: 5 }, "en")).toBe("5 jobs");
    expect(formatMessage(en, { count: 1234 }, "en")).toBe("1,234 jobs");
  });

  it("uses the target language's own plural categories, not English's", () => {
    // Polish distinguishes one/few/many — a two-branch English-shaped
    // message would render "5 zlecenie" here.
    const pl =
      "{count, plural, one {# zlecenie} few {# zlecenia} many {# zleceń} other {# zlecenia}}";
    expect(formatMessage(pl, { count: 1 }, "pl")).toBe("1 zlecenie");
    expect(formatMessage(pl, { count: 3 }, "pl")).toBe("3 zlecenia");
    expect(formatMessage(pl, { count: 5 }, "pl")).toBe("5 zleceń");
  });

  it("falls back to `other` when the category has no branch", () => {
    expect(formatMessage("{n, plural, other {many}}", { n: 1 }, "en")).toBe("many");
  });

  it("falls back to `other` for a non-numeric argument", () => {
    expect(formatMessage("{n, plural, one {one} other {other}}", { n: "x" }, "en")).toBe("other");
  });
});

describe("select", () => {
  it("chooses the matching branch, else other", () => {
    const template =
      "{role, select, customer {Cliente} professional {Profesional} other {Usuario}}";
    expect(formatMessage(template, { role: "customer" }, "es")).toBe("Cliente");
    expect(formatMessage(template, { role: "admin" }, "es")).toBe("Usuario");
  });
});

describe("nesting and robustness", () => {
  it("renders arguments nested inside a plural branch", () => {
    const template = "{count, plural, one {# mensaje de {name}} other {# mensajes de {name}}}";
    expect(formatMessage(template, { count: 2, name: "Ana" }, "es")).toBe("2 mensajes de Ana");
  });

  it("never throws on malformed input", () => {
    expect(() => formatMessage("{unclosed", {}, "en")).not.toThrow();
    expect(formatMessage("{unclosed", {}, "en")).toBe("{unclosed");
    expect(() => formatMessage("{n, wat, x}", { n: 1 }, "en")).not.toThrow();
  });

  it("leaves a bare # alone outside a plural branch", () => {
    expect(formatMessage("Ticket #", {}, "en")).toBe("Ticket #");
  });
});
