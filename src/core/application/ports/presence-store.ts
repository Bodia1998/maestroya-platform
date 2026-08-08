/**
 * Module 48 — Real-Time System.
 *
 * Tracks each user's online/offline status and last-seen time across
 * however many concurrent connections (devices/tabs) they have open. A
 * user is "online" iff they have at least one live connection; "last
 * seen" is the timestamp of their most recent disconnect, kept even after
 * they go offline so profile/booking UIs can show "last seen 3 hours
 * ago". The default (`InMemoryPresenceStore`) is per-instance, exactly
 * like `ConnectionRegistry` — see that port's doc comment and
 * `docs/MODULE_48_REALTIME_SYSTEM.md` for the multi-instance story.
 */
export interface PresenceSnapshot {
  readonly userId: string;
  readonly status: "ONLINE" | "OFFLINE";
  readonly activeConnectionCount: number;
  readonly lastSeenAt: Date | null;
}

export interface PresenceStore {
  /** Records that `connectionId` is now an active connection for `userId` — called once per connection, on connect. */
  markOnline(userId: string, connectionId: string, at?: Date): void;
  /** Removes `connectionId` from `userId`'s active set. If it was the last one, the user's `lastSeenAt` is set to `at`. */
  markOffline(userId: string, connectionId: string, at?: Date): void;
  getSnapshot(userId: string): PresenceSnapshot;
  /** Every currently-online user id. */
  listOnlineUserIds(): string[];
}
