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

export async function getClientUserAgent(): Promise<string | null> {
  const headerList = await headers();
  return truncateUserAgent(headerList.get("user-agent"));
}
