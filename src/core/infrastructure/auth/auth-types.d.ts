import type { DefaultSession } from "next-auth";

/**
 * Extends Auth.js's built-in types with the fields this app's jwt/session
 * callbacks actually populate (see auth-config.ts). Without this,
 * `session.user.id` / `session.user.roles` would be type errors
 * everywhere they're read.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      roles: string[];
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    roles?: string[];
  }
}
