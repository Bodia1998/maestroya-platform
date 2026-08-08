/**
 * Module 48 — Real-Time System.
 *
 * A `RealtimeChannel` is the addressable unit every realtime connection
 * subscribes to and every realtime event is published on — the same role
 * a topic/room plays in any pub/sub system. Deliberately a value object
 * (immutable, structurally equal, self-validating) rather than a bare
 * string: every other layer (authorization, the connection registry, the
 * transports) works against this type instead of re-parsing/re-validating
 * a raw `"dispute:123"` string independently, which is exactly the
 * "never duplicate logic" instruction for this module.
 *
 * Supported shapes:
 *   - `admin`                    — no resource id; platform-staff only.
 *   - `user:{id}`                — a single user's private notification feed.
 *   - `professional:{id}`        — a professional profile's private feed.
 *   - `company:{id}`             — a company profile's private feed.
 *   - `booking:{id}`             — a Job (this codebase's "booking") thread.
 *   - `dispute:{id}`             — a dispute case thread.
 *   - `chat:{id}`                — a Conversation's live message stream.
 *   - `quote:{id}`               — a quote's status stream.
 *   - `service-request:{id}`     — a service request's status stream.
 *   - `search-index:{id}`        — search-indexing progress for one document.
 *   - `job-queue:{id}`           — background-job lifecycle progress.
 *
 * `id` is opaque here — this value object only knows the channel is
 * well-formed, never whether the caller is *allowed* to subscribe to it.
 * Authorization is `ChannelAuthorizationService`'s job (application
 * layer), which is what keeps this class free of any repository/session
 * dependency and therefore trivially unit-testable.
 */

export const REALTIME_CHANNEL_TYPES = [
  "admin",
  "user",
  "professional",
  "company",
  "booking",
  "dispute",
  "chat",
  "quote",
  "service-request",
  "search-index",
  "job-queue",
] as const;

export type RealtimeChannelType = (typeof REALTIME_CHANNEL_TYPES)[number];

/** Channel types that address a single, unscoped, platform-wide topic — no resource id. */
const SINGLETON_CHANNEL_TYPES: ReadonlySet<RealtimeChannelType> = new Set(["admin"]);

const CHANNEL_NAME_PATTERN = /^[a-z][a-z0-9-]*(:[a-zA-Z0-9_-]{1,128})?$/;

export class InvalidRealtimeChannelError extends Error {
  constructor(raw: string, reason: string) {
    super(`"${raw}" is not a valid realtime channel: ${reason}`);
    this.name = "InvalidRealtimeChannelError";
  }
}

export class RealtimeChannel {
  private constructor(
    readonly type: RealtimeChannelType,
    readonly resourceId: string | null,
  ) {}

  /** Parses and validates a raw channel string (e.g. `"dispute:abc-123"`). Throws `InvalidRealtimeChannelError` for anything malformed. */
  static parse(raw: string): RealtimeChannel {
    if (typeof raw !== "string" || raw.length === 0) {
      throw new InvalidRealtimeChannelError(String(raw), "channel name must be a non-empty string");
    }
    if (raw.length > 160) {
      throw new InvalidRealtimeChannelError(raw, "channel name is too long");
    }
    if (!CHANNEL_NAME_PATTERN.test(raw)) {
      throw new InvalidRealtimeChannelError(raw, "channel name has an invalid shape");
    }

    const [type, resourceId] = raw.includes(":") ? raw.split(/:(.+)/, 2) : [raw, undefined];

    if (!REALTIME_CHANNEL_TYPES.includes(type as RealtimeChannelType)) {
      throw new InvalidRealtimeChannelError(raw, `unknown channel type "${type}"`);
    }
    const channelType = type as RealtimeChannelType;
    const isSingleton = SINGLETON_CHANNEL_TYPES.has(channelType);

    if (isSingleton && resourceId) {
      throw new InvalidRealtimeChannelError(raw, `"${channelType}" is a singleton channel and takes no resource id`);
    }
    if (!isSingleton && !resourceId) {
      throw new InvalidRealtimeChannelError(raw, `"${channelType}" requires a resource id (e.g. "${channelType}:123")`);
    }

    return new RealtimeChannel(channelType, resourceId ?? null);
  }

  /** Constructs a channel from known-good parts, skipping string parsing — used by code that already has a validated `{ type, resourceId }` pair (e.g. domain event subscribers). */
  static of(type: RealtimeChannelType, resourceId: string | null = null): RealtimeChannel {
    return RealtimeChannel.parse(resourceId ? `${type}:${resourceId}` : type);
  }

  static isValid(raw: string): boolean {
    try {
      RealtimeChannel.parse(raw);
      return true;
    } catch {
      return false;
    }
  }

  /** `true` for channels that address one specific private recipient (`user`/`professional`/`company`) — the shape `ChannelAuthorizationService` treats as "owner-only" by default. */
  get isPrivateResourceChannel(): boolean {
    return this.type === "user" || this.type === "professional" || this.type === "company";
  }

  toString(): string {
    return this.resourceId ? `${this.type}:${this.resourceId}` : this.type;
  }

  equals(other: RealtimeChannel): boolean {
    return this.type === other.type && this.resourceId === other.resourceId;
  }
}
