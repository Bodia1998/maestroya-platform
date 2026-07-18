import { prisma } from "@/infrastructure/database/prisma/client";
import type { AuthTokenRepository } from "@/domain/repositories/auth-token-repository";

export class PrismaAuthTokenRepository implements AuthTokenRepository {
  async createEmailVerificationToken(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await prisma.emailVerificationToken.create({ data: { userId, tokenHash, expiresAt } });
  }

  async findValidEmailVerificationToken(tokenHash: string): Promise<{ userId: string } | null> {
    const token = await prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
      select: { userId: true, expiresAt: true },
    });
    if (!token || token.expiresAt < new Date()) return null;
    return { userId: token.userId };
  }

  async deleteEmailVerificationTokensForUser(userId: string): Promise<void> {
    await prisma.emailVerificationToken.deleteMany({ where: { userId } });
  }

  async createPasswordResetToken(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await prisma.passwordResetToken.create({ data: { userId, tokenHash, expiresAt } });
  }

  async findValidPasswordResetToken(tokenHash: string): Promise<{ userId: string } | null> {
    const token = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      select: { userId: true, expiresAt: true, usedAt: true },
    });
    if (!token || token.usedAt || token.expiresAt < new Date()) return null;
    return { userId: token.userId };
  }

  async markPasswordResetTokenUsed(tokenHash: string): Promise<void> {
    await prisma.passwordResetToken.update({
      where: { tokenHash },
      data: { usedAt: new Date() },
    });
  }

  async deletePasswordResetTokensForUser(userId: string): Promise<void> {
    await prisma.passwordResetToken.deleteMany({ where: { userId } });
  }

  async createRefreshToken(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<void> {
    await prisma.refreshToken.create({
      data: {
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        userAgent: input.userAgent,
        ipAddress: input.ipAddress,
      },
    });
  }

  async findValidRefreshToken(tokenHash: string): Promise<{ userId: string } | null> {
    const token = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: { userId: true, expiresAt: true, revokedAt: true },
    });
    if (!token || token.revokedAt || token.expiresAt < new Date()) return null;
    return { userId: token.userId };
  }

  async revokeRefreshToken(tokenHash: string): Promise<void> {
    await prisma.refreshToken.update({
      where: { tokenHash },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllRefreshTokensForUser(userId: string): Promise<void> {
    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
