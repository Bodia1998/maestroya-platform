import { DomainError } from "@/domain/errors/domain-error";

/**
 * Module 156 — Lead Marketplace Fraud & Abuse Controls: the pure, deterministic core.
 *
 * Nothing here reads a clock, a database, an environment variable or a random source: every function is a function of its
 * arguments, so every rule is unit-testable and the same facts always yield the same assessment.
 *
 * WHAT THIS IS NOT. It is not authorization and it is not a score that unlocks anything. Contact access stays decided ONLY by the
 * M122/M138/M139 policy (purchase CONFIRMED, M155 DISPUTED/REVOKED denied). An assessment can only RECORD a signal, FLAG a subject
 * for review, or (ENFORCE mode, burst rules only) TEMPORARILY block one named high-cost action. It never touches money, refunds,
 * the ledger, purchases or disputes, and it never accuses, bans or penalises anybody on its own.
 *
 * RELIABLE vs HEURISTIC. A signal is RELIABLE when it is a count of persisted, system-recorded facts (a dispute row, a revocation
 * row); even then the INTERPRETATION is not certain (a dispute can be legitimate), so no rule blocks on its own: stronger
 * restrictions need an administrator. A signal is HEURISTIC when it is a volume pattern (bursts, repeated probing, repeated
 * content) that a legitimate power user could also produce: heuristic rules flag at most and block only briefly, in ENFORCE mode only.
 */

/** Version stamped on every signal / decision. Bump when a rule, a default threshold or a window changes. */
export const LEAD_ABUSE_RULESET_VERSION = "m156.v1";

// ---------------------------------------------------------------------------------------------------------------------------
// Modes (rollout switch)
// ---------------------------------------------------------------------------------------------------------------------------

/**
 * OFF      (default) nothing is evaluated, recorded or enforced; the guarded use cases are not even wrapped.
 * SHADOW   rules are evaluated and signals are RECORDED; no flag, no block, no rate limit.
 * FLAG     SHADOW + subjects are FLAGGED for review (a flag restricts nothing).
 * ENFORCE  FLAG + temporary blocks of the named action (burst rules and administrator decisions) + the per-user rate limits.
 */
export const LEAD_ABUSE_MODES = ["OFF", "SHADOW", "FLAG", "ENFORCE"] as const;
export type LeadAbuseMode = (typeof LEAD_ABUSE_MODES)[number];
export const DEFAULT_LEAD_ABUSE_MODE: LeadAbuseMode = "OFF";

/** Exact, case-sensitive match. Anything else (unset, empty, "true", "enforce ", typos) is OFF: an unreadable switch never enforces. */
export function parseLeadAbuseMode(value: unknown): LeadAbuseMode {
  return typeof value === "string" && (LEAD_ABUSE_MODES as readonly string[]).includes(value) ? (value as LeadAbuseMode) : DEFAULT_LEAD_ABUSE_MODE;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------------------------------------------------------

export const LEAD_ABUSE_RULE_KEYS = [
  "PUBLICATION_BURST",
  "DUPLICATE_REQUEST_CONTENT",
  "PURCHASE_INITIATION_BURST",
  "PURCHASE_REJECTED_PROBING",
  "CONTACT_ACCESS_DENIED_PROBING",
  "REPEATED_DISPUTES_OPENED",
  "REPEATED_DISPUTES_LOST",
  "REPEATED_REVOCATIONS",
] as const;
export type LeadAbuseRuleKey = (typeof LEAD_ABUSE_RULE_KEYS)[number];

/** Raw, per-occurrence security events recorded by the guards (one row per (user, lead, hour), see `eventSignalDedupeKey`). */
export const LEAD_ABUSE_EVENT_SIGNAL_TYPES = ["PURCHASE_REJECTED_EVENT", "CONTACT_ACCESS_DENIED_EVENT"] as const;
export type LeadAbuseEventSignalType = (typeof LEAD_ABUSE_EVENT_SIGNAL_TYPES)[number];

/** A signal is either a rule hit (the rule key is the type) or a raw event. Mirrors the database enum. */
export type LeadAbuseSignalType = LeadAbuseRuleKey | LeadAbuseEventSignalType;

export type LeadAbuseReliability = "RELIABLE" | "HEURISTIC";
export type LeadAbuseSeverity = "LOW" | "MEDIUM" | "HIGH";
export type LeadAbuseRiskLevel = "NONE" | "LOW" | "ELEVATED" | "HIGH";

export const LEAD_ABUSE_RESTRICTED_ACTIONS = ["LEAD_PUBLICATION", "LEAD_PURCHASE_INITIATION"] as const;
export type LeadAbuseRestrictedAction = (typeof LEAD_ABUSE_RESTRICTED_ACTIONS)[number];

export const LEAD_ABUSE_DECISION_ACTIONS = ["FLAG_FOR_REVIEW", "TEMPORARY_BLOCK"] as const;
export type LeadAbuseDecisionAction = (typeof LEAD_ABUSE_DECISION_ACTIONS)[number];

export type LeadAbuseDecisionStatus = "ACTIVE" | "LIFTED" | "EXPIRED";
export type LeadAbuseDecisionOrigin = "AUTOMATED" | "ADMIN";

/** What the evaluation of one rule recommends, before the rollout mode is applied. */
export type LeadAbuseRecommendation = "RECORD" | "FLAG_FOR_REVIEW" | "TEMPORARY_BLOCK";

/** What actually happens once the mode is applied. */
export type LeadAbuseEffectiveAction = "NONE" | LeadAbuseRecommendation;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Automated blocks last at most this long; administrator blocks at most `MAX_ADMIN_BLOCK_MS`. There is no permanent block. */
export const MAX_AUTOMATED_BLOCK_MS = DAY_MS;
export const MAX_ADMIN_BLOCK_MS = 30 * DAY_MS;
export const MIN_BLOCK_MS = HOUR_MS / 2;

// ---------------------------------------------------------------------------------------------------------------------------
// Rule definitions and configuration
// ---------------------------------------------------------------------------------------------------------------------------

export interface LeadAbuseRuleDefinition {
  readonly key: LeadAbuseRuleKey;
  readonly reliability: LeadAbuseReliability;
  /** Severity of a plain flag-level hit. A rule with `blockAt` reports HIGH once the block threshold is reached. */
  readonly severity: LeadAbuseSeverity;
  /** Look-back window of the counted facts. */
  readonly windowMs: number;
  /** The action a TEMPORARY_BLOCK of this rule restricts; null = the rule can never block. */
  readonly blockedAction: LeadAbuseRestrictedAction | null;
  readonly blockDurationMs: number;
  /**
   * Strongest response the rule may recommend at its (flag) threshold. `false` = the rule is RECORD-ONLY: its hit is stored as a
   * signal (evidence) but never creates a flag, never a block. A rule that cannot block (`blockedAction === null`) can never
   * exceed `FLAG_FOR_REVIEW`; a record-only rule cannot exceed `RECORD`.
   */
  readonly flagsForReview: boolean;
  readonly defaults: { readonly flagAt: number; readonly blockAt: number | null };
}

/**
 * The complete, versioned rule table. Only the three BURST rules can block, and only briefly: bursts are the one place where
 * stopping the action immediately matters and where the block heals by itself. Every rule that rests on dispute / revocation
 * history, content similarity or probing flags only; a stronger restriction needs an administrator decision.
 */
export const LEAD_ABUSE_RULES: Readonly<Record<LeadAbuseRuleKey, LeadAbuseRuleDefinition>> = {
  PUBLICATION_BURST: {
    key: "PUBLICATION_BURST",
    reliability: "HEURISTIC",
    severity: "MEDIUM",
    windowMs: HOUR_MS,
    blockedAction: "LEAD_PUBLICATION",
    blockDurationMs: HOUR_MS,
    flagsForReview: true,
    defaults: { flagAt: 10, blockAt: 20 },
  },
  DUPLICATE_REQUEST_CONTENT: {
    key: "DUPLICATE_REQUEST_CONTENT",
    reliability: "HEURISTIC",
    severity: "LOW",
    windowMs: DAY_MS,
    blockedAction: null,
    blockDurationMs: 0,
    flagsForReview: true,
    defaults: { flagAt: 3, blockAt: null },
  },
  PURCHASE_INITIATION_BURST: {
    key: "PURCHASE_INITIATION_BURST",
    reliability: "HEURISTIC",
    severity: "MEDIUM",
    windowMs: HOUR_MS,
    blockedAction: "LEAD_PURCHASE_INITIATION",
    blockDurationMs: HOUR_MS,
    flagsForReview: true,
    defaults: { flagAt: 15, blockAt: 30 },
  },
  PURCHASE_REJECTED_PROBING: {
    key: "PURCHASE_REJECTED_PROBING",
    reliability: "HEURISTIC",
    severity: "LOW",
    windowMs: HOUR_MS,
    blockedAction: null,
    blockDurationMs: 0,
    flagsForReview: false,
    defaults: { flagAt: 10, blockAt: null },
  },
  CONTACT_ACCESS_DENIED_PROBING: {
    key: "CONTACT_ACCESS_DENIED_PROBING",
    reliability: "HEURISTIC",
    severity: "MEDIUM",
    windowMs: HOUR_MS,
    blockedAction: null,
    blockDurationMs: 0,
    flagsForReview: true,
    defaults: { flagAt: 5, blockAt: null },
  },
  REPEATED_DISPUTES_OPENED: {
    key: "REPEATED_DISPUTES_OPENED",
    reliability: "RELIABLE",
    severity: "MEDIUM",
    windowMs: 90 * DAY_MS,
    blockedAction: null,
    blockDurationMs: 0,
    flagsForReview: true,
    defaults: { flagAt: 2, blockAt: null },
  },
  REPEATED_DISPUTES_LOST: {
    key: "REPEATED_DISPUTES_LOST",
    reliability: "RELIABLE",
    severity: "HIGH",
    windowMs: 90 * DAY_MS,
    blockedAction: null,
    blockDurationMs: 0,
    flagsForReview: true,
    defaults: { flagAt: 2, blockAt: null },
  },
  REPEATED_REVOCATIONS: {
    key: "REPEATED_REVOCATIONS",
    reliability: "RELIABLE",
    severity: "HIGH",
    windowMs: 90 * DAY_MS,
    blockedAction: null,
    blockDurationMs: 0,
    flagsForReview: true,
    defaults: { flagAt: 2, blockAt: null },
  },
};

/** Bounds accepted for an operator-supplied threshold. Out-of-range / non-integer values are rejected (the default is used). */
/**
 * Persistence-level cap on stored raw EVENT signals (see migration `20261025000000_add_module_156_event_signal_cap`): per subject
 * and per event type, at most this many rows may be created inside any trailing hour / day (database clock). Rows beyond the cap
 * are silently NOT stored (the insert is skipped, nothing is raised). MUST equal the constants inside the trigger function; a
 * static test compares them. Rule-hit signals are bounded by their dedupe key and are not capped. Both caps sit far above every
 * default event-rule threshold (5 and 10 distinct leads per hour).
 */
export const LEAD_ABUSE_EVENT_CAP_PER_HOUR = 50;
export const LEAD_ABUSE_EVENT_CAP_PER_DAY = 200;
/** Rules that are fed by raw event rows: their flag threshold must stay reachable under the hourly cap. */
export const LEAD_ABUSE_EVENT_DRIVEN_RULES = ["PURCHASE_REJECTED_PROBING", "CONTACT_ACCESS_DENIED_PROBING"] as const;

export const LEAD_ABUSE_THRESHOLD_MIN = 2;
export const LEAD_ABUSE_THRESHOLD_MAX = 10_000;

export interface LeadAbuseRuleThresholds {
  readonly flagAt: number;
  readonly blockAt: number | null;
}

export interface LeadAbuseControlConfig {
  readonly mode: LeadAbuseMode;
  readonly rulesetVersion: string;
  readonly thresholds: Readonly<Record<LeadAbuseRuleKey, LeadAbuseRuleThresholds>>;
}

export function defaultLeadAbuseControlConfig(mode: LeadAbuseMode = DEFAULT_LEAD_ABUSE_MODE): LeadAbuseControlConfig {
  const thresholds = {} as Record<LeadAbuseRuleKey, LeadAbuseRuleThresholds>;
  for (const key of LEAD_ABUSE_RULE_KEYS) thresholds[key] = { ...LEAD_ABUSE_RULES[key].defaults };
  return { mode, rulesetVersion: LEAD_ABUSE_RULESET_VERSION, thresholds };
}

export const LEAD_ABUSE_MODE_ENV = "LEAD_ABUSE_CONTROL_MODE";
/** `LEAD_ABUSE_<RULE>_FLAG_AT` / `LEAD_ABUSE_<RULE>_BLOCK_AT` (the latter only for rules that can block). */
export const leadAbuseThresholdEnvName = (rule: LeadAbuseRuleKey, kind: "FLAG_AT" | "BLOCK_AT"): string => `LEAD_ABUSE_${rule}_${kind}`;

function parseThreshold(raw: unknown): number | null {
  if (typeof raw !== "string" || !/^\d{1,5}$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return n >= LEAD_ABUSE_THRESHOLD_MIN && n <= LEAD_ABUSE_THRESHOLD_MAX ? n : null;
}

export interface ParsedLeadAbuseControlConfig {
  config: LeadAbuseControlConfig;
  /** Human-readable notes about every override that was ignored (never contains a secret). */
  warnings: string[];
}

/**
 * Builds the configuration from an environment-like record. Safe by default: the mode is OFF unless it is exactly one of the four
 * mode names, and every threshold override that is not a plain integer inside [2, 10000], or that would not leave
 * `blockAt > flagAt`, is IGNORED (the released default stays) and reported in `warnings`. A malformed threshold therefore cannot
 * make the rules fire on everybody, and cannot disable a rule either.
 */
export function parseLeadAbuseControlConfig(source: Readonly<Record<string, string | undefined>>): ParsedLeadAbuseControlConfig {
  const warnings: string[] = [];
  const config = defaultLeadAbuseControlConfig(parseLeadAbuseMode(source[LEAD_ABUSE_MODE_ENV]));
  const rawMode = source[LEAD_ABUSE_MODE_ENV];
  if (rawMode !== undefined && rawMode !== "" && config.mode === "OFF" && rawMode !== "OFF") warnings.push(`${LEAD_ABUSE_MODE_ENV} is not a valid mode; using OFF.`);

  const thresholds = config.thresholds as Record<LeadAbuseRuleKey, LeadAbuseRuleThresholds>;
  for (const key of LEAD_ABUSE_RULE_KEYS) {
    const def = LEAD_ABUSE_RULES[key];
    let flagAt = def.defaults.flagAt;
    let blockAt = def.defaults.blockAt;

    const flagName = leadAbuseThresholdEnvName(key, "FLAG_AT");
    if (source[flagName] !== undefined && source[flagName] !== "") {
      const parsed = parseThreshold(source[flagName]);
      if (parsed === null) warnings.push(`${flagName} ignored (must be an integer in [${LEAD_ABUSE_THRESHOLD_MIN}, ${LEAD_ABUSE_THRESHOLD_MAX}]).`);
      else flagAt = parsed;
    }
    if (def.blockedAction !== null) {
      const blockName = leadAbuseThresholdEnvName(key, "BLOCK_AT");
      if (source[blockName] !== undefined && source[blockName] !== "") {
        const parsed = parseThreshold(source[blockName]);
        if (parsed === null) warnings.push(`${blockName} ignored (must be an integer in [${LEAD_ABUSE_THRESHOLD_MIN}, ${LEAD_ABUSE_THRESHOLD_MAX}]).`);
        else blockAt = parsed;
      }
    }
    if ((LEAD_ABUSE_EVENT_DRIVEN_RULES as readonly string[]).includes(key) && flagAt > LEAD_ABUSE_EVENT_CAP_PER_HOUR) {
      warnings.push(`${key}: threshold above the stored-event cap (${LEAD_ABUSE_EVENT_CAP_PER_HOUR}/hour) would be unreachable; default restored.`);
      flagAt = def.defaults.flagAt;
    }
    if (blockAt !== null && blockAt <= flagAt) {
      warnings.push(`${key}: block threshold must exceed the flag threshold; defaults restored.`);
      flagAt = def.defaults.flagAt;
      blockAt = def.defaults.blockAt;
    }
    thresholds[key] = { flagAt, blockAt };
  }
  return { config, warnings };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Facts, rule evaluation and the assessment
// ---------------------------------------------------------------------------------------------------------------------------

/**
 * The counted facts of one subject. A key that is absent was not read for this evaluation (rule skipped). A value that is not a
 * non-negative safe integer (NaN, negative, fractional, a string, null) is UNKNOWN: the rule is skipped and NOTHING is recorded or
 * decided — malformed input never produces an accusation.
 */
export type LeadAbuseFacts = Partial<Record<LeadAbuseRuleKey, unknown>>;

export interface LeadAbuseRuleHit {
  readonly rule: LeadAbuseRuleKey;
  readonly signalType: LeadAbuseRuleKey;
  readonly reliability: LeadAbuseReliability;
  readonly severity: LeadAbuseSeverity;
  readonly observed: number;
  /** The threshold that was reached (the block threshold when it was reached, else the flag threshold). */
  readonly threshold: number;
  readonly windowMs: number;
  readonly recommendation: LeadAbuseRecommendation;
  readonly blockedAction: LeadAbuseRestrictedAction | null;
  readonly blockDurationMs: number;
}

export interface LeadAbuseAssessment {
  readonly rulesetVersion: string;
  readonly subjectUserId: string;
  readonly evaluatedAt: Date;
  readonly riskLevel: LeadAbuseRiskLevel;
  readonly hits: readonly LeadAbuseRuleHit[];
}

export function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function evaluateLeadAbuseRule(rule: LeadAbuseRuleKey, observed: unknown, config: LeadAbuseControlConfig): LeadAbuseRuleHit | null {
  if (!isCount(observed)) return null;
  const def = LEAD_ABUSE_RULES[rule];
  const t = config.thresholds[rule];
  if (!t || !isCount(t.flagAt) || t.flagAt < 1) return null;

  const blockReached = t.blockAt !== null && def.blockedAction !== null && isCount(t.blockAt) && observed >= t.blockAt;
  if (blockReached) {
    return {
      rule,
      signalType: rule,
      reliability: def.reliability,
      severity: "HIGH",
      observed,
      threshold: t.blockAt as number,
      windowMs: def.windowMs,
      recommendation: "TEMPORARY_BLOCK",
      blockedAction: def.blockedAction,
      blockDurationMs: Math.min(def.blockDurationMs, MAX_AUTOMATED_BLOCK_MS),
    };
  }
  if (observed >= t.flagAt) {
    return {
      rule,
      signalType: rule,
      reliability: def.reliability,
      severity: def.severity,
      observed,
      threshold: t.flagAt,
      windowMs: def.windowMs,
      recommendation: def.flagsForReview ? "FLAG_FOR_REVIEW" : "RECORD",
      blockedAction: null,
      blockDurationMs: 0,
    };
  }
  return null;
}

export function riskLevelOf(hits: readonly LeadAbuseRuleHit[]): LeadAbuseRiskLevel {
  if (hits.some((h) => h.severity === "HIGH")) return "HIGH";
  if (hits.some((h) => h.severity === "MEDIUM")) return "ELEVATED";
  return hits.length > 0 ? "LOW" : "NONE";
}

/**
 * Evaluates every rule for which a fact was supplied. Pure and deterministic; hits come out in the fixed rule order. The result
 * is advisory input to `planLeadAbuseEffect`; it is never an authorization input.
 */
export function evaluateLeadAbuseRules(subjectUserId: string, facts: LeadAbuseFacts, config: LeadAbuseControlConfig, now: Date): LeadAbuseAssessment {
  const hits: LeadAbuseRuleHit[] = [];
  for (const rule of LEAD_ABUSE_RULE_KEYS) {
    if (!(rule in facts)) continue;
    const hit = evaluateLeadAbuseRule(rule, facts[rule], config);
    if (hit) hits.push(hit);
  }
  return { rulesetVersion: config.rulesetVersion, subjectUserId, evaluatedAt: now, riskLevel: riskLevelOf(hits), hits };
}

/** Applies the rollout mode to one recommendation. The graduated ladder: record -> flag -> temporary block (ENFORCE only). */
export function planLeadAbuseEffect(mode: LeadAbuseMode, recommendation: LeadAbuseRecommendation): LeadAbuseEffectiveAction {
  switch (mode) {
    case "SHADOW":
      return "RECORD";
    case "FLAG":
      return recommendation === "RECORD" ? "RECORD" : "FLAG_FOR_REVIEW";
    case "ENFORCE":
      return recommendation;
    default:
      return "NONE"; // OFF and anything unrecognised
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Idempotency keys
// ---------------------------------------------------------------------------------------------------------------------------

/** One rule-hit signal per (ruleset, rule, subject, window bucket): re-evaluating inside the same window records nothing new. */
export function ruleSignalDedupeKey(rulesetVersion: string, rule: LeadAbuseRuleKey, subjectUserId: string, windowMs: number, at: Date): string {
  return `${rulesetVersion}:${rule}:${subjectUserId}:${Math.floor(at.getTime() / windowMs)}`;
}

/** One raw event row per (type, subject, lead, hour): repeated probing of ONE lead cannot grow the table without bound. */
export function eventSignalDedupeKey(type: LeadAbuseEventSignalType, subjectUserId: string, leadId: string, at: Date): string {
  return `${LEAD_ABUSE_RULESET_VERSION}:${type}:${subjectUserId}:${leadId.toLowerCase()}:${Math.floor(at.getTime() / HOUR_MS)}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isLeadAbuseUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value.trim());

// ---------------------------------------------------------------------------------------------------------------------------
// Administrator decisions
// ---------------------------------------------------------------------------------------------------------------------------

export const LEAD_ABUSE_ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"] as const;
export const LEAD_ABUSE_ADMIN_ACTIVE_STATUS = "ACTIVE";
export const LEAD_ABUSE_NOTE_MAX_LENGTH = 500;

export type LeadAbuseRejectionReason =
  | "ACTOR_NOT_AUTHORIZED"
  | "INVALID_INPUT"
  | "SUBJECT_NOT_FOUND"
  | "DECISION_NOT_FOUND"
  | "INVALID_STATE";

/** Closed reason set; the message never echoes input. */
export class LeadAbuseControlRejectedError extends DomainError {
  readonly code = "LEAD_ABUSE_CONTROL_REJECTED";

  constructor(readonly reason: LeadAbuseRejectionReason) {
    super(`Lead abuse control request rejected: ${reason}.`);
  }
}

/** Trimmed, control-character-free, 1..500 characters; anything else is INVALID_INPUT. */
export function normalizeLeadAbuseNote(value: unknown): string {
  if (typeof value !== "string") throw new LeadAbuseControlRejectedError("INVALID_INPUT");
  const text = value.trim();
  if (text.length === 0 || text.length > LEAD_ABUSE_NOTE_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(text)) throw new LeadAbuseControlRejectedError("INVALID_INPUT");
  return text;
}

export function isLeadAbuseRestrictedAction(value: unknown): value is LeadAbuseRestrictedAction {
  return typeof value === "string" && (LEAD_ABUSE_RESTRICTED_ACTIONS as readonly string[]).includes(value);
}

/** Administrator block duration in whole milliseconds: [30 minutes, 30 days]. Everything else is INVALID_INPUT (no permanent block). */
export function normalizeAdminBlockDurationMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < MIN_BLOCK_MS || value > MAX_ADMIN_BLOCK_MS) {
    throw new LeadAbuseControlRejectedError("INVALID_INPUT");
  }
  return value;
}

/** The only legal status moves of a decision. ACTIVE is the only non-terminal status. */
export function canTransitionLeadAbuseDecision(from: LeadAbuseDecisionStatus, to: LeadAbuseDecisionStatus): boolean {
  return from === "ACTIVE" && (to === "LIFTED" || to === "EXPIRED");
}

/** True while the decision still restricts: ACTIVE and (for a block) not past its expiry. A flag never restricts. */
export function isBlockInForce(decision: { action: LeadAbuseDecisionAction; status: LeadAbuseDecisionStatus; expiresAt: Date | null }, now: Date): boolean {
  return decision.action === "TEMPORARY_BLOCK" && decision.status === "ACTIVE" && decision.expiresAt !== null && decision.expiresAt.getTime() > now.getTime();
}
