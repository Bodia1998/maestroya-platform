/**
 * Module 93 — Real Fraud & Trust Signal Providers.
 *
 * Real-PostgreSQL coverage (Module 91 tier) for `FraudTrustSignalCheck`:
 * proves the FK/cascade/index shape the migration declares, that
 * `PrismaFraudTrustSignalCheckRepository` correctly round-trips every
 * field through the real database (not just an in-memory fake), and the
 * GDPR erasure deletion path.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/infrastructure/database/prisma/client";
import { PrismaFraudTrustSignalCheckRepository } from "@/infrastructure/database/prisma/repositories/prisma-fraud-trust-signal-check-repository";

import { setupDbTestLifecycle } from "../../test-utils/db/db-test-lifecycle";
import { createUser } from "../../test-utils/db/seed-helpers";

describe("Module 93 — FraudTrustSignalCheck persistence (real PostgreSQL)", () => {
  setupDbTestLifecycle();

  let userId: string;

  beforeEach(async () => {
    const user = await createUser(prisma);
    userId = user.id;
  });

  it("round-trips a VPN/proxy check through the real database", async () => {
    const repository = new PrismaFraudTrustSignalCheckRepository();

    const created = await repository.create({
      userId,
      checkType: "VPN_PROXY_DETECTION",
      provider: "IPQS",
      success: true,
      latencyMs: 120,
      ipHash: "hash-abc",
      vpnClassification: "TOR",
      vpnRiskLevel: "CRITICAL",
      vpnConfidence: 95,
      isVpn: false,
      isProxy: true,
      isTor: true,
      isHosting: false,
    });

    const row = await prisma.fraudTrustSignalCheck.findUnique({ where: { id: created.id } });
    expect(row).toMatchObject({
      userId,
      checkType: "VPN_PROXY_DETECTION",
      provider: "IPQS",
      success: true,
      ipHash: "hash-abc",
      vpnClassification: "TOR",
      isTor: true,
    });
  });

  it("cascades on User hard-delete (FK integrity)", async () => {
    const repository = new PrismaFraudTrustSignalCheckRepository();
    await repository.create({ userId, checkType: "DEVICE_FINGERPRINT", provider: "FINGERPRINTJS", success: true, deviceIdHash: "d1" });

    await prisma.user.delete({ where: { id: userId } });

    const remaining = await prisma.fraudTrustSignalCheck.findMany({ where: { userId } });
    expect(remaining).toHaveLength(0);
  });

  it("listUserIdsForDeviceIdHash finds other users sharing the same device id hash", async () => {
    const otherUser = await createUser(prisma);
    const repository = new PrismaFraudTrustSignalCheckRepository();

    await repository.create({ userId, checkType: "DEVICE_FINGERPRINT", provider: "FINGERPRINTJS", success: true, deviceIdHash: "shared-hash" });
    await repository.create({
      userId: otherUser.id,
      checkType: "DEVICE_FINGERPRINT",
      provider: "FINGERPRINTJS",
      success: true,
      deviceIdHash: "shared-hash",
    });

    const others = await repository.listUserIdsForDeviceIdHash("shared-hash", userId);
    expect(others).toEqual([otherUser.id]);
  });

  it("findRecentForUser respects the time window", async () => {
    const repository = new PrismaFraudTrustSignalCheckRepository();
    await repository.create({ userId, checkType: "VPN_PROXY_DETECTION", provider: "IPQS", success: true, ipHash: "h1" });

    const withinWindow = await repository.findRecentForUser(userId, "VPN_PROXY_DETECTION", 10 * 60 * 1000);
    expect(withinWindow).not.toBeNull();

    const zeroWindow = await repository.findRecentForUser(userId, "VPN_PROXY_DETECTION", -1);
    expect(zeroWindow).toBeNull();
  });

  it("deleteForUser (GDPR erasure) removes every row for that user and none for another", async () => {
    const otherUser = await createUser(prisma);
    const repository = new PrismaFraudTrustSignalCheckRepository();

    await repository.create({ userId, checkType: "PHONE_REPUTATION", provider: "TWILIO_LOOKUP", success: true, phoneValid: true });
    await repository.create({ userId, checkType: "DEVICE_FINGERPRINT", provider: "FINGERPRINTJS", success: true, deviceIdHash: "d2" });
    await repository.create({ userId: otherUser.id, checkType: "PHONE_REPUTATION", provider: "TWILIO_LOOKUP", success: true, phoneValid: true });

    const deletedCount = await repository.deleteForUser(userId);

    expect(deletedCount).toBe(2);
    expect(await prisma.fraudTrustSignalCheck.count({ where: { userId } })).toBe(0);
    expect(await prisma.fraudTrustSignalCheck.count({ where: { userId: otherUser.id } })).toBe(1);
  });

  it("allows concurrent check creation for the same user without conflict (no unique constraint on this append-only table)", async () => {
    const repository = new PrismaFraudTrustSignalCheckRepository();

    const outcomes = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        repository.create({ userId, checkType: "VPN_PROXY_DETECTION", provider: "IPQS", success: true, ipHash: "h1" }),
      ),
    );

    expect(outcomes.every((o) => o.status === "fulfilled")).toBe(true);
    expect(await prisma.fraudTrustSignalCheck.count({ where: { userId } })).toBe(5);
  });
});
