import { createRequire } from "node:module";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Module 120 — Multilingual Localization: regression guard.
 *
 * Every user-facing string under `src/app` and `src/presentation` must come
 * from the message catalog. The scanner (`scripts/i18n-hardcoded-scan.cjs`)
 * reports JSX text, user-facing JSX attributes and prose-like string/template
 * literals; genuinely non-translatable literals (brand names, header values,
 * crawler-only Spanish content, format tokens) carry an `i18n-ignore`
 * comment with the reason. A new hardcoded string fails this test.
 */
const require = createRequire(import.meta.url);
const { scanFiles } = require(path.resolve(__dirname, "../../../scripts/i18n-hardcoded-scan.cjs")) as {
  scanFiles: (targets: string[]) => Array<{ file: string; line: number; reason: string; text: string }>;
};

describe("no hardcoded user-facing strings", () => {
  it("finds no un-catalogued prose in src/app and src/presentation", () => {
    const root = path.resolve(__dirname, "../../..");
    const findings = scanFiles([path.join(root, "src/app"), path.join(root, "src/presentation")]);
    const report = findings.map((f) => `${path.relative(root, f.file)}:${f.line} [${f.reason}] ${f.text}`);
    expect(report).toEqual([]);
  });
});
