export const FRAUD_SIGNAL_TYPE_VALUES = [
  "MULTIPLE_ACCOUNTS",
  "SAME_PHONE",
  "SAME_IBAN",
  "SAME_STRIPE_ACCOUNT",
  "SAME_DEVICE",
  "DUPLICATE_IDENTITY",
  "SUSPICIOUS_REGISTRATION_PATTERN",
  "REPEATED_FAILED_VERIFICATION",
  "FAKE_REVIEW_PATTERN",
  "SPAM_ACTIVITY",
  "SUSPICIOUS_PRICING",
  "BOOKING_ABUSE",
  "PAYMENT_ABUSE",
  // Module 67 — Trust & Integrity Completion Risk Detection: see
  // premature-completion-detection-rules.ts / completion-dispute-conflict-
  // detection-rules.ts for what each of these two represents.
  "PREMATURE_JOB_COMPLETION",
  "COMPLETION_DURING_ACTIVE_DISPUTE",
  // Module 93 — Real Fraud & Trust Signal Providers: see
  // fraud-detection-rules.ts's detectHighRiskVpnProxyAccess.
  "SUSPICIOUS_VPN_PROXY_ACCESS",
] as const;
export type FraudSignalType = (typeof FRAUD_SIGNAL_TYPE_VALUES)[number];

export const FRAUD_SIGNAL_STATUS_VALUES = ["OPEN", "REVIEWED", "DISMISSED", "CONFIRMED"] as const;
export type FraudSignalStatusValue = (typeof FRAUD_SIGNAL_STATUS_VALUES)[number];

/**
 * Module 65 — Trust & Integrity System: repository interface for
 * `FraudSignal`, the general-purpose (any user) counterpart to Module 61's
 * `PartnerFraudFlagRepository` — see that file's own doc comment for the
 * shared "flagging is always advisory" convention this mirrors.
 */
export interface FraudSignalRecord {
  id: string;
  userId: string;
  type: FraudSignalType;
  status: FraudSignalStatusValue;
  detail: string;
  relatedUserIds: string[];
  resolvedAt: Date | null;
  resolvedByUserId: string | null;
  resolution: string | null;
  createdAt: Date;
}

export interface CreateFraudSignalData {
  userId: string;
  type: FraudSignalType;
  detail: string;
  relatedUserIds?: string[];
}

export interface FraudSignalRepository {
  create(data: CreateFraudSignalData): Promise<FraudSignalRecord>;
  listForUser(userId: string): Promise<FraudSignalRecord[]>;
  listOpen(): Promise<FraudSignalRecord[]>;
  resolve(
    id: string,
    data: { status: "REVIEWED" | "DISMISSED" | "CONFIRMED"; resolvedByUserId: string; resolution: string },
  ): Promise<FraudSignalRecord>;
  countOpenForUser(userId: string): Promise<number>;
  countAll(): Promise<number>;
  countByType(type: FraudSignalType): Promise<number>;
}
