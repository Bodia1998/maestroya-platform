import bcrypt from "bcryptjs";

/**
 * Password hashing — infrastructure concern, isolated here so the rest of
 * the codebase never touches bcryptjs directly. 12 rounds is a reasonable
 * balance of cost vs. login latency as of 2026 hardware; revisit upward
 * over time as hardware gets faster.
 */
const SALT_ROUNDS = 12;

export async function hashPassword(plainTextPassword: string): Promise<string> {
  return bcrypt.hash(plainTextPassword, SALT_ROUNDS);
}

export async function verifyPassword(
  plainTextPassword: string,
  passwordHash: string,
): Promise<boolean> {
  return bcrypt.compare(plainTextPassword, passwordHash);
}
