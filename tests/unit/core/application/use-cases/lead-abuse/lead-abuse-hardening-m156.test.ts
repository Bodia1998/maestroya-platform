import { describe, expect, it, vi } from "vitest";

import { EvaluateLeadAbuseUseCase } from "@/application/use-cases/lead-abuse/evaluate-lead-abuse.use-case";
import {
  LEAD_ABUSE_ENFORCEMENT_RETRY_AFTER_MS,
  LeadAbuseGuardedInitiatePurchase,
  LeadAbuseGuardedPublishLead,
  LeadAbuseObservedGetLeadContact,
  LeadAbuseRuntime,
} from "@/application/use-cases/lead-abuse/lead-abuse-guards";
import { AccountRestrictedError, RateLimitedError } from "@/domain/errors/domain-error";
import { LeadContactAccessDeniedError } from "@/domain/services/lead-contact-access-policy";
import { LeadNotPurchasableError } from "@/domain/services/lead-purchase";
import {
  LEAD_ABUSE_EVENT_CAP_PER_HOUR,
  LEAD_ABUSE_RULES,
  LEAD_ABUSE_RULE_KEYS,
  defaultLeadAbuseControlConfig,
  evaluateLeadAbuseRule,
  leadAbuseThresholdEnvName,
  parseLeadAbuseControlConfig,
  planLeadAbuseEffect,
  type LeadAbuseMode,
} from "@/domain/services/lead-abuse-controls";

import { FakeLeadAbuseControlRepository, FakeLeadAbuseFactsReader } from "../../../../../test-utils/fake-lead-abuse-control-repository";

vi.mock("@/infrastructure/observability/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const uuid = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
const USER = uuid(1);
const ADMIN = uuid(3);
const LEAD = uuid(10);
const NOW = new Date("2026-10-12T10:00:00.000Z");
const HOUR = 3_600_000;

type Store = ConstructorParameters<typeof LeadAbuseRuntime>[2];

/** A control store whose block lookup follows a script of outcomes ("fail" throws an infrastructure error, a value is returned). */
function scriptedStore(script: Array<"fail" | "none" | "block">): { store: Store; lookups: () => number; signals: ReturnType<typeof vi.fn> } {
  let calls = 0;
  const signals = vi.fn(async () => true);
  const store = {
    findBlockInForce: vi.fn(async () => {
      const step = script[Math.min(calls, script.length - 1)];
      calls += 1;
      if (step === "fail") throw new Error("connect ECONNREFUSED db.internal.example:5432 password=secret");
      return step === "block" ? ({ id: "d1" } as never) : null;
    }),
    recordSignal: signals,
  } as unknown as Store;
  return { store, lookups: () => calls, signals };
}

function make(mode: LeadAbuseMode, store: Store, antiAbuse: ConstructorParameters<typeof LeadAbuseRuntime>[3] = null) {
  const sleep = vi.fn(async (_ms: number) => undefined);
  const evaluate = { execute: vi.fn(async () => null) };
  const rt = new LeadAbuseRuntime(mode, evaluate, store, antiAbuse, () => NOW, sleep, 40);
  return { rt, sleep, evaluate };
}

const okInner = () => ({ execute: vi.fn(async (_u: string, _l: string) => "ok") });
const limiter = (steps: Array<"fail" | "ok" | "limited">) => {
  let i = 0;
  const limitedError = new RateLimitedError(undefined, 1234);
  const enforceRateLimit = vi.fn(async () => {
    const step = steps[Math.min(i, steps.length - 1)];
    i += 1;
    if (step === "fail") throw new Error("redis: connection reset by peer 10.0.0.7:6379");
    if (step === "limited") throw limitedError;
  });
  return { enforceRateLimit, limitedError };
};

describe("M156 hardening — ENFORCE never fails open (bounded retry, generic retryable refusal)", () => {
  it("block lookup: recovers on the second attempt after ONE transient failure and runs the action", async () => {
    const s = scriptedStore(["fail", "none"]);
    const { rt, sleep } = make("ENFORCE", s.store);
    const inner = okInner();
    await expect(new LeadAbuseGuardedPublishLead(inner, rt).execute(USER, LEAD)).resolves.toBe("ok");
    expect(s.lookups()).toBe(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(40);
    expect(inner.execute).toHaveBeenCalledTimes(1);
  });

  it("block lookup: a persistent failure is retried exactly once, then the action is REFUSED with the generic retryable error", async () => {
    const s = scriptedStore(["fail"]);
    const { rt } = make("ENFORCE", s.store);
    const inner = okInner();
    const error = await new LeadAbuseGuardedPublishLead(inner, rt).execute(USER, LEAD).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).code).toBe("RATE_LIMITED");
    expect((error as RateLimitedError).retryAfterMs).toBe(LEAD_ABUSE_ENFORCEMENT_RETRY_AFTER_MS);
    expect(error).not.toBeInstanceOf(AccountRestrictedError);
    expect(s.lookups()).toBe(2); // bounded: never more than two attempts
    expect(inner.execute).not.toHaveBeenCalled();
  });

  it("the refusal exposes no infrastructure detail (message, code, own properties)", async () => {
    const s = scriptedStore(["fail"]);
    const { rt } = make("ENFORCE", s.store);
    const error = (await new LeadAbuseGuardedPublishLead(okInner(), rt).execute(USER, LEAD).catch((e: unknown) => e)) as RateLimitedError;
    const dump = JSON.stringify({ message: error.message, code: error.code, props: Object.getOwnPropertyNames(error).map((k) => String((error as never)[k])) });
    expect(dump).not.toMatch(/ECONNREFUSED|db\.internal|password|secret|5432|redis|10\.0\.0\.7/i);
    expect(error.cause).toBeUndefined();
  });

  it("an ESTABLISHED block is never bypassed: failure then block -> restricted; block at once -> restricted without any retry", async () => {
    const afterFailure = scriptedStore(["fail", "block"]);
    const inner = okInner();
    await expect(new LeadAbuseGuardedPublishLead(inner, make("ENFORCE", afterFailure.store).rt).execute(USER, LEAD)).rejects.toBeInstanceOf(AccountRestrictedError);
    expect(afterFailure.lookups()).toBe(2);

    const immediate = scriptedStore(["block"]);
    const { rt, sleep } = make("ENFORCE", immediate.store);
    await expect(new LeadAbuseGuardedPublishLead(inner, rt).execute(USER, LEAD)).rejects.toBeInstanceOf(AccountRestrictedError);
    expect(immediate.lookups()).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(inner.execute).not.toHaveBeenCalled();
  });

  it("with the real in-memory repository: an established block plus one transient lookup failure still refuses the purchase", async () => {
    const control = new FakeLeadAbuseControlRepository();
    await control.imposeAdminBlock({ subjectUserId: USER, restrictedAction: "LEAD_PURCHASE_INITIATION", actorUserId: ADMIN, explanation: "x", decidedAt: NOW, expiresAt: new Date(NOW.getTime() + HOUR) });
    control.failNext = "findBlock";
    const facts = new FakeLeadAbuseFactsReader();
    const evaluate = new EvaluateLeadAbuseUseCase(facts, control, defaultLeadAbuseControlConfig("ENFORCE"), () => NOW);
    const rt = new LeadAbuseRuntime("ENFORCE", evaluate, control, null, () => NOW, async () => undefined);
    const inner = okInner();
    await expect(new LeadAbuseGuardedInitiatePurchase(inner, rt).execute(USER, LEAD)).rejects.toBeInstanceOf(AccountRestrictedError);
    expect(inner.execute).not.toHaveBeenCalled();
  });

  it("rate limiter: recovers on the second attempt; a persistent failure is refused after exactly two attempts", async () => {
    const recovering = limiter(["fail", "ok"]);
    const s1 = scriptedStore(["none"]);
    const inner = okInner();
    await expect(new LeadAbuseGuardedPublishLead(inner, make("ENFORCE", s1.store, recovering).rt).execute(USER, LEAD)).resolves.toBe("ok");
    expect(recovering.enforceRateLimit).toHaveBeenCalledTimes(2);

    const broken = limiter(["fail"]);
    const s2 = scriptedStore(["none"]);
    const error = await new LeadAbuseGuardedPublishLead(inner, make("ENFORCE", s2.store, broken).rt).execute(USER, LEAD).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterMs).toBe(LEAD_ABUSE_ENFORCEMENT_RETRY_AFTER_MS);
    expect(broken.enforceRateLimit).toHaveBeenCalledTimes(2);
    expect(inner.execute).toHaveBeenCalledTimes(1); // only the recovering run reached the use case
  });

  it("ordinary business outcomes are NOT retried or converted: the limiter's own RateLimitedError and AccountRestrictedError pass through once", async () => {
    const limited = limiter(["limited"]);
    const s = scriptedStore(["none"]);
    const { rt, sleep } = make("ENFORCE", s.store, limited);
    const error = await new LeadAbuseGuardedPublishLead(okInner(), rt).execute(USER, LEAD).catch((e: unknown) => e);
    expect(error).toBe(limited.limitedError); // the very same object, with the limiter's own retry-after
    expect((error as RateLimitedError).retryAfterMs).toBe(1234);
    expect(limited.enforceRateLimit).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("business errors of the wrapped use case are rethrown unchanged and never turned into the infrastructure refusal", async () => {
    const s = scriptedStore(["none"]);
    const refusal = new LeadNotPurchasableError();
    const guard = new LeadAbuseGuardedInitiatePurchase({ execute: async () => Promise.reject(refusal) }, make("ENFORCE", s.store).rt);
    await expect(guard.execute(USER, LEAD)).rejects.toBe(refusal);
    const boom = new Error("boom");
    await expect(new LeadAbuseGuardedPublishLead({ execute: async () => Promise.reject(boom) }, make("ENFORCE", scriptedStore(["none"]).store).rt).execute(USER, LEAD)).rejects.toBe(boom);
  });

  it("a failing or hanging-then-rejecting sleep cannot break the retry", async () => {
    const s = scriptedStore(["fail", "none"]);
    const evaluate = { execute: vi.fn(async () => null) };
    const rt = new LeadAbuseRuntime("ENFORCE", evaluate, s.store, null, () => NOW, async () => Promise.reject(new Error("timer")), 10);
    await expect(new LeadAbuseGuardedPublishLead(okInner(), rt).execute(USER, LEAD)).resolves.toBe("ok");
  });

  it("purchase initiation is refused the same way when enforcement cannot be evaluated", async () => {
    const s = scriptedStore(["fail"]);
    const inner = okInner();
    await expect(new LeadAbuseGuardedInitiatePurchase(inner, make("ENFORCE", s.store).rt).execute(USER, LEAD)).rejects.toBeInstanceOf(RateLimitedError);
    expect(inner.execute).not.toHaveBeenCalled();
  });

  it.each(["SHADOW", "FLAG"] as const)("%s: the risk layer never blocks or refuses, even when every dependency is down; the store is not even consulted", async (mode) => {
    const s = scriptedStore(["fail"]);
    const broken = limiter(["fail"]);
    const { rt, sleep } = make(mode, s.store, broken);
    const publish = okInner();
    const purchase = okInner();
    await expect(new LeadAbuseGuardedPublishLead(publish, rt).execute(USER, LEAD)).resolves.toBe("ok");
    await expect(new LeadAbuseGuardedInitiatePurchase(purchase, rt).execute(USER, LEAD)).resolves.toBe("ok");
    expect(s.lookups()).toBe(0);
    expect(broken.enforceRateLimit).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("OFF-equivalent runtime: preflight is a no-op", async () => {
    const s = scriptedStore(["fail"]);
    const { rt } = make("OFF", s.store, limiter(["fail"]));
    await expect(rt.preflight(USER, "LEAD_PUBLICATION", "LEAD_PUBLISH_BY_USER")).resolves.toBeUndefined();
    expect(s.lookups()).toBe(0);
  });

  it("recording and evaluation stay best-effort in every mode: a failing store after the action never fails the action", async () => {
    for (const mode of ["SHADOW", "FLAG", "ENFORCE"] as const) {
      const s = scriptedStore(["none"]);
      (s.signals as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("down"));
      const evaluate = { execute: vi.fn(async () => Promise.reject(new Error("down"))) };
      const rt = new LeadAbuseRuntime(mode, evaluate, s.store, null, () => NOW, async () => undefined);
      const refusal = new LeadNotPurchasableError();
      await expect(new LeadAbuseGuardedPublishLead(okInner(), rt).execute(USER, LEAD)).resolves.toBe("ok");
      await expect(new LeadAbuseGuardedInitiatePurchase({ execute: async () => Promise.reject(refusal) }, rt).execute(USER, LEAD)).rejects.toBe(refusal);
    }
  });
});

describe("M156 hardening — contact-denial guarantee under risk-layer failure", () => {
  it.each(["SHADOW", "FLAG", "ENFORCE"] as const)("%s: a failing store/evaluation never replaces the original denial and the observer never calls preflight", async (mode) => {
    const s = scriptedStore(["fail"]);
    (s.signals as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("down"));
    const evaluate = { execute: vi.fn(async () => Promise.reject(new Error("down"))) };
    const rt = new LeadAbuseRuntime(mode, evaluate, s.store, limiter(["fail"]), () => NOW, async () => undefined);
    const preflight = vi.spyOn(rt, "preflight");
    const denial = new LeadContactAccessDeniedError();
    const guard = new LeadAbuseObservedGetLeadContact({ execute: async () => Promise.reject(denial) }, rt);
    await expect(guard.execute(USER, LEAD)).rejects.toBe(denial); // the very same object
    expect(preflight).not.toHaveBeenCalled();
    expect(s.lookups()).toBe(0); // no block lookup on the contact path: a risk state can neither grant nor deny
  });

  it("a successful contact read is returned untouched whatever the risk layer's state", async () => {
    const s = scriptedStore(["block"]);
    const record = { leadId: LEAD, contact: "granted-by-M139" };
    const { rt } = make("ENFORCE", s.store);
    await expect(new LeadAbuseObservedGetLeadContact({ execute: async () => record }, rt).execute(USER, LEAD)).resolves.toBe(record);
  });
});

describe("M156 hardening — PURCHASE_REJECTED_PROBING is record-only and can never block or flag", () => {
  it("the rule table marks exactly this rule record-only and no probing rule can block", () => {
    expect(LEAD_ABUSE_RULE_KEYS.filter((k) => !LEAD_ABUSE_RULES[k].flagsForReview)).toEqual(["PURCHASE_REJECTED_PROBING"]);
    expect(LEAD_ABUSE_RULES.PURCHASE_REJECTED_PROBING.blockedAction).toBeNull();
    expect(LEAD_ABUSE_RULES.PURCHASE_REJECTED_PROBING.defaults.blockAt).toBeNull();
    expect(LEAD_ABUSE_RULES.PURCHASE_REJECTED_PROBING.blockDurationMs).toBe(0);
    expect(LEAD_ABUSE_RULES.PURCHASE_REJECTED_PROBING.severity).toBe("LOW");
  });

  it("for any observed count the recommendation is RECORD (or no hit) and never FLAG_FOR_REVIEW / TEMPORARY_BLOCK", () => {
    for (const observed of [0, 1, 9, 10, 11, 49, 50, 51, 1_000, 1_000_000, Number.MAX_SAFE_INTEGER]) {
      const hit = evaluateLeadAbuseRule("PURCHASE_REJECTED_PROBING", observed, defaultLeadAbuseControlConfig("ENFORCE"));
      if (hit) {
        expect(hit.recommendation).toBe("RECORD");
        expect(hit.blockedAction).toBeNull();
        expect(hit.blockDurationMs).toBe(0);
      }
    }
    expect(evaluateLeadAbuseRule("PURCHASE_REJECTED_PROBING", 10, defaultLeadAbuseControlConfig("ENFORCE"))?.recommendation).toBe("RECORD");
    expect(evaluateLeadAbuseRule("PURCHASE_REJECTED_PROBING", 9, defaultLeadAbuseControlConfig("ENFORCE"))).toBeNull();
  });

  it("no mode turns a RECORD recommendation into a flag or block", () => {
    for (const mode of ["OFF", "SHADOW", "FLAG", "ENFORCE"] as const) {
      expect(["NONE", "RECORD"]).toContain(planLeadAbuseEffect(mode, "RECORD"));
    }
  });

  it("a block threshold cannot be configured for it (the BLOCK_AT variable is not even read)", () => {
    const name = leadAbuseThresholdEnvName("PURCHASE_REJECTED_PROBING", "BLOCK_AT");
    const parsed = parseLeadAbuseControlConfig({ LEAD_ABUSE_CONTROL_MODE: "ENFORCE", [name]: "3", LEAD_ABUSE_PURCHASE_REJECTED_PROBING_FLAG_AT: "4" });
    expect(parsed.config.thresholds.PURCHASE_REJECTED_PROBING).toEqual({ flagAt: 4, blockAt: null });
    expect(evaluateLeadAbuseRule("PURCHASE_REJECTED_PROBING", 1_000, parsed.config)?.recommendation).toBe("RECORD");
  });

  it("end to end in ENFORCE with an absurd count: one signal is recorded, NO decision (no flag, no block) and the purchase guard still allows the action", async () => {
    const control = new FakeLeadAbuseControlRepository();
    const facts = new FakeLeadAbuseFactsReader();
    facts.counts.rejected = 1_000_000;
    const evaluate = new EvaluateLeadAbuseUseCase(facts, control, defaultLeadAbuseControlConfig("ENFORCE"), () => NOW);
    const assessment = await evaluate.execute({ subjectUserId: USER, trigger: "PURCHASE" });
    expect(assessment?.hits.map((h) => h.rule)).toEqual(["PURCHASE_REJECTED_PROBING"]);
    expect(control.signals.map((s) => s.signalType)).toEqual(["PURCHASE_REJECTED_PROBING"]);
    expect(control.decisions).toEqual([]);

    const rt = new LeadAbuseRuntime("ENFORCE", evaluate, control, null, () => NOW, async () => undefined);
    const inner = okInner();
    await expect(new LeadAbuseGuardedInitiatePurchase(inner, rt).execute(USER, LEAD)).resolves.toBe("ok");
    expect(control.decisions).toEqual([]);
  });

  it("the other probing / burst rules keep their documented response ceilings (no broad rule change)", () => {
    const blockable = LEAD_ABUSE_RULE_KEYS.filter((k) => LEAD_ABUSE_RULES[k].blockedAction !== null);
    expect(blockable).toEqual(["PUBLICATION_BURST", "PURCHASE_INITIATION_BURST"]);
    expect(evaluateLeadAbuseRule("CONTACT_ACCESS_DENIED_PROBING", 5, defaultLeadAbuseControlConfig("ENFORCE"))?.recommendation).toBe("FLAG_FOR_REVIEW");
    expect(evaluateLeadAbuseRule("DUPLICATE_REQUEST_CONTENT", 3, defaultLeadAbuseControlConfig("ENFORCE"))?.recommendation).toBe("FLAG_FOR_REVIEW");
    expect(evaluateLeadAbuseRule("REPEATED_REVOCATIONS", 2, defaultLeadAbuseControlConfig("ENFORCE"))?.recommendation).toBe("FLAG_FOR_REVIEW");
  });
});

describe("M156 hardening — event-cap configuration guard", () => {
  it("an event-rule flag threshold above the stored-event cap would be unreachable, so it is ignored with a warning", () => {
    for (const rule of ["PURCHASE_REJECTED_PROBING", "CONTACT_ACCESS_DENIED_PROBING"] as const) {
      const over = parseLeadAbuseControlConfig({ [leadAbuseThresholdEnvName(rule, "FLAG_AT")]: String(LEAD_ABUSE_EVENT_CAP_PER_HOUR + 1) });
      expect(over.config.thresholds[rule].flagAt).toBe(LEAD_ABUSE_RULES[rule].defaults.flagAt);
      expect(over.warnings.join(" ")).toMatch(/unreachable/);
      const ok = parseLeadAbuseControlConfig({ [leadAbuseThresholdEnvName(rule, "FLAG_AT")]: String(LEAD_ABUSE_EVENT_CAP_PER_HOUR) });
      expect(ok.config.thresholds[rule].flagAt).toBe(LEAD_ABUSE_EVENT_CAP_PER_HOUR);
    }
  });

  it("every default event-rule threshold is far below the hourly cap", () => {
    expect(LEAD_ABUSE_RULES.PURCHASE_REJECTED_PROBING.defaults.flagAt * 4).toBeLessThanOrEqual(LEAD_ABUSE_EVENT_CAP_PER_HOUR);
    expect(LEAD_ABUSE_RULES.CONTACT_ACCESS_DENIED_PROBING.defaults.flagAt * 4).toBeLessThanOrEqual(LEAD_ABUSE_EVENT_CAP_PER_HOUR);
  });
});
