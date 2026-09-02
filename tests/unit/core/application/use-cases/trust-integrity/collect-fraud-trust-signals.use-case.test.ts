import { describe, expect, it, vi } from "vitest";

import { CollectFraudTrustSignalsUseCase } from "@/application/use-cases/trust-integrity/collect-fraud-trust-signals.use-case";
import { FraudTrustProviderError } from "@/domain/errors/domain-error";
import type { DeviceFingerprintProvider } from "@/application/ports/device-fingerprint-provider";
import type { VpnProxyDetectionProvider } from "@/application/ports/vpn-proxy-detection-provider";
import type { PhoneReputationProvider } from "@/application/ports/phone-reputation-provider";
import type { FraudTrustSignalCheckRepository } from "@/domain/repositories/fraud-trust-signal-check-repository";
import type { DetectFraudSignalsUseCase } from "@/application/use-cases/trust-integrity/detect-fraud-signals.use-case";

function makeSignalChecks(overrides: Partial<FraudTrustSignalCheckRepository> = {}): FraudTrustSignalCheckRepository {
  return {
    create: vi.fn().mockImplementation(async (data) => ({ id: "check_1", createdAt: new Date(), ...data })),
    findRecentForUser: vi.fn().mockResolvedValue(null),
    listUserIdsForDeviceIdHash: vi.fn().mockResolvedValue([]),
    deleteForUser: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

describe("CollectFraudTrustSignalsUseCase (Module 93)", () => {
  it("does nothing for a dimension with no input", async () => {
    const signalChecks = makeSignalChecks();
    const detectFraudSignals = { execute: vi.fn() } as unknown as DetectFraudSignalsUseCase;
    const useCase = new CollectFraudTrustSignalsUseCase(
      {} as DeviceFingerprintProvider,
      {} as VpnProxyDetectionProvider,
      {} as PhoneReputationProvider,
      signalChecks,
      detectFraudSignals,
    );

    const result = await useCase.execute({ userId: "u1" });

    expect(result.device.attempted).toBe(false);
    expect(result.vpnProxy.attempted).toBe(false);
    expect(result.phone.attempted).toBe(false);
    expect(detectFraudSignals.execute).not.toHaveBeenCalled();
  });

  it("persists a successful device-fingerprint check and never lets a provider outage propagate", async () => {
    const signalChecks = makeSignalChecks();
    const deviceProvider: DeviceFingerprintProvider = {
      name: "FINGERPRINTJS",
      fingerprint: vi.fn().mockResolvedValue({
        deviceId: "visitor_1",
        browserFingerprint: null,
        timezone: null,
        language: null,
        operatingSystem: null,
        platform: null,
        provider: "FINGERPRINTJS",
        confidence: 90,
        checkedAt: new Date(),
      }),
    };
    const detectFraudSignals = { execute: vi.fn().mockResolvedValue(0) } as unknown as DetectFraudSignalsUseCase;
    const useCase = new CollectFraudTrustSignalsUseCase(
      deviceProvider,
      {} as VpnProxyDetectionProvider,
      {} as PhoneReputationProvider,
      signalChecks,
      detectFraudSignals,
    );

    const result = await useCase.execute({ userId: "u1", deviceSignal: { rawSignal: { requestId: "req_1" } } });

    expect(result.device).toMatchObject({ attempted: true, success: true, provider: "FINGERPRINTJS" });
    expect(signalChecks.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", checkType: "DEVICE_FINGERPRINT", success: true }),
    );
  });

  it("never throws when the device provider fails, and records an unsuccessful check", async () => {
    const signalChecks = makeSignalChecks();
    const deviceProvider: DeviceFingerprintProvider = {
      name: "FINGERPRINTJS",
      fingerprint: vi.fn().mockRejectedValue(new FraudTrustProviderError("DEVICE_FINGERPRINT", "FINGERPRINTJS", "boom", true)),
    };
    const detectFraudSignals = { execute: vi.fn().mockResolvedValue(0) } as unknown as DetectFraudSignalsUseCase;
    const useCase = new CollectFraudTrustSignalsUseCase(
      deviceProvider,
      {} as VpnProxyDetectionProvider,
      {} as PhoneReputationProvider,
      signalChecks,
      detectFraudSignals,
    );

    const result = await useCase.execute({ userId: "u1", deviceSignal: { rawSignal: { requestId: "req_1" } } });

    expect(result.device).toMatchObject({ attempted: true, success: false });
    expect(signalChecks.create).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it("skips a duplicate device-fingerprint call within the dedupe window", async () => {
    const signalChecks = makeSignalChecks({
      findRecentForUser: vi.fn().mockResolvedValue({ id: "prev", provider: "FINGERPRINTJS", success: true, createdAt: new Date() }),
    });
    const deviceProvider: DeviceFingerprintProvider = { name: "FINGERPRINTJS", fingerprint: vi.fn() };
    const detectFraudSignals = { execute: vi.fn().mockResolvedValue(0) } as unknown as DetectFraudSignalsUseCase;
    const useCase = new CollectFraudTrustSignalsUseCase(
      deviceProvider,
      {} as VpnProxyDetectionProvider,
      {} as PhoneReputationProvider,
      signalChecks,
      detectFraudSignals,
    );

    const result = await useCase.execute({ userId: "u1", deviceSignal: { rawSignal: {} } });

    expect(deviceProvider.fingerprint).not.toHaveBeenCalled();
    expect(result.device.skippedAsDuplicate).toBe(true);
  });

  it("feeds a high-risk VPN finding to DetectFraudSignalsUseCase", async () => {
    const signalChecks = makeSignalChecks();
    const vpnProvider: VpnProxyDetectionProvider = {
      name: "IPQS",
      classify: vi.fn().mockResolvedValue({
        classification: "TOR",
        confidence: 95,
        isVpn: false,
        isProxy: true,
        isTor: true,
        isHosting: false,
        riskLevel: "CRITICAL",
        provider: "IPQS",
        checkedAt: new Date(),
      }),
    };
    const detectFraudSignals = { execute: vi.fn().mockResolvedValue(1) } as unknown as DetectFraudSignalsUseCase;
    const useCase = new CollectFraudTrustSignalsUseCase(
      {} as DeviceFingerprintProvider,
      vpnProvider,
      {} as PhoneReputationProvider,
      signalChecks,
      detectFraudSignals,
    );

    const result = await useCase.execute({ userId: "u1", vpnProxySignal: { ipHash: "h1", ip: "1.2.3.4" } });

    expect(detectFraudSignals.execute).toHaveBeenCalledWith(
      expect.objectContaining({ vpnProxyRiskFindings: [{ userId: "u1", riskLevel: "CRITICAL", isTor: true, isHosting: false }] }),
    );
    expect(result.fraudSignalsDetected).toBe(1);
  });

  it("does not feed a finding when the provider is the Null fallback (signal unavailable, not fraud)", async () => {
    const signalChecks = makeSignalChecks();
    const vpnProvider: VpnProxyDetectionProvider = {
      name: "NULL",
      classify: vi.fn().mockResolvedValue({
        classification: "UNKNOWN",
        confidence: 0,
        isVpn: null,
        isProxy: null,
        isTor: null,
        isHosting: null,
        riskLevel: "UNKNOWN",
        provider: "NULL",
        checkedAt: new Date(),
      }),
    };
    const detectFraudSignals = { execute: vi.fn().mockResolvedValue(0) } as unknown as DetectFraudSignalsUseCase;
    const useCase = new CollectFraudTrustSignalsUseCase(
      {} as DeviceFingerprintProvider,
      vpnProvider,
      {} as PhoneReputationProvider,
      signalChecks,
      detectFraudSignals,
    );

    await useCase.execute({ userId: "u1", vpnProxySignal: { ipHash: "h1", ip: "1.2.3.4" } });

    expect(detectFraudSignals.execute).not.toHaveBeenCalled();
  });

  it("clusters device ids shared with other users and feeds DetectFraudSignalsUseCase", async () => {
    const signalChecks = makeSignalChecks({ listUserIdsForDeviceIdHash: vi.fn().mockResolvedValue(["u2", "u3"]) });
    const deviceProvider: DeviceFingerprintProvider = {
      name: "FINGERPRINTJS",
      fingerprint: vi.fn().mockResolvedValue({
        deviceId: "visitor_shared",
        browserFingerprint: null,
        timezone: null,
        language: null,
        operatingSystem: null,
        platform: null,
        provider: "FINGERPRINTJS",
        confidence: 80,
        checkedAt: new Date(),
      }),
    };
    const detectFraudSignals = { execute: vi.fn().mockResolvedValue(1) } as unknown as DetectFraudSignalsUseCase;
    const useCase = new CollectFraudTrustSignalsUseCase(
      deviceProvider,
      {} as VpnProxyDetectionProvider,
      {} as PhoneReputationProvider,
      signalChecks,
      detectFraudSignals,
    );

    const result = await useCase.execute({ userId: "u1", deviceSignal: { rawSignal: { requestId: "req_1" } } });

    expect(detectFraudSignals.execute).toHaveBeenCalledWith(
      expect.objectContaining({ deviceClusters: [expect.objectContaining({ userIds: ["u1", "u2", "u3"] })] }),
    );
    expect(result.fraudSignalsDetected).toBe(1);
  });

  it("never stores the phone number, only the provider's findings", async () => {
    const signalChecks = makeSignalChecks();
    const phoneProvider: PhoneReputationProvider = {
      name: "TWILIO_LOOKUP",
      lookup: vi.fn().mockResolvedValue({
        valid: true,
        lineType: "VOIP",
        riskScore: 55,
        countryCode: "ES",
        carrierName: "Carrier",
        provider: "TWILIO_LOOKUP",
        checkedAt: new Date(),
      }),
    };
    const detectFraudSignals = { execute: vi.fn().mockResolvedValue(0) } as unknown as DetectFraudSignalsUseCase;
    const useCase = new CollectFraudTrustSignalsUseCase(
      {} as DeviceFingerprintProvider,
      {} as VpnProxyDetectionProvider,
      phoneProvider,
      signalChecks,
      detectFraudSignals,
    );

    await useCase.execute({ userId: "u1", phoneSignal: { phoneE164: "+34600123456" } });

    const mockCalls = (signalChecks.create as ReturnType<typeof vi.fn>).mock.calls;
    const createCall = mockCalls[0]?.[0];
    expect(JSON.stringify(createCall)).not.toContain("600123456");
    expect(createCall).toMatchObject({ phoneValid: true, phoneLineType: "VOIP", phoneRiskScore: 55 });
  });
});
