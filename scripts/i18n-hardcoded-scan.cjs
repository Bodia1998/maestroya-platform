#!/usr/bin/env node
/**
 * Module 120 — Multilingual Localization: hardcoded user-facing string scanner.
 *
 *   node scripts/i18n-hardcoded-scan.cjs [file-or-dir ...]   (default: src/app src/presentation)
 *
 * Uses the TypeScript compiler to find text a user would read that does
 * not come from the message catalog: JSX text, user-facing JSX attributes
 * (placeholder, aria-label, title, alt, label, …) and prose-looking string
 * or template literals. It is a heuristic, deliberately biased towards
 * reporting: a genuine non-translatable string (a brand name, a format
 * token) is silenced with an `i18n-ignore` comment on the same line or
 * the line above — which also documents *why* it is exempt.
 *
 * Also exported as `scanFiles()` for tests/unit/i18n/no-hardcoded-strings.test.ts.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- plain CommonJS CLI script, run with `node` */
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const USER_FACING_ATTRS = new Set([
  "placeholder", "title", "aria-label", "aria-description", "alt", "label", "description",
  "emptyMessage", "emptyTitle", "emptyDescription", "confirmLabel", "cancelLabel", "heading",
  "subtitle", "message", "text", "helperText", "hint", "tooltip", "submitLabel", "pendingLabel",
  "successMessage", "errorMessage", "actionLabel", "loadingLabel", "caption", "srLabel",
]);
const NON_TRANSLATABLE = new Set(["MaestroYa", "Stripe", "Stripe Connect", "Google", "Persona", "Resend", "WhatsApp", "OK", "IVA", "IRPF", "NIF", "CIF", "NIE", "IBAN", "EUR", "€"]);
const CALLEE_IGNORE = /^(console\.\w+|t|t\.rich|t\.markup|t\.raw|t\.has|getTranslations|useTranslations|redirect|permanentRedirect|revalidatePath|revalidateTag|notFound|cn|clsx|twMerge|new URL|URL|fetch|require|import|z\.\w+|JSON\.parse|searchParams\.\w+|\w+\.searchParams\.\w+|headers|cookies|logger\.\w+|log\w*|Sentry\.\w+|captureException|track\w*|setHeader|\w+\.set|\w+\.get|\w+\.has|\w+\.startsWith|\w+\.endsWith|\w+\.includes|\w+\.split|\w+\.replace|\w+\.join|\w+\.test|\w+\.match|RegExp|Symbol|Error|TypeError|RangeError|\w+Error)$/;

function isProse(text) {
  const s = text.trim();
  if (s.length < 2) return false;
  if (!/\p{L}{2,}/u.test(s)) return false;
  if (NON_TRANSLATABLE.has(s)) return false;
  if (/^[a-z0-9_\-/.:#@[\]?=&%]+$/.test(s)) return false; // identifiers, paths, keys
  if (/^[A-Z0-9_]+$/.test(s)) return false; // ENUM_VALUES
  if (/^(https?:|mailto:|tel:|\/)/.test(s)) return false;
  if (looksLikeClassList(s)) return false; // tailwind classes
  return true;
}

const CLASS_TOKEN = /^(!?-?[a-z0-9]+(?:[:/][a-z0-9-]+)*(?:-[a-z0-9./[\]%#]+)*|\[[^\]]*\])$/;
const CLASS_HINT = /(^|\s)(flex|grid|text-|bg-|p[xytblr]?-|m[xytblr]?-|w-|h-|rounded|border|items-|justify-|gap-|font-|hidden|block|inline|sr-only|container|space-|shadow|max-w-|min-w-)/;
function looksLikeClassList(s) {
  if (!CLASS_HINT.test(s)) return false;
  return s.split(/\s+/).every((token) => CLASS_TOKEN.test(token) || token.includes(":"));
}

function looksLikeSentence(text) {
  const s = text.trim();
  if (!isProse(s)) return false;
  // At least two words, or a single capitalised word that isn't an identifier.
  if (/\s/.test(s)) return /\p{L}{2,}/u.test(s.split(/\s+/)[0] ?? "") || /^[¿¡"'(]/.test(s);
  return /^\p{Lu}\p{Ll}{2,}[.!?:…]?$/u.test(s);
}

function lineHasIgnore(sf, node) {
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  const lines = sf.text.split("\n");
  return /i18n-ignore/.test(lines[line] ?? "") || /i18n-ignore/.test(lines[line - 1] ?? "");
}

function insideIgnoredCall(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isCallExpression(p) || ts.isNewExpression(p)) {
      const name = p.expression ? p.expression.getText().replace(/\s+/g, "") : "";
      if (CALLEE_IGNORE.test(name) || /^new /.test(name)) return true;
      if (ts.isNewExpression(p) && /Error$/.test(name)) return true;
      return false;
    }
    if (ts.isJsxAttribute(p) || ts.isJsxExpression(p) || ts.isBlock(p) || ts.isSourceFile(p)) return false;
  }
  return false;
}

function isNonUserFacingContext(node) {
  const p = node.parent;
  if (!p) return true;
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p)) return true;
  if (ts.isLiteralTypeNode(p)) return true;
  if (ts.isExpressionStatement(p)) return true; // "use client" / "use server"
  if (ts.isPropertyAssignment(p) && p.name === node) return true;
  if (ts.isCaseClause(p)) return true;
  if (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(p.operatorToken.kind)) return true;
  if (ts.isElementAccessExpression(p)) return true;
  if (ts.isPropertyAssignment(p)) {
    const key = p.name.getText().replace(/["']/g, "");
    if (/^(className|href|src|id|key|name|type|variant|size|method|role|as|value|pathname|slug|icon|color|status|kind|code|locale|currency|timeZone|dateStyle|timeStyle|style|mode|resourceType|actionUrl|path|url|permission|queryKey|event|channel|format|unit|sameSite)$/i.test(key)) return true;
  }
  if (ts.isJsxAttribute(p)) {
    const n = p.name.getText();
    return !USER_FACING_ATTRS.has(n);
  }
  return false;
}

function scanSource(file, text) {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const findings = [];
  const report = (node, value, reason) => {
    if (lineHasIgnore(sf, node)) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    findings.push({ file, line: line + 1, reason, text: value.replace(/\s+/g, " ").trim().slice(0, 140) });
  };
  (function visit(node) {
    if (ts.isJsxText(node)) {
      const value = node.getText();
      if (isProse(value)) report(node, value, "jsx-text");
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const value = node.text;
      if (ts.isJsxAttribute(node.parent)) {
        if (USER_FACING_ATTRS.has(node.parent.name.getText()) && isProse(value)) report(node, value, `attr:${node.parent.name.getText()}`);
      } else if (!isNonUserFacingContext(node) && !insideIgnoredCall(node) && looksLikeSentence(value)) {
        report(node, value, "string");
      }
    } else if (ts.isTemplateExpression(node)) {
      const literalText = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(" ");
      if (!isNonUserFacingContext(node) && !insideIgnoredCall(node) && /\p{L}{3,}\s+\p{L}{2,}/u.test(literalText) && isProse(literalText)) {
        report(node, node.getText(), "template");
      }
    }
    ts.forEachChild(node, visit);
  })(sf);
  return findings;
}

function listFiles(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return /\.(tsx?|mts)$/.test(target) && !/\.d\.ts$/.test(target) ? [target] : [];
  return fs.readdirSync(target).flatMap((entry) => listFiles(path.join(target, entry)));
}

function scanFiles(targets) {
  return targets.flatMap(listFiles).flatMap((file) => scanSource(file, fs.readFileSync(file, "utf8")));
}

module.exports = { scanFiles, scanSource };

if (require.main === module) {
  const targets = process.argv.slice(2);
  const findings = scanFiles(targets.length ? targets : ["src/app", "src/presentation"]);
  for (const f of findings) console.log(`${f.file}:${f.line}  [${f.reason}]  ${f.text}`);
  const files = new Set(findings.map((f) => f.file));
  console.log(`\n${findings.length} candidate string(s) in ${files.size} file(s).`);
  process.exit(findings.length ? 1 : 0);
}
