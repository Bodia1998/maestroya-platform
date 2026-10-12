import type { LeadAbuseControlRepository, LeadAbuseFactsReader } from "@/domain/repositories/lead-abuse-control-repository";
import {
  LEAD_ABUSE_RULES,
  evaluateLeadAbuseRules,
  isLeadAbuseUuid,
  planLeadAbuseEffect,
  ruleSignalDedupeKey,
  type LeadAbuseAssessment,
  type LeadAbuseControlConfig,
  type LeadAbuseFacts,
  type LeadAbuseRuleHit,
  type LeadAbuseRuleKey,
} from "@/domain/services/lead-abuse-controls";

/** Which family of rules a call evaluates. Each trigger reads only the facts its rules need. */
export type LeadAbuseTrigger = "PUBLICATION" | "PURCHASE" | "CONTACT";

const RULES_BY_TRIGGER: Readonly<Record<LeadAbuseTrigger, readonly LeadAbuseRuleKey[]>> = {
  PUBLICATION: ["PUBLICATION_BURST", "DUPLICATE_REQUEST_CONTENT"],
  PURCHASE: ["PURCHASE_INITIATION_BURST", "PURCHASE_REJECTED_PROBING", "REPEATED_DISPUTES_OPENED", "REPEATED_DISPUTES_LOST", "REPEATED_REVOCATIONS"],
  CONTACT: ["CONTACT_ACCESS_DENIED_PROBING"],
};

/**
 * Module 156 — evaluates the versioned rules for ONE subject and applies the graduated, mode-limited response:
 * record a signal -> flag for review -> (ENFORCE, burst rules only) temporarily block ONE named action.
 *
 * Properties:
 *  - OFF does nothing at all (no read, no write).
 *  - Facts are COUNTS read through the read-only `LeadAbuseFactsReader`; a malformed count skips its rule (no accusation).
 *  - Idempotent: a signal has a deterministic dedupe key (rule, subject, window bucket); a flag / block is created at most once
 *    while ACTIVE (partial unique index), so repeated or concurrent evaluations converge on the same rows.
 *  - It never decides authorization, never changes a purchase / dispute / revocation, never touches money.
 *  - It throws on infrastructure failure; the guards that call it treat that as non-fatal (they never fail the user's action).
 */
export class EvaluateLeadAbuseUseCase {
  constructor(
    private readonly facts: LeadAbuseFactsReader,
    private readonly control: Pick<LeadAbuseControlRepository, "recordSignal" | "applyAutomatedDecision">,
    private readonly config: LeadAbuseControlConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: { subjectUserId: string; trigger: LeadAbuseTrigger }): Promise<LeadAbuseAssessment | null> {
    const mode = this.config.mode;
    if (mode === "OFF") return null;
    if (!isLeadAbuseUuid(input?.subjectUserId) || !(input.trigger in RULES_BY_TRIGGER)) return null;

    const subjectUserId = input.subjectUserId.trim();
    const at = this.now();
    const facts = await this.readFacts(subjectUserId, input.trigger, at);
    const assessment = evaluateLeadAbuseRules(subjectUserId, facts, this.config, at);

    for (const hit of assessment.hits) {
      const effect = planLeadAbuseEffect(mode, hit.recommendation);
      if (effect === "NONE") continue;

      await this.control.recordSignal({
        subjectUserId,
        signalType: hit.signalType,
        reliability: hit.reliability,
        severity: hit.severity,
        ruleVersion: this.config.rulesetVersion,
        dedupeKey: ruleSignalDedupeKey(this.config.rulesetVersion, hit.rule, subjectUserId, hit.windowMs, at),
        targetLeadId: null,
        observedCount: hit.observed,
        threshold: hit.threshold,
        windowSeconds: Math.round(hit.windowMs / 1000),
        occurredAt: at,
      });

      if (effect === "FLAG_FOR_REVIEW" || effect === "TEMPORARY_BLOCK") await this.flag(subjectUserId, hit, at);
      if (effect === "TEMPORARY_BLOCK") await this.block(subjectUserId, hit, at);
    }
    return assessment;
  }

  private async flag(subjectUserId: string, hit: LeadAbuseRuleHit, at: Date): Promise<void> {
    await this.control.applyAutomatedDecision({
      subjectUserId,
      action: "FLAG_FOR_REVIEW",
      restrictedAction: null,
      ruleKey: hit.rule,
      ruleVersion: this.config.rulesetVersion,
      expiresAt: null,
      decidedAt: at,
      observedCount: hit.observed,
      threshold: hit.threshold,
    });
  }

  private async block(subjectUserId: string, hit: LeadAbuseRuleHit, at: Date): Promise<void> {
    // Defence in depth: only a rule that declares a blocked action and a positive duration can ever block.
    if (hit.blockedAction === null || hit.blockDurationMs <= 0 || LEAD_ABUSE_RULES[hit.rule].blockedAction !== hit.blockedAction) return;
    await this.control.applyAutomatedDecision({
      subjectUserId,
      action: "TEMPORARY_BLOCK",
      restrictedAction: hit.blockedAction,
      ruleKey: hit.rule,
      ruleVersion: this.config.rulesetVersion,
      expiresAt: new Date(at.getTime() + hit.blockDurationMs),
      decidedAt: at,
      observedCount: hit.observed,
      threshold: hit.threshold,
    });
  }

  private async readFacts(subjectUserId: string, trigger: LeadAbuseTrigger, at: Date): Promise<LeadAbuseFacts> {
    const since = (rule: LeadAbuseRuleKey) => new Date(at.getTime() - LEAD_ABUSE_RULES[rule].windowMs);
    const out: LeadAbuseFacts = {};
    const jobs: Array<Promise<void>> = [];
    const read = (rule: LeadAbuseRuleKey, fn: (since: Date) => Promise<number>) => {
      if (!RULES_BY_TRIGGER[trigger].includes(rule)) return;
      jobs.push(fn(since(rule)).then((n) => void (out[rule] = n)));
    };

    read("PUBLICATION_BURST", (s) => this.facts.countPublicationsByCustomer(subjectUserId, s));
    read("DUPLICATE_REQUEST_CONTENT", (s) => this.facts.maxIdenticalRequestGroupByCustomer(subjectUserId, s));
    read("PURCHASE_INITIATION_BURST", (s) => this.facts.countPurchaseInitiationsByProfessional(subjectUserId, s));
    read("PURCHASE_REJECTED_PROBING", (s) => this.facts.countDistinctEventLeads(subjectUserId, "PURCHASE_REJECTED_EVENT", s));
    read("CONTACT_ACCESS_DENIED_PROBING", (s) => this.facts.countDistinctEventLeads(subjectUserId, "CONTACT_ACCESS_DENIED_EVENT", s));
    read("REPEATED_DISPUTES_OPENED", (s) => this.facts.countDisputesOpenedByProfessional(subjectUserId, s));
    read("REPEATED_DISPUTES_LOST", (s) => this.facts.countDisputesLostByProfessional(subjectUserId, s));
    read("REPEATED_REVOCATIONS", (s) => this.facts.countRevocationsByProfessional(subjectUserId, s));

    await Promise.all(jobs);
    return out;
  }
}
