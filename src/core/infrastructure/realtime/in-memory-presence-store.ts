import type { PresenceSnapshot, PresenceStore } from "@/application/ports/presence-store";

/**
 * Module 48 — Real-Time System.
 *
 * Per-process, in-memory `PresenceStore` — default implementation,
 * multi-device aware (a user is online as long as they have at least one
 * active connection id in their set). See `PresenceStore`'s own doc
 * comment for the multi-instance story.
 */
export class InMemoryPresenceStore implements PresenceStore {
  private readonly connectionsByUser = new Map<string, Set<string>>();
  private readonly lastSeenAt = new Map<string, Date>();

  markOnline(userId: string, connectionId: string, at: Date = new Date()): void {
    if (!this.connectionsByUser.has(userId)) this.connectionsByUser.set(userId, new Set());
    this.connectionsByUser.get(userId)!.add(connectionId);
    this.lastSeenAt.set(userId, at);
  }

  markOffline(userId: string, connectionId: string, at: Date = new Date()): void {
    const set = this.connectionsByUser.get(userId);
    if (!set) return;
    set.delete(connectionId);
    this.lastSeenAt.set(userId, at);
    if (set.size === 0) this.connectionsByUser.delete(userId);
  }

  getSnapshot(userId: string): PresenceSnapshot {
    const active = this.connectionsByUser.get(userId);
    const activeConnectionCount = active?.size ?? 0;
    return {
      userId,
      status: activeConnectionCount > 0 ? "ONLINE" : "OFFLINE",
      activeConnectionCount,
      lastSeenAt: this.lastSeenAt.get(userId) ?? null,
    };
  }

  listOnlineUserIds(): string[] {
    return [...this.connectionsByUser.entries()].filter(([, set]) => set.size > 0).map(([userId]) => userId);
  }
}
