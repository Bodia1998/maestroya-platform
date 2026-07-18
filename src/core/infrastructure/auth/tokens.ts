import { createHash, randomBytes } from "node:crypto";

/**
 * Shared token machinery for EmailVerificationToken, PasswordResetToken,
 * and RefreshToken. The raw token is what gets emailed/cookied to the
 * user and is never stored — only its SHA-256 hash lives in the
 * database, so a leaked database dump doesn't hand out usable tokens
 * (same principle as password hashing, just a cheaper hash since these
 * tokens are already high-entropy random values, not user-chosen).
 */

export function generateRawToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export const EMAIL_VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h
export const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1h
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30d
export const REFRESH_TOKEN_TTL_REMEMBER_ME_MS = 90 * 24 * 60 * 60 * 1000; // 90d
