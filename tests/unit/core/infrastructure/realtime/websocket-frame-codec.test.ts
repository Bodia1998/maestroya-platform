import { describe, expect, it } from "vitest";

import { decodeFrame, encodeFrame, encodeText, OPCODE } from "@/infrastructure/realtime/websocket-frame-codec";

/** Masks a payload the way a spec-compliant client must — used to build well-formed "client frames" in these tests. */
function maskPayload(payload: Buffer, maskKey: Buffer): Buffer {
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i += 1) masked[i] = payload.readUInt8(i) ^ maskKey.readUInt8(i % 4);
  return masked;
}

function encodeClientFrame(opcode: number, text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  const maskKey = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const masked = maskPayload(payload, maskKey);
  const header = [0x80 | opcode, 0x80 | payload.length, ...maskKey];
  return Buffer.concat([Buffer.from(header), masked]);
}

describe("infrastructure/realtime/websocket-frame-codec", () => {
  it("encodeFrame produces an unmasked server frame with a correct short-length header", () => {
    const frame = encodeText("hi");
    expect(frame.readUInt8(0)).toBe(0x81); // FIN=1, opcode=text
    expect(frame.readUInt8(1) & 0x80).toBe(0); // server frames are never masked
    expect(frame.readUInt8(1) & 0x7f).toBe(2); // payload length
    expect(frame.subarray(2).toString("utf8")).toBe("hi");
  });

  it("decodeFrame round-trips a masked client text frame", () => {
    const raw = encodeClientFrame(OPCODE.TEXT, "hello");
    const result = decodeFrame(raw);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.frame.opcode).toBe(OPCODE.TEXT);
      expect(result.frame.payload.toString("utf8")).toBe("hello");
      expect(result.frame.frameLength).toBe(raw.length);
    }
  });

  it("decodeFrame reports incomplete for a partial buffer", () => {
    const raw = encodeClientFrame(OPCODE.TEXT, "hello world");
    const partial = raw.subarray(0, raw.length - 3);
    expect(decodeFrame(partial).status).toBe("incomplete");
  });

  it("decodeFrame rejects an unmasked frame (protocol violation for client->server)", () => {
    const unmasked = encodeFrame(OPCODE.TEXT, Buffer.from("hi"));
    expect(decodeFrame(unmasked).status).toBe("invalid");
  });

  it("decodeFrame rejects a fragmented (FIN=0) frame", () => {
    const raw = encodeClientFrame(OPCODE.TEXT, "hi");
    const fragmented = Buffer.from(raw);
    fragmented[0] = fragmented.readUInt8(0) & 0x7f; // clear FIN bit
    expect(decodeFrame(fragmented).status).toBe("invalid");
  });

  it("decodeFrame handles a close/ping frame with empty payload", () => {
    const raw = encodeClientFrame(OPCODE.CLOSE, "");
    const result = decodeFrame(raw);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.frame.opcode).toBe(OPCODE.CLOSE);
      expect(result.frame.payload.length).toBe(0);
    }
  });

  it("allows decoding two frames back to back by advancing frameLength", () => {
    const first = encodeClientFrame(OPCODE.TEXT, "one");
    const second = encodeClientFrame(OPCODE.TEXT, "two");
    const combined = Buffer.concat([first, second]);

    const firstResult = decodeFrame(combined);
    expect(firstResult.status).toBe("ok");
    if (firstResult.status !== "ok") return;
    expect(firstResult.frame.payload.toString("utf8")).toBe("one");

    const remaining = combined.subarray(firstResult.frame.frameLength);
    const secondResult = decodeFrame(remaining);
    expect(secondResult.status).toBe("ok");
    if (secondResult.status !== "ok") return;
    expect(secondResult.frame.payload.toString("utf8")).toBe("two");
  });
});
