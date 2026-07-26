import "server-only";

import { PrismaAdapter } from "@auth/prisma-adapter";
import type { NextAuthConfig } from "next-auth";
import Apple from "next-auth/providers/apple";
import Credentials from "next-auth/providers/credentials";
import Facebook from "next-auth/providers/facebook";
import Google from "next-auth/providers/google";

import { prisma } from "@/infrastructure/database/prisma/client";
import { env } from "@/infrastructure/config/env";
import { verifyPassword } from "@/infrastructure/auth/password";
import { getClientIpHash } from "@/infrastructure/auth/request-context";
import { PrismaUserRepository } from "@/infrastructure/database/prisma/repositories/prisma-user-repository";
import { loginSchema } from "@/application/dto/auth.dto";
import { RateLimitedError, AccountRestrictedError } from "@/domain/errors/domain-error";
import { makeAntiAbuseService } from "@/application/use-cases/security/compose";

const users = new PrismaUserRepository();

/**
 * Auth abuse (Module 24, threat A) — brute-force/credential-stuffing
 * protection lives here, inside the Credentials provider's own
 * `authorize()`, rather than a separate loginAction wrapper: this
 * `authorize` callback (invoked by Auth.js's own `/api/auth/callback/
 * credentials` route) *is* the only code path a login attempt ever goes
 * through in this codebase — there is no separate Server Action to wrap.
 *
 * Enforced *before* any password comparison, keyed by email and by IP,
 * both enforced (see rate-limit-policies.ts). A breach of the email-keyed
 * policy also auto-escalates to a short TEMPORARILY_BLOCKED
 * AccountRestriction for that user (see AntiAbuseService.enforceRateLimit's
 * `autoRestrict` — auto-expiring, never permanent) so even a slow,
 * distributed attacker who spreads attempts to just barely avoid the
 * IP-based window still gets locked out on the account itself.
 *
 * `authorize()` must return `null` (not throw) for every *credential*
 * failure — that's Auth.js's own contract, and this file already relied
 * on it for "unknown email"/"wrong password"/"suspended". Rate-limit and
 * restriction rejections deliberately still return `null` too (not a
 * distinguishable error) — a different response shape for "rate limited"
 * vs "wrong password" would itself leak information to an attacker probing
 * the boundary.
 */
async function isLoginBlocked(email: string): Promise<boolean> {
  const antiAbuse = makeAntiAbuseService();
  const ipHash = await getClientIpHash();

  try {
    await antiAbuse.enforceRateLimit("LOGIN_BY_EMAIL", { resource: email }, "RATE_LIMIT_TRIGGERED");
    if (ipHash) {
      await antiAbuse.enforceRateLimit("LOGIN_BY_IP", { ipHash }, "RATE_LIMIT_TRIGGERED");
    }
  } catch (error) {
    if (error instanceof RateLimitedError) {
      const existing = await users.findByEmail(email);
      if (existing) {
        await antiAbuse.escalateToTemporaryBlock(existing.id, {
          reason: "FAILED_LOGIN_BURST",
          durationMs: 30 * 60 * 1000,
        });
      }
      return true;
    }
    throw error;
  }

  const existing = await users.findByEmail(email);
  if (existing) {
    try {
      await antiAbuse.assertNotBlocked(existing.id);
    } catch (error) {
      if (error instanceof AccountRestrictedError) return true;
      throw error;
    }
  }

  return false;
}

const DEFAULT_SESSION_MAX_AGE_SECONDS = 24 * 60 * 60; // 1 day
const REMEMBER_ME_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

/**
 * Auth.js v5 configuration.
 *
 * Session strategy is "jwt", not "database" — this isn't a style choice,
 * it's required: the Credentials provider (email+password) is
 * incompatible with Auth.js's "database" session strategy. The
 * PrismaAdapter stays wired up regardless, because it's still needed for
 * OAuth account linking (Google/Apple/Facebook) even under the JWT
 * strategy — that combination (adapter + jwt sessions, for mixing OAuth
 * and Credentials) is Auth.js's documented pattern for exactly this case.
 *
 * "Remember me" and the RefreshToken table (see prisma/schema.prisma)
 * are two different mechanisms working together: the JWT session cookie
 * itself gets a longer maxAge when rememberMe is checked (handled below
 * in the jwt callback); RefreshToken is the separate, server-revocable
 * long-lived credential (sign out everywhere, force-expire on password
 * reset — see ResetPasswordUseCase) that a future mobile/API client would
 * use instead of a browser cookie.
 */
export const authConfig: NextAuthConfig = {
  adapter: PrismaAdapter(prisma),
  // Auth.js v5 refuses requests whose Host header doesn't match a trusted
  // value unless `trustHost` is set — Vercel's own platform integration
  // sets this automatically, but any other production host (Docker/a VM
  // behind nginx or another reverse proxy — see the production Dockerfile
  // and docs/MODULE_25_PRODUCTION_INFRASTRUCTURE.md) needs it set
  // explicitly, or every sign-in would fail with an UntrustedHost error.
  // Controlled by `AUTH_TRUST_HOST` (defaults to enabled) rather than
  // hardcoded so a deployment that fronts this app with its own strict
  // Host-validating proxy can opt out.
  trustHost: env.AUTH_TRUST_HOST,
  session: {
    strategy: "jwt",
    maxAge: DEFAULT_SESSION_MAX_AGE_SECONDS,
  },
  pages: {
    signIn: "/auth/login",
    error: "/auth/login",
  },
  providers: [
    Google({
      clientId: env.AUTH_GOOGLE_ID,
      clientSecret: env.AUTH_GOOGLE_SECRET,
    }),
    Apple({
      clientId: env.AUTH_APPLE_ID,
      clientSecret: env.AUTH_APPLE_SECRET,
    }),
    Facebook({
      clientId: env.AUTH_FACEBOOK_ID,
      clientSecret: env.AUTH_FACEBOOK_SECRET,
    }),
    Credentials({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        rememberMe: { label: "Remember me", type: "text" },
      },
      async authorize(rawCredentials) {
        const parsed = loginSchema.safeParse({
          email: rawCredentials?.email,
          password: rawCredentials?.password,
          rememberMe: rawCredentials?.rememberMe === "true",
        });
        if (!parsed.success) return null;

        const antiAbuse = makeAntiAbuseService();
        const ipHash = await getClientIpHash();

        // Rate-limit/temporary-block check runs before any password
        // comparison — see isLoginBlocked's own doc comment.
        if (await isLoginBlocked(parsed.data.email)) {
          return null;
        }

        const recordFailure = () =>
          antiAbuse.recordEvent({ type: "LOGIN_FAILED", ipHash, metadata: null });

        const user = await users.findByEmail(parsed.data.email);
        if (!user || !user.passwordHash) {
          await recordFailure();
          return null;
        }

        const passwordMatches = await verifyPassword(parsed.data.password, user.passwordHash);
        if (!passwordMatches) {
          await recordFailure();
          return null;
        }

        if (user.status === "SUSPENDED" || user.status === "BANNED") {
          await recordFailure();
          return null;
        }

        await users.updateLastLoginAt(user.id);
        await antiAbuse.recordEvent({ type: "LOGIN_SUCCEEDED", userId: user.id, ipHash });

        // Auth.js's User type only guarantees id/name/email/image, so
        // rememberMe is smuggled through as a non-standard extra property
        // and picked back up in the jwt callback below.
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          rememberMe: parsed.data.rememberMe,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user?.id) {
        token.id = user.id;
        token.roles = await users.getRoleKeys(user.id);

        const rememberMe = (user as { rememberMe?: boolean }).rememberMe;
        if (rememberMe) {
          token.exp = Math.floor(Date.now() / 1000) + REMEMBER_ME_SESSION_MAX_AGE_SECONDS;
        }
      }

      // Role changes made by an admin mid-session won't apply until the
      // user's token is refreshed by re-authenticating — an accepted
      // trade-off for not hitting the DB on every single request. Trigger
      // "update" (session update) forces a refetch on demand.
      if (trigger === "update" && token.id) {
        token.roles = await users.getRoleKeys(token.id as string);
      }

      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.roles = (token.roles as string[]) ?? [];
      }
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      // Fires for adapter-created users — i.e. first-time OAuth sign-in.
      // Credentials-based registration assigns CUSTOMER itself in
      // RegisterUserUseCase, so this only covers the OAuth path.
      if (user.id) {
        await users.assignDefaultRole(user.id, "CUSTOMER");
      }
    },
  },
};
