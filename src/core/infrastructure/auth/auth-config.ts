import { PrismaAdapter } from "@auth/prisma-adapter";
import type { NextAuthConfig } from "next-auth";
import Apple from "next-auth/providers/apple";
import Credentials from "next-auth/providers/credentials";
import Facebook from "next-auth/providers/facebook";
import Google from "next-auth/providers/google";

import { prisma } from "@/infrastructure/database/prisma/client";
import { env } from "@/infrastructure/config/env";
import { verifyPassword } from "@/infrastructure/auth/password";
import { PrismaUserRepository } from "@/infrastructure/database/prisma/repositories/prisma-user-repository";
import { loginSchema } from "@/application/dto/auth.dto";

const users = new PrismaUserRepository();

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

        const user = await users.findByEmail(parsed.data.email);
        if (!user || !user.passwordHash) return null;

        const passwordMatches = await verifyPassword(parsed.data.password, user.passwordHash);
        if (!passwordMatches) return null;

        if (user.status === "SUSPENDED" || user.status === "BANNED") return null;

        await users.updateLastLoginAt(user.id);

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
