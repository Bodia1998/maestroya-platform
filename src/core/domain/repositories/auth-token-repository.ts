export interface AuthTokenRepository {
  createEmailVerificationToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  /** Returns the userId if a matching, unexpired token exists, else null. Does not consume it. */
  findValidEmailVerificationToken(tokenHash: string): Promise<{ userId: string } | null>;
  deleteEmailVerificationTokensForUser(userId: string): Promise<void>;

  createPasswordResetToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  findValidPasswordResetToken(tokenHash: string): Promise<{ userId: string } | null>;
  markPasswordResetTokenUsed(tokenHash: string): Promise<void>;
  deletePasswordResetTokensForUser(userId: string): Promise<void>;

  createRefreshToken(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<void>;
  findValidRefreshToken(tokenHash: string): Promise<{ userId: string } | null>;
  revokeRefreshToken(tokenHash: string): Promise<void>;
  revokeAllRefreshTokensForUser(userId: string): Promise<void>;
}
