/**
 * Module 48 — Real-Time System.
 *
 * A minimal, dependency-free RFC 6455 WebSocket frame encoder/decoder.
 * This codebase has no `ws`/`socket.io` package (and none is added by
 * this module — see `docs/MODULE_48_REALTIME_SYSTEM.md`'s "WebSockets"
 * section for why), so `websocket-server.ts` needs its own frame-level
 * implementation. This mirrors the hand-rolled RESP2 parser
 * `infrastructure/cache/redis-client.ts` already uses for the same
 * "no new dependency, protocol handled by hand" reason — pure functions,
 * unit-testable without a socket.
 *
 * Deliberately scoped to what this module's use case needs: single-frame
 * (unfragmented, `FIN=1`) text/close/ping/pong frames up to 64KB, which
 * covers every JSON control/event message this transport sends. A client
 * sending a fragmented or >64KB message is rejected with a close frame
 * rather than silently mishandled — see `decodeFrame`'s `oversized`
 * result.
 */

export const OPCODE = {
  TEXT: 0x1,
  BINARY: 0x2,
  CLOSE: 0x8,
  PING: 0x9,
  PONG: 0xa,
} as const;

export type Opcode = (typeof OPCODE)[keyof typeof OPCODE];

const MAX_PAYLOAD_BYTES = 64 * 1024;

/** Server → client frames are never masked (RFC 6455 §5.1: only client-to-server frames use a mask). */
export function encodeFrame(opcode: Opcode, payload: Buffer): Buffer {
  const payloadLength = payload.length;
  const header: number[] = [0x80 | opcode]; // FIN=1, opcode.

  if (payloadLength < 126) {
    header.push(payloadLength);
  } else if (payloadLength < 65536) {
    header.push(126, (payloadLength >> 8) & 0xff, payloadLength & 0xff);
  } else {
    // Not expected given MAX_PAYLOAD_BYTES, but encoded correctly regardless.
    header.push(127, 0, 0, 0, 0, (payloadLength >>> 24) & 0xff, (payloadLength >>> 16) & 0xff, (payloadLength >>> 8) & 0xff, payloadLength & 0xff);
  }

  return Buffer.concat([Buffer.from(header), payload]);
}

export function encodeText(text: string): Buffer {
  return encodeFrame(OPCODE.TEXT, Buffer.from(text, "utf8"));
}

export interface DecodedFrame {
  opcode: Opcode;
  payload: Buffer;
  /** Byte length of this frame within the input buffer — the caller advances its read offset by this much. */
  frameLength: number;
}

export type DecodeResult =
  | { status: "incomplete" }
  | { status: "oversized" }
  | { status: "invalid"; reason: string }
  | { status: "ok"; frame: DecodedFrame };

/** Decodes exactly one frame from the start of `buffer`, if a complete one is present. Client → server frames MUST be masked per RFC 6455; a non-fragmented, unmasked frame is protocol-invalid and rejected. */
export function decodeFrame(buffer: Buffer): DecodeResult {
  if (buffer.length < 2) return { status: "incomplete" };

  const firstByte = buffer.readUInt8(0);
  const secondByte = buffer.readUInt8(1);

  const fin = (firstByte & 0x80) !== 0;
  const opcode = (firstByte & 0x0f) as Opcode;
  const masked = (secondByte & 0x80) !== 0;
  let payloadLength = secondByte & 0x7f;
  let offset = 2;

  if (!fin) return { status: "invalid", reason: "fragmented frames are not supported" };
  if (!masked) return { status: "invalid", reason: "client frames must be masked" };
  if (!Object.values(OPCODE).includes(opcode)) return { status: "invalid", reason: `unsupported opcode ${opcode}` };

  if (payloadLength === 126) {
    if (buffer.length < offset + 2) return { status: "incomplete" };
    payloadLength = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (payloadLength === 127) {
    if (buffer.length < offset + 8) return { status: "incomplete" };
    const high = buffer.readUInt32BE(offset);
    const low = buffer.readUInt32BE(offset + 4);
    if (high !== 0) return { status: "oversized" };
    payloadLength = low;
    offset += 8;
  }

  if (payloadLength > MAX_PAYLOAD_BYTES) return { status: "oversized" };

  if (buffer.length < offset + 4) return { status: "incomplete" };
  const maskKey = buffer.subarray(offset, offset + 4);
  offset += 4;

  if (buffer.length < offset + payloadLength) return { status: "incomplete" };
  const maskedPayload = buffer.subarray(offset, offset + payloadLength);
  const payload = Buffer.alloc(payloadLength);
  for (let i = 0; i < payloadLength; i += 1) {
    payload[i] = maskedPayload.readUInt8(i) ^ maskKey.readUInt8(i % 4);
  }
  offset += payloadLength;

  return { status: "ok", frame: { opcode, payload, frameLength: offset } };
}
