/**
 * Module 44 — Redis Infrastructure (Roadmap Module 11).
 *
 * Minimal RESP2 (REdis Serialization Protocol) encoder/decoder — the wire
 * format every Redis server speaks, regardless of client library. This
 * codebase has zero npm-registry access in CI/sandbox environments where
 * this module was authored (documented independently in
 * docs/MODULE_25_PRODUCTION_INFRASTRUCTURE.md §25: `npm install`, `npm
 * view`, and direct registry `curl` all return `403 Forbidden`), so
 * depending on `ioredis`/`node-redis` — packages that cannot be installed
 * or even type-checked against in this environment — would produce a
 * dependency that looks wired up but has never actually been resolved,
 * exactly the "speculative infrastructure with no way to test it" trap
 * Module 25 explicitly declined to fall into for the same reason.
 *
 * RESP2 itself is a tiny, stable, versioned text protocol (unchanged
 * since Redis 1.2, and still what every server understands even when
 * RESP3 is negotiated) — implementing the handful of reply types this
 * codebase's usage needs (simple string, error, integer, bulk string,
 * array, null) is a small, self-contained, fully unit-testable piece of
 * code with no external dependency, versus vendoring a third-party
 * client's source wholesale (as Module 25 did for the tiny `server-only`
 * package) or hand-authoring a convincing fake `ioredis` — both of which
 * would risk behavior drifting from the real thing in ways this task has
 * no way to verify against a real server. A future environment with
 * registry access can swap this for `ioredis` behind the same
 * `RedisClient` shape (see `redis-client.ts`) with no caller changes, if
 * the team ever wants the fuller feature set (cluster/sentinel support,
 * connection pooling, etc.) — this module intentionally implements only
 * what MaestroYa's own use cases (cache, rate limiting, locking) need.
 *
 * Reference: https://redis.io/docs/latest/develop/reference/protocol-spec/
 */

/** A reply value as decoded from RESP2: nested arrays, strings, integers, or null. */
export type RespValue = string | number | null | RespValue[];

/**
 * Thrown (surfaced as a rejected command Promise, never thrown
 * synchronously) when the server itself returns a RESP2 error reply
 * (`-ERR ...\r\n`) — e.g. `WRONGTYPE`, `NOAUTH`, a malformed command. This
 * is distinct from a connection-level `Error` (socket closed, timed out,
 * refused) — callers that care about "did Redis reject my command" vs.
 * "could I not reach Redis at all" can `instanceof` check.
 */
export class RedisReplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RedisReplyError";
  }
}

/**
 * Encodes a command as a RESP2 "array of bulk strings" — the canonical
 * wire form every Redis command uses when sent from a client (see
 * "Sending commands to a Redis server" in the protocol spec). Every
 * argument is coerced to its string form and length-prefixed in UTF-8
 * bytes (not JS string length), so multi-byte characters in cached values
 * are framed correctly.
 */
export function encodeCommand(args: ReadonlyArray<string | number>): Buffer {
  const parts: Buffer[] = [Buffer.from(`*${args.length}\r\n`, "utf8")];
  for (const arg of args) {
    const str = String(arg);
    const byteLength = Buffer.byteLength(str, "utf8");
    parts.push(Buffer.from(`$${byteLength}\r\n${str}\r\n`, "utf8"));
  }
  return Buffer.concat(parts);
}

/** One fully-decoded reply, plus how many bytes of the input buffer it consumed. */
export interface ParsedReply {
  value: RespValue | RedisReplyError;
  bytesConsumed: number;
}

/**
 * Attempts to parse exactly one RESP2 reply starting at `offset` in `buf`.
 * Returns `null` if `buf` doesn't yet contain a complete reply (the
 * common case mid-stream — the caller is expected to buffer more bytes
 * from the socket and retry), never throws for "incomplete data". Only
 * throws for a genuinely malformed leading type byte, which a real Redis
 * server never sends.
 *
 * Recursive for arrays (including RESP2's nested-array replies, e.g. from
 * `EVAL` returning a Lua table) — bounded by actual reply size, never
 * user-controlled recursion depth in a way that's exploitable (this
 * client only ever talks to the operator's own configured `REDIS_URL`,
 * never an untrusted peer).
 */
export function parseReply(buf: Buffer, offset: number): ParsedReply | null {
  if (offset >= buf.length) return null;

  const typeByte = buf[offset];
  if (typeByte === undefined) return null;
  const type = String.fromCharCode(typeByte);
  const lineEnd = buf.indexOf("\r\n", offset + 1);
  if (lineEnd === -1) return null;

  const line = buf.toString("utf8", offset + 1, lineEnd);
  const afterLine = lineEnd + 2;

  switch (type) {
    case "+": // Simple string, e.g. +OK\r\n
      return { value: line, bytesConsumed: afterLine - offset };

    case "-": // Error, e.g. -ERR unknown command\r\n
      return { value: new RedisReplyError(line), bytesConsumed: afterLine - offset };

    case ":": { // Integer, e.g. :1000\r\n
      const num = Number.parseInt(line, 10);
      if (!Number.isFinite(num)) {
        throw new Error(`Malformed RESP integer reply: ${JSON.stringify(line)}`);
      }
      return { value: num, bytesConsumed: afterLine - offset };
    }

    case "$": { // Bulk string, e.g. $5\r\nhello\r\n ; $-1\r\n = null
      const len = Number.parseInt(line, 10);
      if (len === -1) return { value: null, bytesConsumed: afterLine - offset };
      const dataEnd = afterLine + len;
      if (buf.length < dataEnd + 2) return null; // wait for the trailing \r\n too
      const value = buf.toString("utf8", afterLine, dataEnd);
      return { value, bytesConsumed: dataEnd + 2 - offset };
    }

    case "*": { // Array, e.g. *2\r\n$3\r\nfoo\r\n$3\r\nbar\r\n ; *-1\r\n = null
      const len = Number.parseInt(line, 10);
      if (len === -1) return { value: null, bytesConsumed: afterLine - offset };

      const items: RespValue[] = [];
      let cursor = afterLine;
      for (let i = 0; i < len; i++) {
        const parsed = parseReply(buf, cursor);
        if (!parsed) return null; // element not fully buffered yet
        if (parsed.value instanceof RedisReplyError) {
          // A server never nests an error reply inside an array in
          // practice, but if it did, surface it rather than silently
          // coercing it to a value.
          return { value: parsed.value, bytesConsumed: cursor + parsed.bytesConsumed - offset };
        }
        items.push(parsed.value);
        cursor += parsed.bytesConsumed;
      }
      return { value: items, bytesConsumed: cursor - offset };
    }

    default:
      throw new Error(`Unsupported RESP2 type byte: ${JSON.stringify(type)} at offset ${offset}`);
  }
}
