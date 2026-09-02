-- Module 93 — Real Fraud & Trust Signal Providers.
-- Adds fraud_trust_signal_checks: append-only record of every real
-- device-fingerprint/VPN-proxy/phone-reputation provider call and its
-- (data-minimized — hash/classification/small-int only, never raw PII)
-- outcome. See schema.prisma's own doc comment on FraudTrustSignalCheck.

CREATE TYPE "FraudTrustSignalCheckType" AS ENUM ('DEVICE_FINGERPRINT', 'VPN_PROXY_DETECTION', 'PHONE_REPUTATION');

CREATE TABLE "fraud_trust_signal_checks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "checkType" "FraudTrustSignalCheckType" NOT NULL,
    "provider" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "latencyMs" INTEGER,
    "deviceIdHash" TEXT,
    "deviceConfidence" INTEGER,
    "ipHash" TEXT,
    "vpnClassification" TEXT,
    "vpnRiskLevel" TEXT,
    "vpnConfidence" INTEGER,
    "isVpn" BOOLEAN,
    "isProxy" BOOLEAN,
    "isTor" BOOLEAN,
    "isHosting" BOOLEAN,
    "phoneValid" BOOLEAN,
    "phoneLineType" TEXT,
    "phoneRiskScore" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fraud_trust_signal_checks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fraud_trust_signal_checks_userId_idx" ON "fraud_trust_signal_checks"("userId");
CREATE INDEX "fraud_trust_signal_checks_checkType_idx" ON "fraud_trust_signal_checks"("checkType");
CREATE INDEX "fraud_trust_signal_checks_deviceIdHash_idx" ON "fraud_trust_signal_checks"("deviceIdHash");
CREATE INDEX "fraud_trust_signal_checks_ipHash_idx" ON "fraud_trust_signal_checks"("ipHash");
CREATE INDEX "fraud_trust_signal_checks_createdAt_idx" ON "fraud_trust_signal_checks"("createdAt");

ALTER TABLE "fraud_trust_signal_checks" ADD CONSTRAINT "fraud_trust_signal_checks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Module 93 — Real Fraud & Trust Signal Providers: new FraudSignalType
-- value produced by detectHighRiskVpnProxyAccess (fraud-detection-rules.ts).
ALTER TYPE "FraudSignalType" ADD VALUE 'SUSPICIOUS_VPN_PROXY_ACCESS';
