import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  OffPlatformDetectionRepository,
  OffPlatformDetectionEventRecord,
  CreateOffPlatformDetectionEventData,
  OffPlatformChannel,
} from "@/domain/repositories/off-platform-detection-repository";

/** Module 65 — Trust & Integrity System: Prisma implementation backed by
 *  `off_platform_detection_events`. */
function toRecord(row: {
  id: string;
  userId: string;
  channel: string;
  matchedText: string;
  confidence: number;
  sourceType: string;
  sourceId: string;
  createdAt: Date;
}): OffPlatformDetectionEventRecord {
  return { ...row, channel: row.channel as OffPlatformChannel };
}

export class PrismaOffPlatformDetectionRepository implements OffPlatformDetectionRepository {
  async create(data: CreateOffPlatformDetectionEventData): Promise<OffPlatformDetectionEventRecord> {
    const row = await prisma.offPlatformDetectionEvent.create({ data });
    return toRecord(row);
  }

  async listForUser(userId: string, limit = 50): Promise<OffPlatformDetectionEventRecord[]> {
    const rows = await prisma.offPlatformDetectionEvent.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map(toRecord);
  }

  async countForUserSince(userId: string, since: Date): Promise<number> {
    return prisma.offPlatformDetectionEvent.count({ where: { userId, createdAt: { gte: since } } });
  }

  async countAll(): Promise<number> {
    return prisma.offPlatformDetectionEvent.count();
  }

  async countByChannel(channel: OffPlatformChannel): Promise<number> {
    return prisma.offPlatformDetectionEvent.count({ where: { channel } });
  }
}
