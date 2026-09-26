#!/usr/bin/env node
/**
 * Module 120 — Multilingual Localization: translator/developer report.
 *
 *   node scripts/i18n-missing-keys.mjs              # every namespace
 *   node scripts/i18n-missing-keys.mjs professional # one namespace
 *
 * Prints, per locale, the keys present in the default locale (`es`) but
 * missing from that locale, orphan keys, and messages whose ICU argument
 * names differ from Spanish. Exit code 1 when anything is reported.
 * `admin` is only required for es/en (see messages-completeness.test.ts).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "src", "i18n", "messages");
const DEFAULT = "es";
const PARTIAL = { admin: ["es", "en"] };
const only = process.argv[2];

const flatten = (obj, prefix = "", out = new Map()) => {
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.set(p, v);
    else flatten(v, p, out);
  }
  return out;
};
const args = (s) =>
  [...new Set([...s.matchAll(/\{\s*([A-Za-z0-9_]+)\s*[,}]/g)].map((m) => m[1]))].sort().join(",");

const locales = readdirSync(ROOT).filter((d) => !d.includes("."));
const namespaces = readdirSync(join(ROOT, DEFAULT))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.slice(0, -5))
  .filter((ns) => !only || ns === only);

let problems = 0;
for (const ns of namespaces) {
  const base = flatten(JSON.parse(readFileSync(join(ROOT, DEFAULT, `${ns}.json`), "utf8")));
  for (const locale of locales) {
    if (locale === DEFAULT) continue;
    let data = {};
    try {
      data = JSON.parse(readFileSync(join(ROOT, locale, `${ns}.json`), "utf8"));
    } catch (error) {
      console.log(`[${locale}/${ns}] unreadable: ${error.message}`);
      problems++;
      continue;
    }
    const flat = flatten(data);
    const partial = PARTIAL[ns] && !PARTIAL[ns].includes(locale);
    const missing = partial ? [] : [...base.keys()].filter((k) => !flat.has(k));
    const orphans = [...flat.keys()].filter((k) => !base.has(k));
    const argDiff = [...flat].filter(([k, v]) => base.has(k) && args(base.get(k)) !== args(v));
    if (missing.length || orphans.length || argDiff.length) {
      problems += missing.length + orphans.length + argDiff.length;
      console.log(`[${locale}/${ns}] missing=${missing.length} orphans=${orphans.length} argMismatch=${argDiff.length}`);
      for (const k of missing.slice(0, 15)) console.log(`   - missing ${k}`);
      for (const k of orphans.slice(0, 15)) console.log(`   - orphan  ${k}`);
      for (const [k] of argDiff.slice(0, 15)) console.log(`   - args    ${k}`);
    }
  }
}
console.log(problems ? `\n${problems} problem(s).` : "All locales complete.");
process.exit(problems ? 1 : 0);
