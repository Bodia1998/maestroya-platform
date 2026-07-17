import { PrismaAdapter } from "@auth/prisma-adapter";
import type { NextAuthConfig } from "next-auth";

import { prisma } from "@/infrastructure/database/prisma/client";

/**
 * Auth.js configuration.
 *
 * This is infrastructure: it wires a third-party library (Auth.js) to a
 * concrete persistence adapter (Prisma). Domain and application code never
 * import this directly — they depend on an (as yet unbuilt) abstraction
 * such as a `SessionProvider` port if session data is needed in a use case.
 *
 * No OAuth/credentials providers are configured yet — add them here once
 * a provider (Google, email magic link, credentials, etc.) is chosen.
 * Session strategy defaults to "database" because the Prisma adapter is in
 * use, which is the right default for a marketplace needing server-side
 * session invalidation (e.g. banning a provider).
 */
export const authConfig: NextAuthConfig = {
  adapter: PrismaAdapter(prisma),
  session: {
    strategy: "database",
  },
  providers: [
    // TODO: add providers, e.g.
    // Google({ clientId: env.AUTH_GOOGLE_ID, clientSecret: env.AUTH_GOOGLE_SECRET }),
  ],
  pages: {
    signIn: "/sign-in",
  },
  callbacks: {
    session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
};
