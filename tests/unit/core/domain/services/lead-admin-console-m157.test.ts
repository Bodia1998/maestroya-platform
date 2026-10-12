import { describe, expect, it } from "vitest";

import {
  LEAD_ADMIN_CONSOLE_ROLES,
  LEAD_ADMIN_DEFAULT_PAGE_SIZE,
  LEAD_ADMIN_MAX_OFFSET,
  LEAD_ADMIN_MAX_PAGE_SIZE,
  LeadAdminConsoleRejectedError,
  deriveLeadAdminIndicators,
  isLeadAdminRecordOnlySignal,
  isLeadAdminUuid,
  normalizeLeadAdminDate,
  normalizeLeadAdminPage,
  normalizeLeadAdminSearchText,
  normalizeLeadAdminUuid,
  sortLeadAdminTimeline,
  type LeadAdminTimelineEvent,
} from "@/domain/services/lead-admin-console";
import { LEAD_ABUSE_ADMIN_ROLES } from "@/domain/services/lead-abuse-controls";
import { LEAD_FEE_DISPUTE_ALLOWED_ACTOR_ROLES } from "@/domain/services/lead-fee-dispute";
import { LEAD_QUALITY_CLAIM_ALLOWED_ACTOR_ROLES } from "@/domain/services/lead-quality-claim";
import { ROLES } from "@/infrastructure/auth/rbac";

const rejects = (fn: () => unknown, reason: string) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(LeadAdminConsoleRejectedError);
    expect((e as LeadAdminConsoleRejectedError).reason).toBe(reason);
    return;
  }
  throw new Error("expected a rejection");
};

describe("M157 — console roles", () => {
  it("are exactly the roles the M154 / M155 / M156 use cases accept, pinned to the real ROLES (SUPPORT is excluded)", () => {
    expect([...LEAD_ADMIN_CONSOLE_ROLES]).toEqual([ROLES.ADMIN, ROLES.SUPER_ADMIN]);
    expect([...LEAD_ADMIN_CONSOLE_ROLES]).toEqual([...LEAD_QUALITY_CLAIM_ALLOWED_ACTOR_ROLES]);
    expect([...LEAD_ADMIN_CONSOLE_ROLES]).toEqual([...LEAD_FEE_DISPUTE_ALLOWED_ACTOR_ROLES]);
    expect([...LEAD_ADMIN_CONSOLE_ROLES]).toEqual([...LEAD_ABUSE_ADMIN_ROLES]);
    expect(LEAD_ADMIN_CONSOLE_ROLES as readonly string[]).not.toContain(ROLES.SUPPORT);
  });
});

describe("M157 — identifiers and paging are bounded and never silently widened", () => {
  it("accepts a uuid (trimmed, lower-cased) and rejects anything else", () => {
    expect(normalizeLeadAdminUuid(" 00000000-0000-4000-A000-000000000001 ")).toBe("00000000-0000-4000-a000-000000000001");
    for (const bad of ["", "abc", "1; DROP TABLE leads", null, undefined, 5, {}, "00000000-0000-4000-a000-00000000000"]) {
      expect(isLeadAdminUuid(bad)).toBe(false);
      rejects(() => normalizeLeadAdminUuid(bad), "INVALID_INPUT");
    }
  });

  it("defaults the page and rejects out-of-range / non-integer values", () => {
    expect(normalizeLeadAdminPage(undefined)).toEqual({ limit: LEAD_ADMIN_DEFAULT_PAGE_SIZE, offset: 0 });
    expect(normalizeLeadAdminPage({ limit: LEAD_ADMIN_MAX_PAGE_SIZE, offset: LEAD_ADMIN_MAX_OFFSET })).toEqual({ limit: 100, offset: 10_000 });
    for (const input of [
      { limit: 0 }, { limit: 101 }, { limit: -1 }, { limit: 1.5 }, { limit: "20" }, { limit: Number.NaN }, { limit: Infinity },
      { offset: -1 }, { offset: 10_001 }, { offset: 0.5 }, { offset: "0" },
    ]) {
      rejects(() => normalizeLeadAdminPage(input as never), "INVALID_INPUT");
    }
  });

  it("filters: text is bounded and control-character free, dates must be real", () => {
    expect(normalizeLeadAdminSearchText("  Madrid ")).toBe("Madrid");
    expect(normalizeLeadAdminSearchText("")).toBeUndefined();
    expect(normalizeLeadAdminSearchText(undefined)).toBeUndefined();
    rejects(() => normalizeLeadAdminSearchText("x".repeat(101)), "INVALID_INPUT");
    rejects(() => normalizeLeadAdminSearchText("a\u0000b"), "INVALID_INPUT");
    rejects(() => normalizeLeadAdminSearchText(5), "INVALID_INPUT");
    expect(normalizeLeadAdminDate("2026-10-01")?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(normalizeLeadAdminDate(undefined)).toBeUndefined();
    rejects(() => normalizeLeadAdminDate("not a date"), "INVALID_INPUT");
    rejects(() => normalizeLeadAdminDate(12345), "INVALID_INPUT");
  });
});

describe("M157 — timeline ordering is deterministic", () => {
  const at = (s: string) => new Date(s);
  const ev = (over: Partial<LeadAdminTimelineEvent>): LeadAdminTimelineEvent => ({ at: at("2026-10-01T10:00:00Z"), basis: "RECORDED_FACT", subject: "LEAD", code: "X", refId: "1", ...over });

  it("sorts oldest first, then by subject, code and id, whatever the input order", () => {
    const a = ev({ at: at("2026-10-01T10:00:00Z"), subject: "PURCHASE", code: "PURCHASE_CREATED", refId: "p" });
    const b = ev({ at: at("2026-10-01T10:00:00Z"), subject: "LEAD", code: "LEAD_CREATED", refId: "l" });
    const c = ev({ at: at("2026-10-01T09:00:00Z"), subject: "AUDIT", code: "Z", refId: "z" });
    const d = ev({ at: at("2026-10-01T10:00:00Z"), subject: "PURCHASE", code: "PURCHASE_CREATED", refId: "q" });
    const expected = [c, b, a, d];
    expect(sortLeadAdminTimeline([d, a, b, c])).toEqual(expected);
    expect(sortLeadAdminTimeline([c, d, b, a])).toEqual(expected);
  });

  it("does not mutate its input", () => {
    const input = [ev({ at: at("2026-10-02T00:00:00Z") }), ev({ at: at("2026-10-01T00:00:00Z") })];
    const copy = [...input];
    sortLeadAdminTimeline(input);
    expect(input).toEqual(copy);
  });
});

describe("M157 — derived indicators are labelled DERIVED and never decide anything", () => {
  const NOW = new Date("2026-10-12T12:00:00Z");
  const past = new Date("2026-10-10T12:00:00Z");
  const future = new Date("2026-10-14T12:00:00Z");

  it("flags a passed claim response target only for OPEN claims", () => {
    const out = deriveLeadAdminIndicators({
      now: NOW, maxBuyers: 3, purchases: [],
      claims: [
        { id: "c-open", status: "SUBMITTED", respondBy: past },
        { id: "c-review", status: "UNDER_REVIEW", respondBy: past },
        { id: "c-decided", status: "APPROVED", respondBy: past },
        { id: "c-future", status: "SUBMITTED", respondBy: future },
      ],
      disputes: [],
    });
    expect(out.map((i) => i.refId)).toEqual(["c-open", "c-review"]);
    expect(out.every((i) => i.basis === "DERIVED" && i.code === "CLAIM_RESPONSE_TARGET_PASSED")).toBe(true);
  });

  it("flags overdue chargeback evidence, suspended access and a full lead", () => {
    const out = deriveLeadAdminIndicators({
      now: NOW, maxBuyers: 2,
      purchases: [{ id: "p1", status: "DISPUTED" }, { id: "p2", status: "CONFIRMED" }, { id: "p3", status: "REVOKED" }],
      claims: [],
      disputes: [
        { id: "d1", status: "NEEDS_RESPONSE", evidenceDueBy: past, evidenceStatus: "NOT_SUBMITTED" },
        { id: "d2", status: "NEEDS_RESPONSE", evidenceDueBy: past, evidenceStatus: "SUBMITTED" },
        { id: "d3", status: "WON", evidenceDueBy: past, evidenceStatus: "NOT_SUBMITTED" },
        { id: "d4", status: "UNDER_REVIEW", evidenceDueBy: null, evidenceStatus: "NOT_SUBMITTED" },
      ],
    });
    expect(out.map((i) => `${i.code}:${i.refId}`).sort()).toEqual(
      ["ACCESS_SUSPENDED_BY_DISPUTE:p1", "BUYER_CAPACITY_REACHED:lead", "DISPUTE_EVIDENCE_DUE_PASSED:d1"].sort(),
    );
  });

  it("an unconfigured buyer cap (null) is never reported as full", () => {
    const out = deriveLeadAdminIndicators({ now: NOW, maxBuyers: null, purchases: [{ id: "p", status: "CONFIRMED" }], claims: [], disputes: [] });
    expect(out).toEqual([]);
  });
});

describe("M157 — record-only signals", () => {
  it("PURCHASE_REJECTED_PROBING (and its raw event) are reported as record only", () => {
    expect(isLeadAdminRecordOnlySignal("PURCHASE_REJECTED_PROBING")).toBe(true);
    expect(isLeadAdminRecordOnlySignal("PURCHASE_REJECTED_EVENT")).toBe(true);
    expect(isLeadAdminRecordOnlySignal("CONTACT_ACCESS_DENIED_PROBING")).toBe(false);
    expect(isLeadAdminRecordOnlySignal("PUBLICATION_BURST")).toBe(false);
  });
});
