import NextAuth from "next-auth";

import { authConfig } from "@/infrastructure/auth/auth-config";

/**
 * Auth.js v5 root entry point.
 *
 * Auth.js expects this file at the project root. It re-exports the actual
 * configuration from the infrastructure layer (see auth-config.ts) so the
 * config itself stays inside the architecture's infrastructure boundary
 * while still satisfying the framework's file-location convention.
 */
export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
