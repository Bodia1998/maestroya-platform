import "server-only";

import { headers } from "next/headers";

import { hashIp, truncateUserAgent } from "@/domain/services/security-key";
import { env } from "@/infrastructure/config/env";

/**
 * Security & Anti-Abuse module (Module 24): the single place Server
 * Actions read "who/what is calling, for anti-abuse purposes" from — same
 * "one seam" convention as rbac.ts's `getCurrentUser`. No middleware.ts
 * exists in this codebase (confirmed at audit time); this project runs
 * behind whatever reverse proxy/platform sets `x-forwarded-for` (Vercel,
 * most standard setups) — see docs/MODULE_24_SECURITY_ANTI_ABUSE.md for
 * the deployment assumption this depends on.
 *
 * Reuses `AUTH_SECRET` as the IP-hashing pepper rather than introducing a
 * new required env var — it's already a server-only secret present in
 * every environment this app runs in (see infrastructure/config/env.ts),
 * and its blast radius here is limited to "recognise the same IP acted
 * again", not authentication itself.
 */
export async function getClientIpHash(): Promise<string | null> {
  const headerList = await headers();
  const forwardedFor = headerList.get("x-forwarded-for");
  const rawIp = forwardedFor?.split(",")[0]?.trim() || headerList.get("x-real-ip")?.trim();
  if (!rawIp) return null;
  return hashIp(rawIp, env.AUTH_SECRET);
}

/**
 * Module 93 — Real Fraud & Trust Signal Providers: the one deliberate
 * exception to this codebase's "never resolve/pass around a raw IP, only
 * `ipHash`" rule (see `getClientIpHash`'s own doc comment above) — a real
 * `VpnProxyDetectionProvider` (IPQualityScore) must be queried by the raw
 * IP address itself; a keyed hash cannot be reversed back into one (see
 * `VpnProxyDetectionProvider.classify`'s own doc comment for the full
 * reasoning). Every caller of this function must: (1) call it only
 * immediately before passing the result straight into
 * `CollectFraudTrustSignalsUseCase`'s `vpnProxySignal.ip`, (2) never log
 * it, never persist it, never pass it to any other layer. The adapter
 * itself (`IpqsVpnProxyDetectionProvider`) sends it over HTTPS to IPQS
 * for this one call and never stores it either — see that class's own
 * "Privacy" section.
 */
export async function getClientIp(): Promise<string | null> {
  const headerList = await headers();
  const forwardedFor = headerList.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() || headerList.get("x-real-ip")?.trim() || null;
}

export async function getClientUserAgent(): Promise<string | null> {
  const headerList = await headers();
  return truncateUserAgent(headerList.get("user-agent"));
}
