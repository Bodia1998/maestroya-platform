export const OFF_PLATFORM_CHANNEL_VALUES = [
  "WHATSAPP",
  "TELEGRAM",
  "SIGNAL",
  "PHONE_NUMBER",
  "EMAIL_ADDRESS",
  "INSTAGRAM",
  "FACEBOOK",
  "TIKTOK",
  "DISCORD",
  "SKYPE",
  "EXTERNAL_PAYMENT_REQUEST",
  "CONTACT_EXCHANGE_PHRASE",
  "OTHER",
] as const;
export type OffPlatformChannel = (typeof OFF_PLATFORM_CHANNEL_VALUES)[number];

/**
 * Module 65 — Trust & Integrity System: repository interface for
 * `OffPlatformDetectionEvent`, backing requirement #3's rule engine
 * (`domain/services/off-platform-detection-rules.ts`).
 */
export interface OffPlatformDetectionEventRecord {
  id: string;
  userId: string;
  channel: OffPlatformChannel;
  matchedText: string;
  confidence: number;
  sourceType: string;
  sourceId: string;
  createdAt: Date;
}

export interface CreateOffPlatformDetectionEventData {
  userId: string;
  channel: OffPlatformChannel;
  matchedText: string;
  confidence: number;
  sourceType: string;
  sourceId: string;
}

export interface OffPlatformDetectionRepository {
  create(data: CreateOffPlatformDetectionEventData): Promise<OffPlatformDetectionEventRecord>;
  listForUser(userId: string, limit?: number): Promise<OffPlatformDetectionEventRecord[]>;
  countForUserSince(userId: string, since: Date): Promise<number>;
  countAll(): Promise<number>;
  countByChannel(channel: OffPlatformChannel): Promise<number>;
}
