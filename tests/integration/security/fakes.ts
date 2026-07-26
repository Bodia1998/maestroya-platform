import type {
  AccountRestrictionRecord,
  AccountRestrictionRepository,
  CreateAccountRestrictionData,
  ListAccountRestrictionsOptions,
} from "@/domain/repositories/account-restriction-repository";
import type {
  ListSecurityEventsOptions,
  RecordSecurityEventData,
  SecurityEventRecord,
  SecurityEventRepository,
} from "@/domain/repositories/security-event-repository";
import { mostSevereActiveRestriction } from "@/domain/services/account-restriction-rules";

/**
 * In-memory test doubles for Security & Anti-Abuse (Module 24) integration
 * tests — same convention as tests/integration/auth/fakes.ts and every
 * other module's fakes.ts. `InMemoryRateLimitRepository` itself is real
 * (infrastructure/security/in-memory-rate-limit-repository.ts) and used
 * directly in these tests rather than faked again — it has no external
 * dependency to fake around.
 */

let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export class FakeSecurityEventRepository implements SecurityEventRepository {
  events: SecurityEventRecord[] = [];

  async record(data: RecordSecurityEventData): Promise<SecurityEventRecord> {
    const record: SecurityEventRecord = {
      id: nextId("event"),
      type: data.type,
      userId: data.userId ?? null,
      ipHash: data.ipHash ?? null,
      userAgent: data.userAgent ?? null,
      metadata: data.metadata ?? null,
      createdAt: new Date(),
    };
    this.events.push(record);
    return record;
  }

  async list(options: ListSecurityEventsOptions): Promise<SecurityEventRecord[]> {
    return this.events
      .filter((e) => (options.type ? e.type === options.type : true))
      .filter((e) => (options.userId ? e.userId === options.userId : true))
      .slice()
      .reverse()
      .slice(options.offset, options.offset + options.limit);
  }
}

export class FakeAccountRestrictionRepository implements AccountRestrictionRepository {
  restrictions: AccountRestrictionRecord[] = [];

  async create(data: CreateAccountRestrictionData): Promise<AccountRestrictionRecord> {
    if (data.expiresAt === null && !data.createdByUserId) {
      throw new Error(
        "AccountRestriction with expiresAt=null requires an explicit createdByUserId (admin decision).",
      );
    }
    const now = new Date();
    const record: AccountRestrictionRecord = {
      id: nextId("restriction"),
      userId: data.userId,
      state: data.state,
      reason: data.reason,
      notes: data.notes ?? null,
      createdByUserId: data.createdByUserId ?? null,
      expiresAt: data.expiresAt,
      liftedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.restrictions.push(record);
    return record;
  }

  async findActiveForUser(userId: string, now: Date): Promise<AccountRestrictionRecord | null> {
    const forUser = this.restrictions.filter((r) => r.userId === userId);
    return mostSevereActiveRestriction(forUser, now);
  }

  async lift(id: string, now: Date): Promise<AccountRestrictionRecord | null> {
    const restriction = this.restrictions.find((r) => r.id === id);
    if (!restriction) return null;
    restriction.liftedAt = now;
    restriction.updatedAt = now;
    return restriction;
  }

  async list(options: ListAccountRestrictionsOptions): Promise<AccountRestrictionRecord[]> {
    return this.restrictions
      .filter((r) => (options.userId ? r.userId === options.userId : true))
      .slice()
      .reverse()
      .slice(options.offset, options.offset + options.limit);
  }
}
