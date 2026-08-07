import * as net from "node:net";

import { parseReply } from "@/infrastructure/cache/redis-protocol";

/**
 * Module 44 — Redis Infrastructure: an in-process, real-TCP fake Redis
 * server for exercising `RedisClient` (and everything built on it —
 * `RedisCacheService`, `RedisRateLimitRepository`, `RedisLockService`)
 * against actual socket I/O, without a real Redis server or network
 * access (this sandbox has neither — see
 * docs/MODULE_25_PRODUCTION_INFRASTRUCTURE.md §25 and
 * docs/MODULE_44_REDIS_INFRASTRUCTURE.md for why).
 *
 * Implements only the commands this codebase's Redis-backed services
 * actually send (`PING`, `AUTH`, `SELECT`, `GET`, `SET` [`PX`/`NX`],
 * `DEL`, `EXISTS`, `EVAL` for the two specific Lua scripts used by
 * `RedisRateLimitRepository`/`RedisLockService`, `QUIT`) — a real Redis
 * server implements hundreds of commands; this is a test double, not a
 * reimplementation of Redis.
 */
interface StoredEntry {
  value: string;
  expiresAt: number | null;
}

export interface FakeRedisServer {
  port: number;
  url: string;
  store: Map<string, StoredEntry>;
  close(): Promise<void>;
}

function encodeSimple(s: string): Buffer {
  return Buffer.from(`+${s}\r\n`, "utf8");
}
function encodeError(s: string): Buffer {
  return Buffer.from(`-${s}\r\n`, "utf8");
}
function encodeInt(n: number): Buffer {
  return Buffer.from(`:${n}\r\n`, "utf8");
}
function encodeBulk(s: string | null): Buffer {
  if (s === null) return Buffer.from(`$-1\r\n`, "utf8");
  return Buffer.from(`$${Buffer.byteLength(s, "utf8")}\r\n${s}\r\n`, "utf8");
}
function encodeArray(items: Buffer[]): Buffer {
  return Buffer.concat([Buffer.from(`*${items.length}\r\n`, "utf8"), ...items]);
}

export async function startFakeRedisServer(
  options: { rejectAuth?: boolean; hangOnCommand?: string } = {},
): Promise<FakeRedisServer> {
  const store = new Map<string, StoredEntry>();

  function isLive(key: string): boolean {
    const entry = store.get(key);
    if (!entry) return false;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      store.delete(key);
      return false;
    }
    return true;
  }

  function handleCommand(socket: net.Socket, args: string[]): void {
    const cmd = (args[0] ?? "").toUpperCase();

    if (options.hangOnCommand && cmd === options.hangOnCommand) {
      return; // deliberately never reply — used to test client-side timeouts
    }

    switch (cmd) {
      case "PING":
        socket.write(encodeSimple("PONG"));
        return;

      case "AUTH":
        if (options.rejectAuth) {
          socket.write(encodeError("WRONGPASS invalid username-password pair"));
        } else {
          socket.write(encodeSimple("OK"));
        }
        return;

      case "SELECT":
        socket.write(encodeSimple("OK"));
        return;

      case "QUIT":
        socket.write(encodeSimple("OK"));
        socket.end();
        return;

      case "GET": {
        const key = args[1] ?? "";
        socket.write(encodeBulk(isLive(key) ? store.get(key)!.value : null));
        return;
      }

      case "SET": {
        const key = args[1] ?? "";
        const value = args[2] ?? "";
        let px: number | null = null;
        let nx = false;
        for (let i = 3; i < args.length; i++) {
          const token = (args[i] ?? "").toUpperCase();
          if (token === "PX") {
            px = Number(args[i + 1]);
            i++;
          } else if (token === "NX") {
            nx = true;
          }
        }
        if (nx && isLive(key)) {
          socket.write(encodeBulk(null));
          return;
        }
        store.set(key, { value, expiresAt: px !== null ? Date.now() + px : null });
        socket.write(encodeSimple("OK"));
        return;
      }

      case "DEL": {
        const key = args[1] ?? "";
        const existed = isLive(key) ? 1 : 0;
        store.delete(key);
        socket.write(encodeInt(existed));
        return;
      }

      case "EXISTS": {
        const key = args[1] ?? "";
        socket.write(encodeInt(isLive(key) ? 1 : 0));
        return;
      }

      case "EVAL": {
        const script = args[1] ?? "";
        if (script.includes("PEXPIRE") && script.includes("INCR")) {
          // RedisRateLimitRepository's CONSUME_SCRIPT.
          const key = args[3] ?? "";
          const limit = Number(args[4]);
          const windowMs = Number(args[5]);
          const wasLive = isLive(key);
          const current = wasLive ? Number(store.get(key)!.value) : 0;
          const count = current + 1;
          const expiresAt = wasLive ? store.get(key)!.expiresAt! : Date.now() + windowMs;
          store.set(key, { value: String(count), expiresAt });
          const ttl = Math.max(expiresAt - Date.now(), 0);

          if (count > limit) {
            socket.write(encodeArray([encodeInt(0), encodeInt(limit), encodeInt(0), encodeInt(ttl)]));
          } else {
            socket.write(
              encodeArray([encodeInt(1), encodeInt(Math.max(limit - count, 0)), encodeInt(ttl)]),
            );
          }
          return;
        }

        // RedisLockService's RELEASE_SCRIPT.
        const lockKey = args[3] ?? "";
        const token = args[4] ?? "";
        if (isLive(lockKey) && store.get(lockKey)!.value === token) {
          store.delete(lockKey);
          socket.write(encodeInt(1));
        } else {
          socket.write(encodeInt(0));
        }
        return;
      }

      default:
        socket.write(encodeError(`ERR unknown command '${cmd}'`));
    }
  }

  // Root cause of the Module 44 regression (22 hanging Redis-infrastructure
  // unit tests, surfacing as Vitest *hook* timeouts rather than assertion
  // failures): `net.Server.close(callback)`'s callback does not fire until
  // every socket the server has ever accepted has itself ended — the
  // server merely stops *accepting new* connections, per Node's own
  // documented behavior. `RedisClient` is deliberately a persistent,
  // lazily-reconnecting connection by design (see redis-client.ts's own
  // doc comment — a real request-serving process holds one open
  // connection for its lifetime, closed only once, by
  // `instrumentation.ts`'s graceful-shutdown hook). No test in this suite
  // calls `client.quit()` — nor should it have to, since exercising that
  // persistent-connection behavior *is* the point of testing against a
  // real socket. Every test that connects a `RedisClient` to this fake
  // server was therefore leaving one open TCP connection behind at the
  // end of the test body; the very next `afterEach(() => server.close())`
  // then waited forever for a connection close that was never going to
  // happen on its own — a `close()` that hangs is exactly what Vitest
  // reports as a hook timeout (not a `test.fails()`-style assertion
  // failure), matching the reported symptom precisely.
  //
  // Fix: track every socket this server has ever accepted and force-
  // destroy any still-open ones as part of `close()`, so `close()` always
  // settles promptly on its own — the standard pattern for a Node TCP/HTTP
  // test double (`net.Server.close()`'s "wait for graceful client
  // disconnect" semantics are appropriate for a *real* server shutting
  // down in production, not for a short-lived per-test fixture that must
  // be torn down deterministically regardless of what the client under
  // test does or doesn't do).
  const openSockets = new Set<net.Socket>();

  const server = net.createServer((socket) => {
    openSockets.add(socket);
    socket.on("close", () => openSockets.delete(socket));

    let buffer: Buffer = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
      for (;;) {
        const parsed = parseReply(buffer, 0);
        if (!parsed) return;
        buffer = buffer.subarray(parsed.bytesConsumed);
        if (Array.isArray(parsed.value)) {
          handleCommand(socket, parsed.value as string[]);
        }
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    port,
    url: `redis://127.0.0.1:${port}`,
    store,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of openSockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
