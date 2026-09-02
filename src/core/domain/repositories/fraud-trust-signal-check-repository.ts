export const FRAUD_TRUST_SIGNAL_CHECK_TYPE_VALUES = [
  "DEVICE_FINGERPRINT",
  "VPN_PROXY_DETECTION",
  "PHONE_REPUTATION",
] as const;
export type FraudTrustSignalCheckType = (typeof FRAUD_TRUST_SIGNAL_CHECK_TYPE_VALUES)[number];

/**
 * Module 93 — Real Fraud & Trust Signal Providers: repository interface
 * for `FraudTrustSignalCheck` — see that model's own doc comment in
 * schema.prisma for what it records and why (every real provider call
 * `CollectFraudTrustSignalsUseCase` makes, data-minimized to hashes/
 * classifications/small integers, never raw PII).
 */
export interface CreateFraudTrustSignalCheckData {
  userId: string;
  checkType: FraudTrustSignalCheckType;
  provider: string;
  success: boolean;
  latencyMs?: number | null;
  deviceIdHash?: string | null;
  deviceConfidence?: number | null;
  ipHash?: string | null;
  vpnClassification?: string | null;
  vpnRiskLevel?: string | null;
  vpnConfidence?: number | null;
  isVpn?: boolean | null;
  isProxy?: boolean | null;
  isTor?: boolean | null;
  isHosting?: boolean | null;
  phoneValid?: boolean | null;
  phoneLineType?: string | null;
  phoneRiskScore?: number | null;
}

export interface FraudTrustSignalCheckRecord extends CreateFraudTrustSignalCheckData {
  id: string;
  createdAt: Date;
}

export interface FraudTrustSignalCheckRepository {
  create(data: CreateFraudTrustSignalCheckData): Promise<FraudTrustSignalCheckRecord>;
  /** Requirement #16 (rate-limit/cost protection): the most recent
   *  DEVICE_FINGERPRINT/VPN_PROXY_DETECTION check for this user within
   *  `withinMs`, if any — `CollectFraudTrustSignalsUseCase` uses this to
   *  skip a duplicate provider call for the same user within a short
   *  window (e.g. a form resubmission), never to suppress a check that
   *  would otherwise run. */
  findRecentForUser(
    userId: string,
    checkType: FraudTrustSignalCheckType,
    withinMs: number,
    now?: Date,
  ): Promise<FraudTrustSignalCheckRecord | null>;
  /** Every user id (besides `excludingUserId`) that has a
   *  DEVICE_FINGERPRINT check recording the same `deviceIdHash` — the
   *  read `DetectFraudSignalsUseCase`'s `detectSameDeviceClusters` needs
   *  to turn a repeated device id into an `IdentifierCluster`. */
  listUserIdsForDeviceIdHash(deviceIdHash: string, excludingUserId: string): Promise<string[]>;
  /** GDPR erasure (module brief requirement #14) — hard-deletes every row
   *  for `userId`. Called from `ExecuteAccountErasureUseCase`. */
  deleteForUser(userId: string): Promise<number>;
}
