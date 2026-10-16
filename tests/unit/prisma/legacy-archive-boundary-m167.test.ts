import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { LEGACY_ARCHIVE_BLOCKERS, LEGACY_ARCHIVE_CATEGORIES } from "@/domain/services/legacy-archive-spec";

/**
 * Module 167 — static contract. The archive export is READ-ONLY toward the database, writes only through one audited store, is
 * wired to no route / action / webhook / cron, adds no schema / migration / environment variable / feature flag, removes nothing
 * legacy (that is M168 / M169), and leaves the active LEAD_V1 flow and the M166 report untouched.
 */
const root = path.resolve(__dirname, "../../..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const rel = (p: string) => path.relative(root, p).split(path.sep).join("/");
const SRC = walk(path.join(root, "src")).map(rel).filter((f) => /\.(ts|tsx)$/.test(f));
const SCRIPTS = walk(path.join(root, "scripts")).map(rel).filter((f) => /\.(ts|tsx|cjs|mjs)$/.test(f));

const SPEC = "src/core/domain/services/legacy-archive-spec.ts";
const DOMAIN = "src/core/domain/services/legacy-archive.ts";
const PORT = "src/core/domain/repositories/legacy-archive-reader.ts";
const STORE_PORT = "src/core/application/ports/legacy-archive-store.ts";
const READER = "src/core/infrastructure/database/prisma/repositories/prisma-legacy-archive-reader.ts";
const FS_STORE = "src/core/infrastructure/legacy-archive/fs-legacy-archive-store.ts";
const EXPORT_UC = "src/core/application/use-cases/legacy-archive/export-legacy-archive.use-case.ts";
const VERIFY_UC = "src/core/application/use-cases/legacy-archive/verify-legacy-archive.use-case.ts";
const CONFIG = "src/core/application/use-cases/legacy-archive/legacy-archive-run-config.ts";
const COMPOSE_EXPORT = "src/core/application/use-cases/legacy-archive/compose-export.ts";
const COMPOSE_VERIFY = "src/core/application/use-cases/legacy-archive/compose-verify.ts";
const SCRIPT = "scripts/run-legacy-archive-export.ts";
const RESTORE_DOMAIN = "src/core/domain/services/legacy-archive-restore.ts";
const RESTORE_PORT = "src/core/application/ports/legacy-archive-scratch-restorer.ts";
const RESTORER = "src/core/infrastructure/database/prisma/repositories/prisma-legacy-archive-scratch-restorer.ts";
const RESTORE_UC = "src/core/application/use-cases/legacy-archive/restore-legacy-archive-rehearsal.use-case.ts";
const COMPOSE_RESTORE = "src/core/application/use-cases/legacy-archive/compose-restore.ts";
const M167_SRC = [SPEC, DOMAIN, PORT, STORE_PORT, READER, FS_STORE, EXPORT_UC, VERIFY_UC, CONFIG, COMPOSE_EXPORT, COMPOSE_VERIFY, RESTORE_DOMAIN, RESTORE_PORT, RESTORER, RESTORE_UC, COMPOSE_RESTORE];
const DOC = "docs/MODULE_167_LEGACY_ARCHIVE_RETENTION_EXPORT.md";

const mentionsM167 = (f: string) => /legacy-archive|LegacyArchive|legacy_archive|LEGACY_ARCHIVE/.test(code(f));

describe("M167 — read-only boundary", () => {
  it("the whole M167 source surface is exactly these files (+ the operator script)", () => {
    expect(SRC.filter(mentionsM167).sort()).toEqual([...M167_SRC].sort());
    expect(SCRIPTS.filter(mentionsM167)).toEqual([SCRIPT]);
  });

  it("the reader port is query-only: one method, no write verbs", () => {
    const src = code(PORT);
    expect(src.match(/^\s+\w+\(.*\): Promise</gm)).toHaveLength(1);
    expect(src).toMatch(/readSnapshot\(options: LegacyArchiveOptions\): Promise<LegacyArchiveSnapshot>/);
    expect(src).not.toMatch(/\b(create|update|delete|upsert|save|issue|record|resolve|repair|fix|mark|persist|write|settle|refund|pay)\w*\(/i);
  });

  it("the Prisma adapter only reads: findMany/count/aggregate/groupBy, one READ ONLY REPEATABLE READ transaction, no writes, no other raw SQL", () => {
    const src = code(READER);
    expect(src).not.toMatch(/\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\b/);
    expect(src).not.toMatch(/\$queryRaw|\$executeRaw\b|\$executeRawUnsafe\(\s*[^"\s]|TRUNCATE|INSERT|DELETE FROM|UPDATE\s+"/);
    expect(src.match(/\$executeRawUnsafe\(/g)).toHaveLength(1);
    expect(src).toMatch(/\$executeRawUnsafe\("SET TRANSACTION READ ONLY"\)/);
    expect(src).toMatch(/TransactionIsolationLevel\.RepeatableRead/);
    // The delegate type the adapter works through exposes only the four read methods.
    const iface = /interface ReadDelegate \{([\s\S]*?)\n\}/.exec(src)![1]!;
    expect([...iface.matchAll(/^\s+(\w+)\(/gm)].map((m) => m[1])).toEqual(["findMany", "count", "aggregate", "groupBy"]);
    // Every method called on a delegate in the adapter is one of them.
    const calls = [...src.matchAll(/\bdelegate\.(\w+)\(/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThan(5);
    for (const c of calls) expect(["findMany", "count", "aggregate", "groupBy"]).toContain(c);
    expect(src).not.toMatch(/\binclude:/);
  });

  it("the adapter and the spec never mention party data, URLs, IP/user agent or contact data as CORE selections", () => {
    const src = code(READER);
    for (const forbidden of ["issuerLegalName", "recipientTaxId", "fileUrl", "ipAddress", "userAgent", "email", "referralCode", "scopeAnswers"]) expect(src, forbidden).not.toContain(forbidden);
    // Selection comes only from the spec, filtered by tier.
    expect(src).toMatch(/archiveFieldNames\(spec, options\)/);
  });

  it("every category has a reader scope, and every Prisma relation filter is type-checked with `satisfies`", () => {
    const src = code(READER);
    for (const c of LEGACY_ARCHIVE_CATEGORIES) expect(src, c.key).toMatch(new RegExp(`\\b${c.key}:\\s*\\{`));
    const wheres = src.match(/satisfies Prisma\.\w+WhereInput/g) ?? [];
    expect(wheres).toHaveLength(LEGACY_ARCHIVE_CATEGORIES.length);
  });

  it("the use cases hold only a reader / store and a clock — they cannot settle, refund, pay, resolve or issue anything", () => {
    for (const f of [EXPORT_UC, VERIFY_UC]) {
      const src = code(f);
      expect(src, f).not.toMatch(/Repository|Gateway|EventBus|Notification|AuditLog|publishDomainEvent|logger|console\./);
      expect(src, f).not.toMatch(/\b(refund|payout|capture|release|issue|resolve|cancel)\w*\(/i);
      expect(src, f).not.toMatch(/process\.env/);
    }
    expect(code(EXPORT_UC)).toMatch(/private readonly reader: LegacyArchiveReader/);
    expect(code(EXPORT_UC)).toMatch(/private readonly store: LegacyArchiveStore/);
  });

  it("the composition roots are used only by the operator script: no route, Server Action, webhook, cron, queue or scheduler", () => {
    for (const root_ of [COMPOSE_EXPORT, COMPOSE_VERIFY]) {
      const names = root_ === COMPOSE_EXPORT ? "makeExportLegacyArchiveUseCase" : "makeVerifyLegacyArchiveUseCase";
      const users = [...SRC, ...SCRIPTS].filter((f) => f !== root_ && new RegExp(names).test(code(f)));
      expect(users, names).toEqual([SCRIPT]);
    }
    for (const f of SRC.filter((f) => f.startsWith("src/app/"))) expect(mentionsM167(f), f).toBe(false);
    const vercel = JSON.parse(read("vercel.json")) as { crons: { path: string }[] };
    for (const c of vercel.crons) expect(c.path).not.toMatch(/archive|export|legacy/i);
  });

  it("verification does not import the database client or the environment (it must run with neither)", () => {
    const src = [COMPOSE_VERIFY, VERIFY_UC, FS_STORE, DOMAIN, SPEC].map(code).join("\n");
    expect(src).not.toMatch(/prisma|@prisma\/client|infrastructure\/config\/env|process\.env/i);
    // The script loads each composition root lazily, so verify mode never evaluates the Prisma client module.
    expect(code(SCRIPT)).toMatch(/await import\("@\/application\/use-cases\/legacy-archive\/compose-verify"\)/);
    expect(code(SCRIPT)).toMatch(/await import\("@\/application\/use-cases\/legacy-archive\/compose-export"\)/);
    expect(code(SCRIPT)).not.toMatch(/^import .*compose-(export|verify)/m);
  });

  it("only the filesystem store writes files; it creates exclusively, never deletes anything but its own staging directory, and never follows the repo", () => {
    const src = code(FS_STORE);
    expect(src).toMatch(/"wx"/);
    expect(src.match(/\brm\(/g)).toHaveLength(1);
    expect(src).not.toMatch(/\bunlink|rmdir|rmSync|truncate|appendFile|createWriteStream/);
    expect(src).toMatch(/insideGitWorkTree/);
    for (const f of [...SRC, ...SCRIPTS].filter((f) => mentionsM167(f) && f !== FS_STORE)) expect(code(f), f).not.toMatch(/writeFile|appendFile|mkdir|createWriteStream|rmSync|unlink|node:fs/);
  });

  it("the script fails closed (exit 2), prints no record contents, and never claims approval", () => {
    const src = code(SCRIPT);
    expect(src).toMatch(/fail closed/i);
    expect(src).toMatch(/return 2;/);
    expect(src).toMatch(/process\.exit\(code\)/);
    expect(src).toMatch(/NOT an approved retention archive/);
    expect(src).not.toMatch(/approved retention archive\.?["'`]\s*\)?;?\s*$/m); // never printed as a positive claim
    expect(src).not.toMatch(/JSON\.stringify|\.rows|snapshot/);
    expect(src).not.toMatch(/Gate D (passed|approved|complete)/i);
  });
});

describe("M167 — no schema, migration, environment variable, feature flag, cron, or legacy removal", () => {
  it("adds nothing to the Prisma schema or the migrations", () => {
    expect(read("prisma/schema.prisma")).not.toMatch(/legacy_?archive|LegacyArchive/i);
    expect(readdirSync(path.join(root, "prisma/migrations")).filter((m) => /167|legacy[-_]?archive/i.test(m))).toEqual([]);
  });

  it("the scratch restorer writes only inside the schema it creates: no DROP/DELETE/UPDATE/TRUNCATE, no public schema, no application tables, rolled back by default", () => {
    const src = code(RESTORER);
    expect(src).not.toMatch(/\b(DROP|DELETE FROM|UPDATE\s|TRUNCATE|ALTER TABLE\s+"?public)/i);
    expect(src).not.toMatch(/\bpublic\b|\$queryRaw\(|\$executeRaw\(/);
    expect(src.match(/CREATE SCHEMA/g)).toHaveLength(1);
    expect(src).toMatch(/legacy_archive_restore_/);
    expect(src).toMatch(/throw new Rollback/); // the default is to leave nothing behind
    expect(src).not.toMatch(/process\.env/);
    // only the restore composition root and the scripts' dynamic import reach it
    for (const f of [...SRC, ...SCRIPTS]) if (f !== RESTORER && f !== COMPOSE_RESTORE && /scratch-restorer|ScratchRestorer/.test(code(f))) expect([RESTORE_PORT, RESTORE_UC]).toContain(f);
  });

  it("introduces no environment variable, feature flag or second cutover switch", () => {
    for (const f of M167_SRC) expect(code(f), f).not.toMatch(/process\.env|LEAD_V1_ROLLOUT_MODE|FEATURE_FLAG|featureFlag/);
    const script = code(SCRIPT);
    expect(script.match(/process\.env/g)).toHaveLength(1); // DATABASE_URL is read only to cross-check the authorized host
    expect(code(CONFIG)).toMatch(/input\.env\.DATABASE_URL/);
    expect(code(CONFIG).match(/input\.env\.\w+/g)).toEqual(["input.env.DATABASE_URL"]);
  });

  it("registers exactly one npm script and nothing else in package.json", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string>; dependencies: Record<string, string> };
    expect(pkg.scripts["legacy-archive-export"]).toBe("tsx --env-file-if-exists=.env --conditions=react-server scripts/run-legacy-archive-export.ts");
    expect(Object.keys(pkg.scripts).filter((k) => /archive/.test(k))).toEqual(["legacy-archive-export"]);
  });

  it("removes and disables nothing: legacy guards, routes, webhooks and the M166 report are still present", () => {
    for (const f of [
      "src/core/domain/services/legacy-wind-down.ts",
      "src/core/infrastructure/database/prisma/repositories/prisma-legacy-wind-down-reader.ts",
      "scripts/run-legacy-wind-down-report.ts",
      "src/app/api/webhooks/stripe-payments/route.ts",
    ]) expect(existsSync(path.join(root, f)), f).toBe(true);
    expect(existsSync(path.join(root, "src/core/application/use-cases/legacy-wind-down/compose.ts"))).toBe(true);
    const vercel = JSON.parse(read("vercel.json")) as { crons: { path: string }[] };
    expect(vercel.crons.map((c) => c.path)).toEqual(expect.arrayContaining(["/api/cron/reconciliation-run", "/api/cron/expire-workflows"]));
  });

  it("does not touch or even mention the M166 module in source: its pinned source surface stays exactly as M166 left it", () => {
    for (const f of M167_SRC) expect(code(f), f).not.toMatch(/legacy-wind-down|LegacyWindDown/);
    expect(code("src/core/infrastructure/database/prisma/repositories/prisma-legacy-wind-down-reader.ts")).not.toMatch(/legacy-archive|LegacyArchive/);
    expect(code(READER)).toMatch(/provider: LEGACY_WEBHOOK_PROVIDER/);
  });

  it("never reclassifies or filters out LEAD_V1: the only flow value in M167 source is LEGACY_QUOTE_PAYMENT", () => {
    // The spec's prose names LEAD_V1 only to say what is excluded; no code path may select, filter on or mention it.
    for (const f of M167_SRC.filter((f) => f !== SPEC)) expect(code(f), f).not.toMatch(/\bLEAD_V1\b/);
    expect(code(SPEC)).not.toMatch(/flowVersion[^\n]*LEAD_V1|LEAD_V1[^\n]*flowVersion\s*:/);
    const reader = code(READER);
    expect(reader.match(/"LEGACY_QUOTE_PAYMENT"/g)).toHaveLength(1);
    expect(reader).not.toMatch(/flowVersion:\s*"LEAD_V1"/);
  });
});

describe("M167 — documentation matches the implementation", () => {
  it("documents every category, every blocker and the explicit non-goals", () => {
    expect(existsSync(path.join(root, DOC))).toBe(true);
    const doc = read(DOC);
    for (const c of LEGACY_ARCHIVE_CATEGORIES) expect(doc, c.key).toContain(c.key);
    for (const b of LEGACY_ARCHIVE_BLOCKERS) expect(doc, b.id).toContain(`**${b.id}**`);
    expect(doc).toMatch(/M168/);
    expect(doc).toMatch(/M169/);
    expect(doc).toMatch(/Gate D/);
    expect(doc).toMatch(/not (legal|tax)/i);
    expect(doc).not.toMatch(/Gate D (is )?(passed|complete)/i);
  });
});
