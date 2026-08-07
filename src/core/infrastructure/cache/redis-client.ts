import "server-only";

import * as net from "node:net";
import * as tls from "node:tls";

import { RedisReplyError, encodeCommand, parseReply } from "@/infrastructure/cache/redis-protocol";

/**
 * Module 44 — Redis Infrastructure (Roadmap Module 11).
 *
 * A minimal, dependency-free RESP2 client over `node:net`/`node:tls` — see
 * `redis-protocol.ts`'s own doc comment for why this codebase implements
 * the wire protocol directly instead of depending on `ioredis`/
 * `node-redis` (no npm-registry access in this environment; a package
 * that can't be installed or resolved isn't real infrastructure).
 *
 * Scope is deliberately narrow: one TCP connection, request/response
 * command pipeline (commands may be sent before the previous reply
 * arrives — RESP guarantees replies come back in the same order they
 * were sent on a single connection — but this client does not attempt
 * cluster/sentinel topology, connection pooling, or pub/sub), lazy
 * connect-on-first-use, and a single automatic reconnect attempt on the
 * next command after a connection drop. This is exactly what
 * `RedisCacheService`, `RedisRateLimitRepository`, and `RedisLockService`
 * need and nothing more — consistent with the task's "DO NOT introduce
 * unnecessary abstractions" instruction.
 *
 * Every failure mode (connect refused/timed out, command timed out,
 * server returned a RESP error) surfaces as a rejected Promise — callers
 * in this codebase (see `cache-service-factory.ts`) are expected to treat
 * "Redis unavailable" as a degraded-but-recoverable condition, not a
 * crash, exactly like `CachedGeocodingProvider` treats a cache miss.
 */

export interface RedisClientOptions {
  /** `redis://` or `rediss://` (TLS) connection string, e.g. `env.REDIS_URL`. */
  url: string;
  /** Milliseconds to wait for the initial TCP/TLS handshake. Default 3000. */
  connectTimeoutMs?: number;
  /** Milliseconds to wait for any single command's reply. Default 2000. */
  commandTimeoutMs?: number;
}

interface ParsedRedisUrl {
  host: string;
  port: number;
  password: string | null;
  db: number;
  tls: boolean;
}

/**
 * Parses `redis://[:password@]host[:port][/db]` or the `rediss://`
 * (TLS) variant. Deliberately hand-rolled rather than `new URL(...)`
 * alone — `URL` handles the authority/host/port parsing fine, but the
 * path segment (`/db`) needs its own numeric validation, and a bare
 * `user:password@` (Redis has no username concept pre-ACL/Redis 6) is
 * folded into `password` the same way `ioredis` does, for compatibility
 * with URLs copied from a typical managed-Redis provider's connection
 * string.
 */
export function parseRedisUrl(rawUrl: string): ParsedRedisUrl {
  const url = new URL(rawUrl);
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error(`Unsupported Redis URL scheme: ${url.protocol} (expected redis: or rediss:)`);
  }

  const dbSegment = url.pathname.replace(/^\//, "");
  const db = dbSegment === "" ? 0 : Number.parseInt(dbSegment, 10);
  if (!Number.isInteger(db) || db < 0) {
    throw new Error(`Invalid Redis DB index in URL path: ${JSON.stringify(url.pathname)}`);
  }

  return {
    host: url.hostname,
    port: url.port ? Number.parseInt(url.port, 10) : 6379,
    password: url.password || null,
    db,
    tls: url.protocol === "rediss:",
  };
}

type Socket = net.Socket | tls.TLSSocket;

interface PendingCommand {
  resolve: (value: RedisClientReply) => void;
  reject: (error: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

/** The subset of RESP2 reply shapes this codebase's commands ever return. */
export type RedisClientReply = string | number | null | RedisClientReply[];

const DEFAULT_CONNECT_TIMEOUT_MS = 3000;
const DEFAULT_COMMAND_TIMEOUT_MS = 2000;

export class RedisClient {
  private readonly parsed: ParsedRedisUrl;
  private readonly connectTimeoutMs: number;
  private readonly commandTimeoutMs: number;

  private socket: Socket | null = null;
  private connectPromise: Promise<void> | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private readonly queue: PendingCommand[] = [];

  constructor(options: RedisClientOptions) {
    this.parsed = parseRedisUrl(options.url);
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  }

  /**
   * Sends one RESP2 command and resolves with its decoded reply. Connects
   * lazily on first call (and transparently reconnects after a prior
   * connection was dropped) rather than requiring callers to manage
   * connection lifecycle explicitly.
   */
  async command(args: ReadonlyArray<string | number>): Promise<RedisClientReply> {
    await this.ensureConnected();

    return new Promise<RedisClientReply>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        // The reply may still arrive later and would otherwise resolve
        // the *next* queued command with this one's data (RESP replies
        // are strictly ordered) — dropping the whole connection on
        // timeout, not just this one command, is the only safe way to
        // recover ordering guarantees.
        this.failAllPending(new Error(`Redis command timed out after ${this.commandTimeoutMs}ms: ${args[0]}`));
        this.destroySocket();
      }, this.commandTimeoutMs);

      this.queue.push({ resolve, reject, timeoutHandle });
      this.socket!.write(encodeCommand(args));
    });
  }

  /** Closes the connection gracefully. Safe to call when never connected. */
  async quit(): Promise<void> {
    if (!this.socket) return;
    try {
      await this.command(["QUIT"]);
    } catch {
      // Best-effort — the socket is being torn down regardless.
    } finally {
      this.destroySocket();
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.socket && !this.socket.destroyed) return;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = this.connect().finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const { host, port, tls: useTls } = this.parsed;

      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onConnectTimeout = () => {
        cleanup();
        socket.destroy();
        reject(new Error(`Redis connection to ${host}:${port} timed out after ${this.connectTimeoutMs}ms`));
      };

      const socket: Socket = useTls
        ? tls.connect({ host, port })
        : net.connect({ host, port });

      const timeoutHandle = setTimeout(onConnectTimeout, this.connectTimeoutMs);

      const cleanup = () => {
        clearTimeout(timeoutHandle);
        socket.removeListener("error", onError);
        socket.removeListener("connect", onConnect);
        socket.removeListener("secureConnect", onConnect);
      };

      const onConnect = () => {
        cleanup();
        this.socket = socket;
        this.wireSocketEvents(socket);
        this.authenticateAndSelectDb().then(resolve, reject);
      };

      socket.once("error", onError);
      socket.once(useTls ? "secureConnect" : "connect", onConnect);
    });
  }

  private async authenticateAndSelectDb(): Promise<void> {
    if (this.parsed.password) {
      await this.command(["AUTH", this.parsed.password]);
    }
    if (this.parsed.db !== 0) {
      await this.command(["SELECT", this.parsed.db]);
    }
  }

  private wireSocketEvents(socket: Socket): void {
    socket.on("data", (chunk: Buffer) => this.onData(chunk));
    socket.on("error", () => {
      // Swallowed here — the corresponding pending command(s) are failed
      // via 'close' below, which always fires after 'error' for a
      // net.Socket. A second unhandled listener-less 'error' would
      // otherwise crash the process (Node's default behavior for
      // EventEmitter 'error' events with no listener).
    });
    socket.on("close", () => {
      this.failAllPending(new Error("Redis connection closed"));
      this.socket = null;
      this.buffer = Buffer.alloc(0);
    });
  }

  private onData(chunk: Buffer): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);

    for (;;) {
      const parsed = parseReply(this.buffer, 0);
      if (!parsed) return; // wait for more bytes

      this.buffer = this.buffer.subarray(parsed.bytesConsumed);

      const pending = this.queue.shift();
      if (!pending) continue; // reply with nothing awaiting it (shouldn't happen; defensive)

      clearTimeout(pending.timeoutHandle);
      if (parsed.value instanceof RedisReplyError) {
        pending.reject(parsed.value);
      } else {
        pending.resolve(parsed.value as RedisClientReply);
      }
    }
  }

  private failAllPending(error: Error): void {
    while (this.queue.length > 0) {
      const pending = this.queue.shift()!;
      clearTimeout(pending.timeoutHandle);
      pending.reject(error);
    }
  }

  private destroySocket(): void {
    this.socket?.destroy();
    this.socket = null;
    this.buffer = Buffer.alloc(0);
  }
}
