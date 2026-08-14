/**
 * Module 65 — Trust & Integrity System: fraud-detection rule engine. Every
 * function here is a pure predicate/classifier over caller-supplied data —
 * this file never queries a database itself (same "caller fetches, this
 * file only decides" split `materials-procurement-rules.ts` documents for
 * its own domain); the various `Detect*UseCase`s in
 * `application/use-cases/trust-integrity/` are responsible for gathering
 * candidate records (via `UserRepository`/`ProfessionalPayoutAccountRepository`/
 * a device-fingerprint provider) before calling into this file.
 *
 * ## Extension point
 * `FraudDetectionRule` is a small, closed interface so a future risk
 * factor (e.g. a graph-based collusion detector) can be added by
 * implementing one more rule and registering it in
 * `DEFAULT_FRAUD_DETECTION_RULES`, without any existing rule or call site
 * changing shape — the same "closed contract, open implementation" pattern
 * `TaxCalculatorRegistry`/`PricingAdjustment` already use.
 */
import type { FraudSignalType } from "@/domain/repositories/fraud-signal-repository";

export interface IdentifierCluster {
  /** A hashed/normalized identifier shared by two or more users — never a
   *  raw phone/IBAN/device id (see `FraudSignal.detail`'s own doc comment
   *  on never persisting raw PII). */
  identifierHash: string;
  userIds: string[];
}

export interface FraudDetectionResult {
  type: FraudSignalType;
  userIds: string[];
  detail: string;
}

/** Generic "N different users share one identifier" detector — the shared
 *  primitive `detectSameIdentifierClusters` specializes for phone/IBAN/
 *  Stripe account/device below. A cluster of exactly one user is not a
 *  signal (nothing shared); the input is assumed pre-grouped by identifier
 *  (see each specialized function's own doc comment for how it groups). */
function clustersWithMultipleUsers(clusters: readonly IdentifierCluster[]): IdentifierCluster[] {
  return clusters.filter((c) => new Set(c.userIds).size > 1);
}

function toResults(
  clusters: readonly IdentifierCluster[],
  type: FraudSignalType,
  labelSingular: string,
): FraudDetectionResult[] {
  return clustersWithMultipleUsers(clusters).map((c) => ({
    type,
    userIds: Array.from(new Set(c.userIds)),
    detail: `${Array.from(new Set(c.userIds)).length} accounts share the same ${labelSingular} (hash ${c.identifierHash.slice(0, 12)}...).`,
  }));
}

/** Requirement #4 — "multiple accounts, same phone": `records` is every
 *  (userId, normalizedPhoneHash) pair the caller collected; grouping by
 *  hash happens in the use case (`Map<hash, userId[]>`) before this is
 *  called, matching every other detector below. */
export function detectSamePhoneClusters(clusters: readonly IdentifierCluster[]): FraudDetectionResult[] {
  return toResults(clusters, "SAME_PHONE", "phone number");
}

/** Requirement #4 — "same IBAN". */
export function detectSameIbanClusters(clusters: readonly IdentifierCluster[]): FraudDetectionResult[] {
  return toResults(clusters, "SAME_IBAN", "IBAN");
}

/** Requirement #4 — "same Stripe account". */
export function detectSameStripeAccountClusters(clusters: readonly IdentifierCluster[]): FraudDetectionResult[] {
  return toResults(clusters, "SAME_STRIPE_ACCOUNT", "Stripe Connect account");
}

/** Requirement #5/#4 — "same device" / "duplicate identities", fed by
 *  `DeviceFingerprintProvider` output (see that port's own doc comment). */
export function detectSameDeviceClusters(clusters: readonly IdentifierCluster[]): FraudDetectionResult[] {
  return toResults(clusters, "SAME_DEVICE", "device fingerprint");
}

export interface RegistrationPatternInput {
  userId: string;
  /** How many accounts were created from the same ipHash/deviceHash within
   *  `windowMinutes` — the burst-registration signal. */
  accountsFromSameSourceInWindow: number;
  /** Minutes between account creation and the first meaningful action
   *  (first ServiceRequest/Quote/Message) — an implausibly short gap is
   *  itself suspicious for a marketplace that expects browsing/decision
   *  time. */
  minutesToFirstAction: number | null;
}

export const SUSPICIOUS_REGISTRATION_BURST_THRESHOLD = 3;
export const SUSPICIOUS_REGISTRATION_MIN_MINUTES_TO_ACTION = 1;

/** Requirement #4 — "suspicious registration patterns": a burst of
 *  same-source signups, or near-instant first action (consistent with a
 *  scripted/bot registration rather than a person reading the page). */
export function detectSuspiciousRegistrationPattern(input: RegistrationPatternInput): FraudDetectionResult | null {
  const burst = input.accountsFromSameSourceInWindow >= SUSPICIOUS_REGISTRATION_BURST_THRESHOLD;
  const tooFast =
    input.minutesToFirstAction !== null && input.minutesToFirstAction < SUSPICIOUS_REGISTRATION_MIN_MINUTES_TO_ACTION;
  if (!burst && !tooFast) return null;

  const reasons = [
    burst ? `${input.accountsFromSameSourceInWindow} accounts registered from the same source in a short window` : null,
    tooFast ? `first meaningful action occurred within ${input.minutesToFirstAction} minute(s) of signup` : null,
  ].filter((r): r is string => r !== null);

  return {
    type: "SUSPICIOUS_REGISTRATION_PATTERN",
    userIds: [input.userId],
    detail: reasons.join("; "),
  };
}

export const REPEATED_FAILED_VERIFICATION_THRESHOLD = 3;

/** Requirement #4 — "repeated failed verification": reads a count the
 *  caller derives from Module 59's own `ProfessionalVerificationRepository`
 *  (rejection history) — this file never touches that repository directly,
 *  per requirement #14's "do not duplicate verification logic." */
export function detectRepeatedFailedVerification(userId: string, rejectionCount: number): FraudDetectionResult | null {
  if (rejectionCount < REPEATED_FAILED_VERIFICATION_THRESHOLD) return null;
  return {
    type: "REPEATED_FAILED_VERIFICATION",
    userIds: [userId],
    detail: `${rejectionCount} rejected verification attempts, at or above the ${REPEATED_FAILED_VERIFICATION_THRESHOLD}-attempt threshold.`,
  };
}
