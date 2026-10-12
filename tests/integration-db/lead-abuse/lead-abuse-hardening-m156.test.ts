/**
 * Module 156 hardening against REAL PostgreSQL: (1) the persistence-level cap on stored EVENT signals, (2) object privileges, RLS
 * and view semantics of the M156 tables and the dispute-facts view, (3) record-only PURCHASE_REJECTED_PROBING end to end.
 * Run with `npm run test:integration:db` (guarded disposable test database only).
 *
 * The privilege tests create the Supabase-style roles `anon` / `authenticated` when the cluster does not have them (and drop only
 * what they created), grant them what a Supabase project grants by default, re-apply the hardening migration and then act AS those
 * roles with SET LOCAL ROLE. If role creation is not permitted for the test user, those tests report themselves as skipped.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { EvaluateLeadAbuseUseCase } from "@/application/use-cases/lead-abuse/evaluate-lead-abuse.use-case";
import { LeadAbuseGuardedInitiatePurchase, LeadAbuseRuntime } from "@/application/use-cases/lead-abuse/lead-abuse-guards";
import {
  LEAD_ABUSE_EVENT_CAP_PER_DAY,
  LEAD_ABUSE_EVENT_CAP_PER_HOUR,
  defaultLeadAbuseControlConfig,
  type LeadAbuseControlConfig,
  type LeadAbuseEventSignalType,
  type LeadAbuseMode,
} from "@/domain/services/lead-abuse-controls";
import { LeadNotPurchasableError } from "@/domain/services/lead-purchase";
import { prisma } from "@/infrastructure/database/prisma/client";
import { PrismaLeadAbuseControlRepository, PrismaLeadAbuseFactsReader } from "@/infrastructure/database/prisma/repositories/prisma-lead-abuse-control-repository";

import { setupDbTestLifecycle } from "../../test-utils/db/db-test-lifecycle";
import { createUser } from "../../test-utils/db/seed-helpers";

vi.mock("@/infrastructure/observability/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const HOUR = 3_600_000;
const root = process.cwd();
const migration = (name: string) => readFileSync(path.join(root, "prisma/migrations", name, "migration.sql"), "utf8");
const PERMISSIONS_MIGRATION = "20261024000000_add_module_156_permission_hardening";
const CAP_MIGRATION = "20261025000000_add_module_156_event_signal_cap";

/** Splits a migration into statements, honouring $$ ... $$ bodies and dropping `--` comment lines. */
function statementsOf(sql: string): string[] {
  const text = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  const out: string[] = [];
  let current = "";
  let inDollar = false;
  for (let i = 0; i < text.length; i += 1) {
    if (text.startsWith("$$", i)) {
      inDollar = !inDollar;
      current += "$$";
      i += 1;
      continue;
    }
    if (text[i] === ";" && !inDollar) {
      if (current.trim()) out.push(current.trim());
      current = "";
      continue;
    }
    current += text[i];
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

const sqlError = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (error) {
    return String((error as Error).message);
  }
  return "NO ERROR";
};

describe("Module 156 hardening (real PostgreSQL)", () => {
  setupDbTestLifecycle();
  const control = new PrismaLeadAbuseControlRepository();
  const facts = new PrismaLeadAbuseFactsReader();
  let seq = 0;

  const user = (label: string) => {
    seq += 1;
    return createUser(prisma, { name: `${label} ${seq}`, email: `m156h-${label.toLowerCase()}-${seq}@test.maestroya.invalid` });
  };

  const eventDraft = (subjectUserId: string, type: LeadAbuseEventSignalType = "CONTACT_ACCESS_DENIED_EVENT", over: Record<string, unknown> = {}) => ({
    subjectUserId,
    signalType: type,
    reliability: "HEURISTIC" as const,
    severity: "LOW" as const,
    ruleVersion: "m156.v1",
    dedupeKey: `h:${type}:${subjectUserId}:${randomUUID()}`,
    targetLeadId: randomUUID(),
    observedCount: null,
    threshold: null,
    windowSeconds: null,
    occurredAt: new Date(),
    ...over,
  });
  const storedEvents = (subjectUserId: string, type?: LeadAbuseEventSignalType) =>
    prisma.leadAbuseSignal.count({ where: { subjectUserId, ...(type ? { signalType: type } : { signalType: { in: ["CONTACT_ACCESS_DENIED_EVENT", "PURCHASE_REJECTED_EVENT"] } }) } });

  // -------------------------------------------------------------------------------------------------------- event cap

  describe("persistence-level cap on stored event signals", () => {
    it("the TypeScript constants equal the constants inside the trigger function", () => {
      const sql = migration(CAP_MIGRATION);
      expect(sql).toMatch(new RegExp(`hourly_cap CONSTANT integer := ${LEAD_ABUSE_EVENT_CAP_PER_HOUR};`));
      expect(sql).toMatch(new RegExp(`daily_cap  CONSTANT integer := ${LEAD_ABUSE_EVENT_CAP_PER_DAY};`));
    });

    it("random nonexistent lead ids stop creating rows at the hourly cap, per event type; another subject is unaffected", async () => {
      const u = await user("Prober");
      const other = await user("Other");
      let stored = 0;
      for (let i = 0; i < LEAD_ABUSE_EVENT_CAP_PER_HOUR + 30; i += 1) if (await control.recordSignal(eventDraft(u.id))) stored += 1;
      expect(stored).toBe(LEAD_ABUSE_EVENT_CAP_PER_HOUR);
      expect(await storedEvents(u.id, "CONTACT_ACCESS_DENIED_EVENT")).toBe(LEAD_ABUSE_EVENT_CAP_PER_HOUR);

      // the cap is per event type
      expect(await control.recordSignal(eventDraft(u.id, "PURCHASE_REJECTED_EVENT"))).toBe(true);
      // and per subject
      expect(await control.recordSignal(eventDraft(other.id))).toBe(true);
    });

    it("exactly at the cap, 120 concurrent writers store exactly the remaining capacity (no overshoot)", async () => {
      const u = await user("Racer");
      const already = 20;
      for (let i = 0; i < already; i += 1) await control.recordSignal(eventDraft(u.id));
      const results = await Promise.all(Array.from({ length: 120 }, () => control.recordSignal(eventDraft(u.id))));
      expect(results.filter(Boolean)).toHaveLength(LEAD_ABUSE_EVENT_CAP_PER_HOUR - already);
      expect(await storedEvents(u.id, "CONTACT_ACCESS_DENIED_EVENT")).toBe(LEAD_ABUSE_EVENT_CAP_PER_HOUR);
    });

    it("one slot left and 40 concurrent writers: exactly one wins", async () => {
      const u = await user("LastSlot");
      for (let i = 0; i < LEAD_ABUSE_EVENT_CAP_PER_HOUR - 1; i += 1) await control.recordSignal(eventDraft(u.id));
      const results = await Promise.all(Array.from({ length: 40 }, () => control.recordSignal(eventDraft(u.id))));
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await storedEvents(u.id)).toBe(LEAD_ABUSE_EVENT_CAP_PER_HOUR);
    });

    it("deduplication is preserved: the same dedupe key stores one row concurrently and sequentially, and a duplicate at the cap stores nothing", async () => {
      const u = await user("Dup");
      const same = eventDraft(u.id, "CONTACT_ACCESS_DENIED_EVENT", { dedupeKey: `h:dup:${u.id}` });
      const results = await Promise.all(Array.from({ length: 15 }, () => control.recordSignal({ ...same })));
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await control.recordSignal({ ...same })).toBe(false);
      expect(await storedEvents(u.id)).toBe(1);

      for (let i = 0; i < LEAD_ABUSE_EVENT_CAP_PER_HOUR - 1; i += 1) await control.recordSignal(eventDraft(u.id));
      expect(await storedEvents(u.id)).toBe(LEAD_ABUSE_EVENT_CAP_PER_HOUR);
      expect(await control.recordSignal({ ...same })).toBe(false);
      expect(await storedEvents(u.id)).toBe(LEAD_ABUSE_EVENT_CAP_PER_HOUR);
    });

    it("the cap is skipped silently at SQL level (INSERT 0 0, nothing raised) and uses the daily window as a second ceiling", async () => {
      const u = await user("Daily");
      // rows 2 hours old do not count towards the HOURLY cap but do count towards the DAILY cap
      const twoHoursAgo = new Date(Date.now() - 2 * HOUR);
      for (let i = 0; i < LEAD_ABUSE_EVENT_CAP_PER_DAY; i += 1) {
        // sequential-in-batches keeps the test quick while still going through the trigger one row at a time
        await prisma.$executeRaw`INSERT INTO "lead_abuse_signals" ("id","subjectUserId","signalType","reliability","severity","ruleVersion","dedupeKey","targetLeadId","occurredAt")
          VALUES (${randomUUID()}::uuid, ${u.id}::uuid, 'PURCHASE_REJECTED_EVENT', 'HEURISTIC', 'LOW', 'm156.v1', ${`daily:${u.id}:${i}`}, ${randomUUID()}::uuid, (${twoHoursAgo.toISOString()}::timestamptz AT TIME ZONE 'UTC'))`;
      }
      expect(await storedEvents(u.id, "PURCHASE_REJECTED_EVENT")).toBe(LEAD_ABUSE_EVENT_CAP_PER_DAY);
      const affected = await prisma.$executeRaw`INSERT INTO "lead_abuse_signals" ("id","subjectUserId","signalType","reliability","severity","ruleVersion","dedupeKey","targetLeadId","occurredAt")
          VALUES (${randomUUID()}::uuid, ${u.id}::uuid, 'PURCHASE_REJECTED_EVENT', 'HEURISTIC', 'LOW', 'm156.v1', ${`daily:${u.id}:over`}, ${randomUUID()}::uuid, (${new Date().toISOString()}::timestamptz AT TIME ZONE 'UTC'))`;
      expect(affected).toBe(0);
      expect(await storedEvents(u.id, "PURCHASE_REJECTED_EVENT")).toBe(LEAD_ABUSE_EVENT_CAP_PER_DAY);
    }, 60_000);

    it("rule-hit signals are NOT capped (their dedupe key bounds them) and append-only integrity is untouched", async () => {
      const u = await user("Rules");
      for (let i = 0; i < LEAD_ABUSE_EVENT_CAP_PER_HOUR + 10; i += 1) {
        const stored = await control.recordSignal({
          subjectUserId: u.id,
          signalType: "PUBLICATION_BURST",
          reliability: "HEURISTIC",
          severity: "MEDIUM",
          ruleVersion: "m156.v1",
          dedupeKey: `rule:${u.id}:${i}`,
          targetLeadId: null,
          observedCount: 10,
          threshold: 10,
          windowSeconds: 3600,
          occurredAt: new Date(),
        });
        expect(stored).toBe(true);
      }
      await control.recordSignal(eventDraft(u.id));
      const row = await prisma.leadAbuseSignal.findFirstOrThrow({ where: { subjectUserId: u.id } });
      expect(await sqlError(prisma.leadAbuseSignal.update({ where: { id: row.id }, data: { severity: "HIGH" } }))).toMatch(/append-only/);
      expect(await sqlError(prisma.leadAbuseSignal.delete({ where: { id: row.id } }))).toMatch(/append-only/);
    });

    it("through the real runtime: 300 random nonexistent lead ids store at most the cap, and the probing flag still fires", async () => {
      const u = await user("Amplifier");
      const config: LeadAbuseControlConfig = defaultLeadAbuseControlConfig("FLAG");
      const evaluate = new EvaluateLeadAbuseUseCase(facts, control, config);
      const rt = new LeadAbuseRuntime("FLAG", evaluate, control, null);
      for (let i = 0; i < 300; i += 1) await rt.recordEvent(u.id, randomUUID(), "CONTACT_ACCESS_DENIED_EVENT");
      expect(await storedEvents(u.id)).toBe(LEAD_ABUSE_EVENT_CAP_PER_HOUR);
      await evaluate.execute({ subjectUserId: u.id, trigger: "CONTACT" });
      const decisions = await prisma.leadAbuseDecision.findMany({ where: { subjectUserId: u.id } });
      expect(decisions.map((d) => [d.action, d.ruleKey])).toEqual([["FLAG_FOR_REVIEW", "CONTACT_ACCESS_DENIED_PROBING"]]);
    }, 60_000);
  });

  // -------------------------------------------------------------------------------------------------------- time zone independence

  /**
   * Regression for the macOS failures: the native Prisma engine binds a JS Date in a RAW query as timestamptz, the columns are
   * timestamp(3) holding UTC, and a session whose TimeZone is not UTC (Europe/Madrid on the developer's PostgreSQL) shifted every
   * raw comparison / assignment by the zone offset. `SET LOCAL TIME ZONE` inside a transaction reproduces that on ANY database.
   */
  describe("independent of the PostgreSQL session time zone", () => {
    const ZONES = ["UTC", "Europe/Madrid", "America/Los_Angeles", "Pacific/Auckland"] as const;

    it.each(ZONES)("%s: fact counts see exactly the rows inside the window (no shift in either direction)", async (zone) => {
      const u = await user("Zone");
      const now = Date.now();
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE '${zone}'`);
        const base = { subjectUserId: u.id, signalType: "CONTACT_ACCESS_DENIED_EVENT" as const, reliability: "HEURISTIC" as const, severity: "LOW" as const, ruleVersion: "m156.v1" };
        // written through the model API (UTC), exactly like the guards do
        await tx.leadAbuseSignal.create({ data: { ...base, dedupeKey: `z:${zone}:now:${u.id}`, targetLeadId: randomUUID(), occurredAt: new Date(now - 5 * 60_000) } });
        await tx.leadAbuseSignal.create({ data: { ...base, dedupeKey: `z:${zone}:old:${u.id}`, targetLeadId: randomUUID(), occurredAt: new Date(now - 3 * HOUR) } });
        const reader = new PrismaLeadAbuseFactsReader(tx);
        // 1 h window: only the 5-minute-old row. A +2 h shift would hide it (0); a -2 h shift would also show the 3 h-old row (2).
        expect(await reader.countDistinctEventLeads(u.id, "CONTACT_ACCESS_DENIED_EVENT", new Date(now - HOUR))).toBe(1);
        expect(await reader.countDistinctEventLeads(u.id, "CONTACT_ACCESS_DENIED_EVENT", new Date(now - 4 * HOUR))).toBe(2);
        expect(await reader.countDistinctEventLeads(u.id, "CONTACT_ACCESS_DENIED_EVENT", new Date(now))).toBe(0);
      });
    });

    it.each(ZONES)("%s: the daily ceiling counts 200 rows that are 2 hours old (they are outside the hourly window)", async (zone) => {
      const u = await user("ZoneCap");
      const twoHoursAgoIso = new Date(Date.now() - 2 * HOUR).toISOString();
      await prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE '${zone}'`);
          for (let i = 0; i < LEAD_ABUSE_EVENT_CAP_PER_DAY; i += 1) {
            await tx.$executeRaw`INSERT INTO "lead_abuse_signals" ("id","subjectUserId","signalType","reliability","severity","ruleVersion","dedupeKey","targetLeadId","occurredAt")
              VALUES (${randomUUID()}::uuid, ${u.id}::uuid, 'PURCHASE_REJECTED_EVENT', 'HEURISTIC', 'LOW', 'm156.v1', ${`zcap:${zone}:${u.id}:${i}`}, ${randomUUID()}::uuid, (${twoHoursAgoIso}::timestamptz AT TIME ZONE 'UTC'))`;
          }
        },
        { timeout: 60_000, maxWait: 10_000 },
      );
      expect(await storedEvents(u.id, "PURCHASE_REJECTED_EVENT")).toBe(LEAD_ABUSE_EVENT_CAP_PER_DAY);
    }, 90_000);
  });

  // -------------------------------------------------------------------------------------------------------- record-only rule

  describe("PURCHASE_REJECTED_PROBING is record-only on real rows", () => {
    it.each(["SHADOW", "FLAG", "ENFORCE"] as const)("%s: 40 distinct rejected leads record evidence but create no flag and no block, and purchases are not restricted", async (mode: LeadAbuseMode) => {
      const u = await user("Browser");
      const config = defaultLeadAbuseControlConfig(mode);
      const evaluate = new EvaluateLeadAbuseUseCase(facts, control, config);
      const rt = new LeadAbuseRuntime(mode, evaluate, control, null);
      const refusal = new LeadNotPurchasableError();
      const guard = new LeadAbuseGuardedInitiatePurchase({ execute: async (_u: string, _l: string) => Promise.reject(refusal) }, rt);
      for (let i = 0; i < 40; i += 1) await expect(guard.execute(u.id, randomUUID())).rejects.toBe(refusal);

      expect(await storedEvents(u.id, "PURCHASE_REJECTED_EVENT")).toBe(40);
      expect(await prisma.leadAbuseSignal.count({ where: { subjectUserId: u.id, signalType: "PURCHASE_REJECTED_PROBING" } })).toBe(1);
      expect(await prisma.leadAbuseDecision.count({ where: { subjectUserId: u.id } })).toBe(0);
      expect(await control.findBlockInForce(u.id, "LEAD_PURCHASE_INITIATION", new Date())).toBeNull();
      expect(await control.findBlockInForce(u.id, "LEAD_PUBLICATION", new Date())).toBeNull();
    }, 60_000);
  });

  // -------------------------------------------------------------------------------------------------------- privileges / RLS / view

  describe("privileges, RLS and the SELECT-only invoker view", () => {
    const OBJECTS = ["lead_abuse_signals", "lead_abuse_decisions", "lead_abuse_professional_dispute_facts"] as const;
    const created: string[] = [];
    let rolesReady = false;
    let invokerSupported = false;

    const asRole = async (role: string, statement: string): Promise<string> =>
      sqlError(
        prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL ROLE "${role}"`);
          await tx.$queryRawUnsafe(statement);
        }),
      );

    beforeAll(async () => {
      try {
        for (const role of ["anon", "authenticated"]) {
          const exists = await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM pg_roles WHERE rolname = '${role}'`);
          if (exists[0]!.n === 0) {
            await prisma.$executeRawUnsafe(`CREATE ROLE "${role}" NOLOGIN`);
            created.push(role);
          }
        }
        for (const role of ["m156_view_only", "m156_table_reader"]) {
          await prisma.$executeRawUnsafe(`DROP ROLE IF EXISTS "${role}"`);
          await prisma.$executeRawUnsafe(`CREATE ROLE "${role}" NOLOGIN`);
          created.push(role);
        }
        // What a Supabase project grants by default on every new public object ...
        await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO anon, authenticated, m156_view_only, m156_table_reader`);
        await prisma.$executeRawUnsafe(`GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated`);
        // ... then the hardening migration is (re-)applied. It is idempotent.
        for (const statement of statementsOf(migration(PERMISSIONS_MIGRATION))) await prisma.$executeRawUnsafe(statement);
        rolesReady = true;
      } catch (error) {
        console.warn("M156 privilege tests skipped: could not create test roles:", String((error as Error).message).slice(0, 200));
      }
      const v = await prisma.$queryRaw<{ v: number }[]>`SELECT current_setting('server_version_num')::int AS v`;
      invokerSupported = v[0]!.v >= 150000;
    });

    afterAll(async () => {
      for (const role of created.reverse()) {
        try {
          await prisma.$executeRawUnsafe(`DROP OWNED BY "${role}"`);
          await prisma.$executeRawUnsafe(`DROP ROLE IF EXISTS "${role}"`);
        } catch {
          /* best effort: only roles this test created are touched */
        }
      }
    });

    it("RLS is enabled (not forced) on both tables; no PUBLIC grant exists on any of the three objects", async () => {
      const rows = await prisma.$queryRaw<{ relname: string; relkind: string; rls: boolean; forced: boolean }[]>`
        SELECT c.relname::text AS relname, c.relkind::text AS relkind, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
        FROM pg_class c WHERE c.relname IN ('lead_abuse_signals','lead_abuse_decisions','lead_abuse_professional_dispute_facts') ORDER BY 1`;
      const byName = Object.fromEntries(rows.map((r) => [r.relname, r]));
      expect(byName.lead_abuse_signals).toMatchObject({ relkind: "r", rls: true, forced: false });
      expect(byName.lead_abuse_decisions).toMatchObject({ relkind: "r", rls: true, forced: false });
      expect(byName.lead_abuse_professional_dispute_facts).toMatchObject({ relkind: "v" });
      const publicGrants = await prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_class c, aclexplode(c.relacl) a
        WHERE c.relname IN ('lead_abuse_signals','lead_abuse_decisions','lead_abuse_professional_dispute_facts') AND a.grantee = 0`;
      expect(publicGrants[0]!.n).toBe(0);
    });

    it("the application connection (table owner) keeps full access: Prisma reads and writes the M156 objects normally", async () => {
      const u = await user("Owner");
      expect(await control.recordSignal(eventDraft(u.id))).toBe(true);
      const outcome = await control.applyAutomatedDecision({ subjectUserId: u.id, action: "FLAG_FOR_REVIEW", restrictedAction: null, ruleKey: "PUBLICATION_BURST", ruleVersion: "m156.v1", expiresAt: null, decidedAt: new Date(), observedCount: 10, threshold: 10 });
      expect(outcome.created).toBe(true);
      expect(await prisma.leadAbuseSignal.count({ where: { subjectUserId: u.id } })).toBe(1);
      expect(await facts.countDisputesOpenedByProfessional(u.id, new Date(0))).toBe(0);
    });

    it("anon and authenticated can neither read nor write any of the three objects (after Supabase-style default grants)", async (ctx) => {
      if (!rolesReady) return ctx.skip();
      for (const role of ["anon", "authenticated"]) {
        for (const object of OBJECTS) {
          expect(await asRole(role, `SELECT count(*) FROM "${object}"`), `${role} SELECT ${object}`).toMatch(/permission denied/i);
        }
        for (const table of ["lead_abuse_signals", "lead_abuse_decisions"]) {
          expect(await asRole(role, `DELETE FROM "${table}"`), `${role} DELETE ${table}`).toMatch(/permission denied/i);
          expect(await asRole(role, `UPDATE "${table}" SET "createdAt" = now()`), `${role} UPDATE ${table}`).toMatch(/permission denied/i);
          expect(await asRole(role, `INSERT INTO "${table}" DEFAULT VALUES`), `${role} INSERT ${table}`).toMatch(/permission denied/i);
        }
      }
    });

    it("RLS default-denies even a role that HAS table privileges but is not the owner (no policies exist)", async (ctx) => {
      if (!rolesReady) return ctx.skip();
      const u = await user("RlsSubject");
      await control.recordSignal(eventDraft(u.id));
      await prisma.$executeRawUnsafe(`GRANT SELECT ON "lead_abuse_signals" TO m156_table_reader`);
      const visible = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE "m156_table_reader"`);
        const rows = await tx.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "lead_abuse_signals"`);
        return rows[0]!.n;
      });
      expect(visible).toBe(0);
      expect(await prisma.leadAbuseSignal.count({ where: { subjectUserId: u.id } })).toBe(1); // the owner still sees it
      await prisma.$executeRawUnsafe(`REVOKE SELECT ON "lead_abuse_signals" FROM m156_table_reader`);
    });

    it("the view is SECURITY INVOKER on PostgreSQL >= 15: a role granted only the view cannot read the M155 tables through it", async (ctx) => {
      if (!rolesReady) return ctx.skip();
      const opts = await prisma.$queryRaw<{ o: string[] | null }[]>`SELECT reloptions AS o FROM pg_class WHERE relname = 'lead_abuse_professional_dispute_facts'`;
      await prisma.$executeRawUnsafe(`GRANT SELECT ON "lead_abuse_professional_dispute_facts" TO m156_view_only`);
      const message = await asRole("m156_view_only", `SELECT count(*) FROM "lead_abuse_professional_dispute_facts"`);
      await prisma.$executeRawUnsafe(`REVOKE SELECT ON "lead_abuse_professional_dispute_facts" FROM m156_view_only`);
      if (invokerSupported) {
        expect(opts[0]!.o ?? []).toContain("security_invoker=true");
        expect(message).toMatch(/permission denied/i); // invoker privileges apply to lead_fee_disputes / lead_purchases / professional_profiles
      } else {
        // PostgreSQL < 15 has no security_invoker: the REVOKEs are the control and the option must not have been applied
        expect(opts[0]!.o ?? []).not.toContain("security_invoker=true");
      }
    });

    it("the view is read-only for everyone (owner included) and exposes exactly kind / professionalUserId / occurredAt", async () => {
      expect(await sqlError(prisma.$executeRawUnsafe(`INSERT INTO "lead_abuse_professional_dispute_facts" ("kind","professionalUserId","occurredAt") VALUES ('X', gen_random_uuid(), now())`))).toMatch(/cannot insert|not automatically updatable|view/i);
      expect(await sqlError(prisma.$executeRawUnsafe(`UPDATE "lead_abuse_professional_dispute_facts" SET "kind" = 'X'`))).toMatch(/cannot update|not automatically updatable|view/i);
      expect(await sqlError(prisma.$executeRawUnsafe(`DELETE FROM "lead_abuse_professional_dispute_facts"`))).toMatch(/cannot delete|not automatically updatable|view/i);
      const cols = await prisma.$queryRaw<{ c: string }[]>`SELECT attname::text AS c FROM pg_attribute WHERE attrelid = 'lead_abuse_professional_dispute_facts'::regclass AND attnum > 0 AND NOT attisdropped ORDER BY attnum`;
      expect(cols.map((c) => c.c)).toEqual(["kind", "professionalUserId", "occurredAt"]);
    });

    it("re-applying the hardening migration is idempotent and the M155 tables' privileges are not touched by it", async (ctx) => {
      if (!rolesReady) return ctx.skip();
      const before = await prisma.$queryRaw<{ a: string | null }[]>`SELECT relacl::text AS a FROM pg_class WHERE relname = 'lead_purchases'`;
      for (const statement of statementsOf(migration(PERMISSIONS_MIGRATION))) await prisma.$executeRawUnsafe(statement);
      const after = await prisma.$queryRaw<{ a: string | null }[]>`SELECT relacl::text AS a FROM pg_class WHERE relname = 'lead_purchases'`;
      expect(after[0]!.a).toBe(before[0]!.a);
    });
  });
});
