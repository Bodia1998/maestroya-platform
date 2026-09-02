import { createHash } from "node:crypto";

import type { DeviceFingerprintProvider } from "@/application/ports/device-fingerprint-provider";
import type { VpnProxyDetectionProvider } from "@/application/ports/vpn-proxy-detection-provider";
import type { PhoneReputationProvider } from "@/application/ports/phone-reputation-provider";
import type { FraudTrustSignalCheckRepository } from "@/domain/repositories/fraud-trust-signal-check-repository";
import type { IdentifierCluster, VpnProxyRiskInput } from "@/domain/services/fraud-detection-rules";
import { logger } from "@/infrastructure/observability/logger";
import { maskPhoneForLogging } from "@/infrastructure/trust-integrity/phone-masking";
import type { DetectFraudSignalsUseCase } from "@/application/use-cases/trust-integrity/detect-fraud-signals.use-case";

/**
 * Module 93 — Real Fraud & Trust Signal Providers: requirement #11 — the
 * orchestration use case that closes the gap the investigation found
 * (MODULE_93_IMPLEMENTATION_REPORT.md §2): Module 65's three provider
 * ports (`DeviceFingerprintProvider`/`VpnProxyDetectionProvider`/
 * `PhoneReputationProvider`) existed, and `fraud-detection-rules.ts`'s
 * `detectSameDeviceClusters`/`detectHighRiskVpnProxyAccess` existed, but
 * nothing in the real request path ever called the providers or fed
 * their output to the detectors. This class is that missing link:
 *
 *   caller (a Server Action, e.g. registerAction) resolves ipHash/ip
 *     from request headers, and whatever rawDeviceSignal/phoneE164 it has
 *       ↓
 *   CollectFraudTrustSignalsUseCase.execute (this class)
 *       ↓
 *   real provider adapters (or their Null fallback)
 *       ↓
 *   FraudTrustSignalCheck persisted (data-minimized — see that model's
 *     own doc comment)
 *       ↓
 *   device-id/VPN-risk findings handed to the existing
 *     DetectFraudSignalsUseCase — reused as-is, never duplicated (module
 *     brief requirement #12) — which persists any resulting FraudSignal,
 *     publishes FraudDetected, and records the Risk Score behavior
 *     signal, exactly as it already does for every other detector.
 *
 * ## Never blocks the caller
 * Every provider call is individually try/caught — one provider's
 * failure (timeout, 5xx, malformed response — anything surfaced as
 * `FraudTrustProviderError`, or any other unexpected throw) is logged and
 * recorded as an unsuccessful `FraudTrustSignalCheck` row, never rethrown.
 * `execute` itself therefore never throws for a provider-side reason —
 * only for a genuine bug in this class or its dependencies — so a caller
 * (registration, professional onboarding) can safely call this
 * best-effort, after its own primary action already succeeded, without
 * risking that a fraud-provider outage blocks the user (module brief
 * requirement #10).
 *
 * ## Cost protection (requirement #16)
 * Before calling the device-fingerprint or VPN/proxy provider, this class
 * checks `FraudTrustSignalCheckRepository.findRecentForUser` and skips a
 * duplicate provider call for the same user within `DEDUPE_WINDOW_MS` —
 * covers a double form submission or a retried Server Action, not a
 * general cache (a genuinely new request past the window always re-checks
 * — this is a duplicate-call guard, not a staleness-tolerant cache, so it
 * never risks a stale security decision). Phone reputation is not
 * deduped here — a phone number rarely repeats within one onboarding flow
 * and Twilio Lookup is comparatively inexpensive; callers that do repeat
 * lookups for the same number in a tight loop should dedupe at the call
 * site instead.
 */
const DEDUPE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

export interface CollectFraudTrustSignalsInput {
  userId: string;
  deviceSignal?: { rawSignal: unknown };
  vpnProxySignal?: { ipHash: string; ip: string };
  phoneSignal?: { phoneE164: string };
}

export interface FraudTrustSignalOutcome {
  attempted: boolean;
  success: boolean;
  provider: string;
  skippedAsDuplicate?: boolean;
}

export interface CollectFraudTrustSignalsResult {
  device: FraudTrustSignalOutcome;
  vpnProxy: FraudTrustSignalOutcome;
  phone: FraudTrustSignalOutcome;
  fraudSignalsDetected: number;
}

const NOT_ATTEMPTED: FraudTrustSignalOutcome = { attempted: false, success: false, provider: "NONE" };

export class CollectFraudTrustSignalsUseCase {
  constructor(
    private readonly deviceFingerprintProvider: DeviceFingerprintProvider,
    private readonly vpnProxyDetectionProvider: VpnProxyDetectionProvider,
    private readonly phoneReputationProvider: PhoneReputationProvider,
    private readonly signalChecks: FraudTrustSignalCheckRepository,
    private readonly detectFraudSignals: DetectFraudSignalsUseCase,
  ) {}

  async execute(input: CollectFraudTrustSignalsInput): Promise<CollectFraudTrustSignalsResult> {
    const deviceClusters: IdentifierCluster[] = [];
    const vpnProxyRiskFindings: VpnProxyRiskInput[] = [];

    const device = input.deviceSignal
      ? await this.collectDevice(input.userId, input.deviceSignal.rawSignal, deviceClusters)
      : NOT_ATTEMPTED;

    const vpnProxy = input.vpnProxySignal
      ? await this.collectVpnProxy(input.userId, input.vpnProxySignal, vpnProxyRiskFindings)
      : NOT_ATTEMPTED;

    const phone = input.phoneSignal ? await this.collectPhone(input.userId, input.phoneSignal.phoneE164) : NOT_ATTEMPTED;

    const fraudSignalsDetected =
      deviceClusters.length > 0 || vpnProxyRiskFindings.length > 0
        ? await this.detectFraudSignals.execute({ deviceClusters, vpnProxyRiskFindings })
        : 0;

    return { device, vpnProxy, phone, fraudSignalsDetected };
  }

  private async collectDevice(
    userId: string,
    rawSignal: unknown,
    deviceClusters: IdentifierCluster[],
  ): Promise<FraudTrustSignalOutcome> {
    const recent = await this.signalChecks.findRecentForUser(userId, "DEVICE_FINGERPRINT", DEDUPE_WINDOW_MS);
    if (recent) {
      return { attempted: true, success: recent.success, provider: recent.provider, skippedAsDuplicate: true };
    }

    const startedAt = Date.now();
    try {
      const fingerprint = await this.deviceFingerprintProvider.fingerprint(rawSignal);
      const deviceIdHash = createHash("sha256").update(fingerprint.deviceId).digest("hex");

      await this.signalChecks.create({
        userId,
        checkType: "DEVICE_FINGERPRINT",
        provider: fingerprint.provider,
        success: true,
        latencyMs: Date.now() - startedAt,
        deviceIdHash,
        deviceConfidence: fingerprint.confidence,
      });

      // Only a real (non-NULL) provider's deviceId is trustworthy enough
      // to cluster accounts on — the Null provider's hash is derived from
      // whatever JSON shape happened to be sent, not a genuine device
      // identity, and would produce false clusters for e.g. two identical
      // empty payloads.
      if (fingerprint.provider !== "NULL") {
        const otherUserIds = await this.signalChecks.listUserIdsForDeviceIdHash(deviceIdHash, userId);
        if (otherUserIds.length > 0) {
          deviceClusters.push({ identifierHash: deviceIdHash, userIds: [userId, ...otherUserIds] });
        }
      }

      return { attempted: true, success: true, provider: fingerprint.provider };
    } catch (error) {
      return this.recordFailure(userId, "DEVICE_FINGERPRINT", startedAt, error);
    }
  }

  private async collectVpnProxy(
    userId: string,
    signal: { ipHash: string; ip: string },
    vpnProxyRiskFindings: VpnProxyRiskInput[],
  ): Promise<FraudTrustSignalOutcome> {
    const recent = await this.signalChecks.findRecentForUser(userId, "VPN_PROXY_DETECTION", DEDUPE_WINDOW_MS);
    if (recent) {
      return { attempted: true, success: recent.success, provider: recent.provider, skippedAsDuplicate: true };
    }

    const startedAt = Date.now();
    try {
      const classification = await this.vpnProxyDetectionProvider.classify(signal);

      await this.signalChecks.create({
        userId,
        checkType: "VPN_PROXY_DETECTION",
        provider: classification.provider,
        success: true,
        latencyMs: Date.now() - startedAt,
        ipHash: signal.ipHash,
        vpnClassification: classification.classification,
        vpnRiskLevel: classification.riskLevel,
        vpnConfidence: classification.confidence,
        isVpn: classification.isVpn,
        isProxy: classification.isProxy,
        isTor: classification.isTor,
        isHosting: classification.isHosting,
      });

      if (classification.provider !== "NULL") {
        vpnProxyRiskFindings.push({
          userId,
          riskLevel: classification.riskLevel,
          isTor: classification.isTor,
          isHosting: classification.isHosting,
        });
      }

      return { attempted: true, success: true, provider: classification.provider };
    } catch (error) {
      return this.recordFailure(userId, "VPN_PROXY_DETECTION", startedAt, error, { ipHash: signal.ipHash });
    }
  }

  private async collectPhone(userId: string, phoneE164: string): Promise<FraudTrustSignalOutcome> {
    const startedAt = Date.now();
    try {
      const reputation = await this.phoneReputationProvider.lookup(phoneE164);

      await this.signalChecks.create({
        userId,
        checkType: "PHONE_REPUTATION",
        provider: reputation.provider,
        success: true,
        latencyMs: Date.now() - startedAt,
        phoneValid: reputation.valid,
        phoneLineType: reputation.lineType,
        phoneRiskScore: reputation.riskScore,
      });

      return { attempted: true, success: true, provider: reputation.provider };
    } catch (error) {
      return this.recordFailure(userId, "PHONE_REPUTATION", startedAt, error, {
        phone: maskPhoneForLogging(phoneE164),
      });
    }
  }

  private async recordFailure(
    userId: string,
    checkType: "DEVICE_FINGERPRINT" | "VPN_PROXY_DETECTION" | "PHONE_REPUTATION",
    startedAt: number,
    error: unknown,
    extraLogFields?: Record<string, unknown>,
  ): Promise<FraudTrustSignalOutcome> {
    const provider = error instanceof Object && "provider" in error ? String((error as { provider: unknown }).provider) : "UNKNOWN";

    logger.warn("fraud_signal_collection_failed", {
      userId,
      checkType,
      provider,
      error: error instanceof Error ? error.message : String(error),
      ...extraLogFields,
    });

    await this.signalChecks.create({
      userId,
      checkType,
      provider,
      success: false,
      latencyMs: Date.now() - startedAt,
    });

    return { attempted: true, success: false, provider };
  }
}
