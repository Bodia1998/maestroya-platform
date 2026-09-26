import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { createTranslator } from "use-intl/core";
import { describe, expect, it } from "vitest";

import { registerSchema } from "@/application/dto/auth.dto";
import { createServiceRequestSchema } from "@/application/dto/service-request.dto";
import { getNamespaceMessages } from "@/infrastructure/i18n/message-loader";
import type { Locale } from "@/shared/i18n/locales";
import {
  firstLocalizedIssue,
  isScopedValidationKey,
  isValidationKey,
  toTranslatedFieldErrors,
  type Translator,
} from "@/shared/i18n/validation-messages";

/**
 * Module 120 — Multilingual Localization: DTO validation messages carry
 * keys, never prose (docs/MODULE_120_LOCALIZATION_CONVENTIONS.md §4).
 *
 * Scans every `src/core/application/dto/**` file with the TypeScript
 * compiler API for the literals Zod treats as a message — the message
 * argument of `.min/.max/.length/.regex/.email/.url/.uuid/.int/
 * .positive/.refine/…`, and `message` / `required_error` /
 * `invalid_type_error` properties — and asserts each one is a generic
 * `VALIDATION_KEYS` key or a dotted `dto.*` key that exists in the
 * Spanish (source) `validation` catalog.
 */

const DTO_ROOT = join(process.cwd(), "src", "core", "application", "dto");

const MESSAGE_METHODS = new Set([
  "min", "max", "length", "regex", "email", "url", "uuid", "cuid", "cuid2", "ulid", "datetime", "date",
  "time", "ip", "emoji", "nonempty", "int", "positive", "nonnegative", "negative", "nonpositive",
  "multipleOf", "finite", "safe", "refine", "superRefine", "startsWith", "endsWith", "includes",
  "gt", "gte", "lt", "lte", "step", "size",
]);
const DATA_FIRST_ARG = new Set(["startsWith", "endsWith", "includes", "refine", "superRefine"]);
const MESSAGE_PROPERTIES = new Set(["message", "required_error", "invalid_type_error"]);

interface FoundMessage {
  file: string;
  line: number;
  text: string;
  /** A template literal with substitutions — always prose, never a key. */
  dynamic: boolean;
}

function listTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return listTsFiles(full);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") ? [full] : [];
  });
}

function isMessagePosition(node: ts.Node): boolean {
  const parent = node.parent;
  if (ts.isPropertyAssignment(parent) && parent.initializer === node) {
    return MESSAGE_PROPERTIES.has(parent.name.getText());
  }
  if (ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression)) {
    const method = parent.expression.name.text;
    const index = parent.arguments.indexOf(node as ts.Expression);
    if (!MESSAGE_METHODS.has(method)) return false;
    return !(DATA_FIRST_ARG.has(method) && index === 0);
  }
  return false;
}

function scanDtoMessages(): FoundMessage[] {
  const found: FoundMessage[] = [];
  for (const file of listTsFiles(DTO_ROOT)) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      const isStatic = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
      const isDynamic = ts.isTemplateExpression(node);
      if ((isStatic || isDynamic) && isMessagePosition(node)) {
        found.push({
          file: file.slice(DTO_ROOT.length + 1),
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          text: isStatic ? (node as ts.StringLiteral).text : node.getText(source),
          dynamic: isDynamic,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}

function hasPath(catalog: unknown, key: string): boolean {
  let cursor: unknown = catalog;
  for (const part of key.split(".")) {
    if (typeof cursor !== "object" || cursor === null || !(part in cursor)) return false;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return typeof cursor === "string";
}

function validationTranslator(locale: Locale): Translator {
  return createTranslator({
    locale,
    namespace: "validation",
    messages: { validation: getNamespaceMessages(locale, "validation") },
  }) as unknown as Translator;
}

describe("DTO validation messages are catalog keys (Module 120)", () => {
  const messages = scanDtoMessages();
  const esValidation = getNamespaceMessages("es", "validation");

  it("finds the DTO message arguments (sanity check for the scanner)", () => {
    expect(messages.length).toBeGreaterThan(200);
  });

  it("uses no English prose (or template literals) as a Zod message", () => {
    const prose = messages
      .filter((m) => m.dynamic || !(isValidationKey(m.text) || isScopedValidationKey(m.text)))
      .map((m) => `${m.file}:${m.line} ${m.text}`);
    expect(prose).toEqual([]);
  });

  it("every dotted key exists in es/validation.json", () => {
    const missing = messages
      .filter((m) => !m.dynamic && isScopedValidationKey(m.text) && !hasPath(esValidation, m.text))
      .map((m) => `${m.file}:${m.line} ${m.text}`);
    expect(missing).toEqual([]);
  });

  it("dotted keys are DTO-specific (`dto.*`) and carry no ICU placeholders", () => {
    const dotted = [...new Set(messages.filter((m) => isScopedValidationKey(m.text)).map((m) => m.text))];
    expect(dotted.filter((key) => !key.startsWith("dto."))).toEqual([]);
    for (const locale of ["es", "en", "ru", "nl"] as const) {
      const catalog = getNamespaceMessages(locale, "validation");
      for (const key of dotted) {
        const value = key.split(".").reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], catalog);
        expect(typeof value, `${locale}: ${key}`).toBe("string");
        expect(value as string, `${locale}: ${key}`).not.toMatch(/\{/);
      }
    }
  });
});

describe("DTO failures render in the active locale", () => {
  it("firstLocalizedIssue renders a dto.* key in ru and nl", () => {
    const parsed = registerSchema.safeParse({
      name: "Ana",
      email: "ana@example.com",
      password: "short",
      confirmPassword: "short",
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.message).toBe("dto.password.minLength");
    expect(firstLocalizedIssue(parsed.error, validationTranslator("en"))).toBe(
      "Password must be at least 10 characters.",
    );
    expect(firstLocalizedIssue(parsed.error, validationTranslator("ru"))).toBe(
      "Пароль должен содержать не менее 10 символов.",
    );
    expect(firstLocalizedIssue(parsed.error, validationTranslator("nl"))).toBe(
      "Het wachtwoord moet minstens 10 tekens bevatten.",
    );
  });

  it("toTranslatedFieldErrors renders dto.* and generic keys (with values) in ru and nl", () => {
    const parsed = registerSchema.safeParse({
      name: "",
      email: "not-an-email",
      password: "Valid-Password-123",
      confirmPassword: "Valid-Password-123",
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const ru = toTranslatedFieldErrors(parsed.error, validationTranslator("ru"));
    expect(ru.name).toContain("Введите своё имя.");
    expect(ru.email?.[0]).toBe(getNamespaceMessages("ru", "validation").email);

    const nl = toTranslatedFieldErrors(parsed.error, validationTranslator("nl"));
    expect(nl.name).toContain("Vul je naam in.");
    expect(nl.email?.[0]).toBe(getNamespaceMessages("nl", "validation").email);
  });

  it("generic length keys get their numbers from the issue", () => {
    const parsed = createServiceRequestSchema.safeParse({ title: "x".repeat(1000) });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const en = toTranslatedFieldErrors(parsed.error, validationTranslator("en"));
    expect(en.title?.[0]).toMatch(/^Must be at most \d+ characters\.$/);
    for (const messagesForField of Object.values(en)) {
      for (const message of messagesForField) expect(message).not.toMatch(/^(dto\.|minLength|maxLength)/);
    }
  });
});
