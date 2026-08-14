import type { PartnerFraudFlagTypeValue } from "@/domain/repositories/partner-fraud-flag-repository";

/**
 * Module 61 — Affiliate & Partner System: pure fraud-signal detection
 * rules, exercised by `DetectPartnerFraudSignalsUseCase` over data already
 * fetched from Module 60's repositories (referral visits, marketing
 * attributions, conversion events) plus this module's own partner data.
 * Same "use case fetches, domain function decides" split
 * `referral-visit-dedup-rules.ts` establishes — every function here is
 * side-effect free and independently unit-testable with plain fixture
 * data, no repository/mock required.
 *
 * Every rule below is advisory (see `PartnerFraudFlagRepository`'s own doc
 * comment) — detecting a signal never itself blocks a conversion, cancels
 * a commission, or changes `Partner.status`. An admin always decides what
 * to do with a raised flag.
 */

/** One attributed touch/conversion under a partner's referral code(s),
 *  reduced to only the fields fraud detection needs. `ipHash`/
 *  `userAgentTruncated` are already-hashed/already-truncated, matching
 *  Module 60's own "never handle a raw IP or full UA past ingestion"
 *  convention — this module never receives a raw IP either. */
export interface PartnerActivitySignal {
  referredUserId: string | null;
  visitorId: string;
  ipHash: string | null;
  userAgentTruncated: string | null;
  occurredAt: Date;
}

export interface FraudDetectionFinding {
  type: PartnerFraudFlagTypeValue;
  detail: string;
  relatedVisitorId: string | null;
  relatedUserId: string | null;
}

/** A partner referring themselves (their own `userId` shows up as the
 *  referred user) is the clearest possible abuse signal — it can only ever
 *  happen if someone logs in as both the partner and the "referred" user,
 *  which is never a legitimate flow. */
export function detectSelfReferral(partnerUserId: string, signals: readonly PartnerActivitySignal[]): FraudDetectionFinding[] {
  return signals
    .filter((s) => s.referredUserId === partnerUserId)
    .map((s) => ({
      type: "SELF_REFERRAL" as const,
      detail: `Partner's own userId (${partnerUserId}) appears as the referred user for visitor "${s.visitorId}".`,
      relatedVisitorId: s.visitorId,
      relatedUserId: s.referredUserId,
    }));
}

/** Same `ipHash` behind `minDistinctUsers` or more distinct referred users
 *  is a strong "one person driving multiple fake sign-ups" signal — a
 *  single household/office legitimately sharing an IP is common, so the
 *  threshold is deliberately not `2`. */
export function detectRepeatedIp(
  signals: readonly PartnerActivitySignal[],
  minDistinctUsers = 4,
): FraudDetectionFinding[] {
  const byIp = new Map<string, Set<string>>();
  for (const s of signals) {
    if (!s.ipHash || !s.referredUserId) continue;
    const set = byIp.get(s.ipHash) ?? new Set<string>();
    set.add(s.referredUserId);
    byIp.set(s.ipHash, set);
  }
  const findings: FraudDetectionFinding[] = [];
  for (const [ipHash, users] of byIp) {
    if (users.size >= minDistinctUsers) {
      findings.push({
        type: "REPEATED_IP",
        detail: `${users.size} distinct referred users share the same hashed IP (${ipHash.slice(0, 12)}...).`,
        relatedVisitorId: null,
        relatedUserId: null,
      });
    }
  }
  return findings;
}

/** Same truncated User-Agent behind `minDistinctUsers` or more distinct
 *  referred users — the device-level analog of `detectRepeatedIp`. */
export function detectRepeatedDevice(
  signals: readonly PartnerActivitySignal[],
  minDistinctUsers = 4,
): FraudDetectionFinding[] {
  const byDevice = new Map<string, Set<string>>();
  for (const s of signals) {
    if (!s.userAgentTruncated || !s.referredUserId) continue;
    const set = byDevice.get(s.userAgentTruncated) ?? new Set<string>();
    set.add(s.referredUserId);
    byDevice.set(s.userAgentTruncated, set);
  }
  const findings: FraudDetectionFinding[] = [];
  for (const [device, users] of byDevice) {
    if (users.size >= minDistinctUsers) {
      findings.push({
        type: "REPEATED_DEVICE",
        detail: `${users.size} distinct referred users share the same device fingerprint ("${device.slice(0, 40)}...").`,
        relatedVisitorId: null,
        relatedUserId: null,
      });
    }
  }
  return findings;
}

/** A user id seen attributed under more than one distinct `visitorId` for
 *  the same partner is a duplicate-account signal — a genuine visitor only
 *  ever registers once; more than one visitorId resolving to the same
 *  registered user suggests either account recycling or a bot creating
 *  throwaway accounts that were later consolidated/logged into from the
 *  same identity. */
export function detectDuplicateAccounts(
  signals: readonly PartnerActivitySignal[],
  minDistinctVisitors = 2,
): FraudDetectionFinding[] {
  const byUser = new Map<string, Set<string>>();
  for (const s of signals) {
    if (!s.referredUserId) continue;
    const set = byUser.get(s.referredUserId) ?? new Set<string>();
    set.add(s.visitorId);
    byUser.set(s.referredUserId, set);
  }
  const findings: FraudDetectionFinding[] = [];
  for (const [userId, visitors] of byUser) {
    if (visitors.size >= minDistinctVisitors) {
      findings.push({
        type: "DUPLICATE_ACCOUNT",
        detail: `Referred user ${userId} is attributed under ${visitors.size} distinct visitor identifiers.`,
        relatedVisitorId: null,
        relatedUserId: userId,
      });
    }
  }
  return findings;
}

/** More than `maxCount` conversions within `windowMs` of each other is an
 *  abnormal burst for an organic referral channel — flagged as suspicious
 *  velocity rather than auto-rejected, since a real viral moment (e.g. a
 *  Telegram post going out to a large channel at once) can legitimately
 *  produce a burst too; a human reviews which case this is. */
export function detectSuspiciousConversionVelocity(
  occurredAtTimestamps: readonly Date[],
  windowMs = 10 * 60 * 1000,
  maxCount = 20,
): FraudDetectionFinding[] {
  const sorted = [...occurredAtTimestamps].map((d) => d.getTime()).sort((a, b) => a - b);
  for (let i = 0; i + maxCount <= sorted.length; i++) {
    const windowStart = sorted[i];
    const windowEnd = sorted[i + maxCount - 1];
    if (windowStart === undefined || windowEnd === undefined) continue;
    if (windowEnd - windowStart <= windowMs) {
      return [
        {
          type: "SUSPICIOUS_CONVERSION",
          detail: `${maxCount} or more conversions occurred within a ${Math.round(windowMs / 60000)}-minute window.`,
          relatedVisitorId: null,
          relatedUserId: null,
        },
      ];
    }
  }
  return [];
}

/** A registration is "fake" for this heuristic when the referred user never
 *  produced any further conversion (no `BOOKING_CREATED`/other activity)
 *  — `becameActive` is supplied by the caller (it already knows, from
 *  Module 60's `ConversionEventRepository`, whether that user has any
 *  event beyond their own registration). Flagged only once a partner has a
 *  large-enough sample (`minSampleSize`) and a high-enough dead ratio, so a
 *  brand-new partner with two registrations and no bookings yet is never
 *  flagged on noise alone. */
export interface RegistrationOutcome {
  referredUserId: string;
  becameActive: boolean;
}

export function detectFakeRegistrationPattern(
  outcomes: readonly RegistrationOutcome[],
  minSampleSize = 5,
  deadRatioThreshold = 0.8,
): FraudDetectionFinding[] {
  if (outcomes.length < minSampleSize) return [];
  const deadCount = outcomes.filter((o) => !o.becameActive).length;
  const deadRatio = deadCount / outcomes.length;
  if (deadRatio < deadRatioThreshold) return [];
  return [
    {
      type: "FAKE_REGISTRATION",
      detail: `${deadCount} of ${outcomes.length} referred registrations (${Math.round(deadRatio * 100)}%) never produced any further activity.`,
      relatedVisitorId: null,
      relatedUserId: null,
    },
  ];
}

/** Runs every rule above and returns the combined findings — the single
 *  entry point `DetectPartnerFraudSignalsUseCase` calls. */
export function detectAllFraudSignals(
  partnerUserId: string,
  signals: readonly PartnerActivitySignal[],
  registrationOutcomes: readonly RegistrationOutcome[] = [],
): FraudDetectionFinding[] {
  return [
    ...detectSelfReferral(partnerUserId, signals),
    ...detectRepeatedIp(signals),
    ...detectRepeatedDevice(signals),
    ...detectDuplicateAccounts(signals),
    ...detectSuspiciousConversionVelocity(signals.map((s) => s.occurredAt)),
    ...detectFakeRegistrationPattern(registrationOutcomes),
  ];
}
