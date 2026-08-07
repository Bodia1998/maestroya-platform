import { describe, expect, it } from "vitest";

import { RedisReplyError, encodeCommand, parseReply } from "@/infrastructure/cache/redis-protocol";

describe("infrastructure/cache/redis-protocol", () => {
  describe("encodeCommand", () => {
    it("encodes a command as a RESP2 array of bulk strings", () => {
      const encoded = encodeCommand(["SET", "foo", "bar"]);
      expect(encoded.toString("utf8")).toBe("*3\r\n$3\r\nSET\r\n$3\r\nfoo\r\n$3\r\nbar\r\n");
    });

    it("coerces numeric arguments to their string form", () => {
      const encoded = encodeCommand(["PEXPIRE", "key", 1000]);
      expect(encoded.toString("utf8")).toBe("*3\r\n$7\r\nPEXPIRE\r\n$3\r\nkey\r\n$4\r\n1000\r\n");
    });

    it("length-prefixes using UTF-8 byte length, not JS string length", () => {
      // "café" is 4 JS chars but 5 UTF-8 bytes (é is 2 bytes).
      const encoded = encodeCommand(["SET", "k", "café"]);
      expect(encoded.toString("utf8")).toContain("$5\r\ncafé\r\n");
    });
  });

  describe("parseReply", () => {
    it("parses a simple string reply (+OK)", () => {
      const buf = Buffer.from("+OK\r\n", "utf8");
      const result = parseReply(buf, 0);
      expect(result).toEqual({ value: "OK", bytesConsumed: 5 });
    });

    it("parses an integer reply (:1000)", () => {
      const buf = Buffer.from(":1000\r\n", "utf8");
      const result = parseReply(buf, 0);
      expect(result).toEqual({ value: 1000, bytesConsumed: 7 });
    });

    it("parses a bulk string reply", () => {
      const buf = Buffer.from("$5\r\nhello\r\n", "utf8");
      const result = parseReply(buf, 0);
      expect(result).toEqual({ value: "hello", bytesConsumed: 11 });
    });

    it("parses a null bulk string ($-1) as null", () => {
      const buf = Buffer.from("$-1\r\n", "utf8");
      const result = parseReply(buf, 0);
      expect(result).toEqual({ value: null, bytesConsumed: 5 });
    });

    it("parses a null array (*-1) as null", () => {
      const buf = Buffer.from("*-1\r\n", "utf8");
      const result = parseReply(buf, 0);
      expect(result).toEqual({ value: null, bytesConsumed: 5 });
    });

    it("parses a nested array reply (e.g. an EVAL table return)", () => {
      const buf = Buffer.from("*2\r\n:1\r\n*2\r\n$3\r\nfoo\r\n$3\r\nbar\r\n", "utf8");
      const result = parseReply(buf, 0);
      expect(result?.value).toEqual([1, ["foo", "bar"]]);
    });

    it("parses an error reply as a RedisReplyError", () => {
      const buf = Buffer.from("-ERR unknown command 'FOO'\r\n", "utf8");
      const result = parseReply(buf, 0);
      expect(result?.value).toBeInstanceOf(RedisReplyError);
      expect((result?.value as RedisReplyError).message).toBe("ERR unknown command 'FOO'");
    });

    it("returns null (needs more data) for a truncated bulk string", () => {
      // Claims 5 bytes but only 2 are present, and no trailing \r\n yet.
      const buf = Buffer.from("$5\r\nhe", "utf8");
      expect(parseReply(buf, 0)).toBeNull();
    });

    it("returns null (needs more data) for a reply with no terminating \\r\\n at all", () => {
      const buf = Buffer.from("+OK", "utf8");
      expect(parseReply(buf, 0)).toBeNull();
    });

    it("returns null when an array is missing a trailing element", () => {
      const buf = Buffer.from("*2\r\n$3\r\nfoo\r\n", "utf8");
      expect(parseReply(buf, 0)).toBeNull();
    });

    it("parses starting at a nonzero offset (as used when draining a shared socket buffer)", () => {
      const buf = Buffer.from("garbage-prefix+OK\r\n", "utf8");
      const result = parseReply(buf, "garbage-prefix".length);
      expect(result).toEqual({ value: "OK", bytesConsumed: 5 });
    });

    it("throws on an unrecognized leading type byte", () => {
      const buf = Buffer.from("?nonsense\r\n", "utf8");
      expect(() => parseReply(buf, 0)).toThrow(/Unsupported RESP2 type byte/);
    });

    it("round-trips a full request/response pair for a realistic multi-arg command", () => {
      const request = encodeCommand(["EVAL", "return 1", "1", "mykey", 5, 60000]);
      expect(request.toString("utf8")).toContain("*6\r\n");
      const decoded = parseReply(request, 0);
      expect(decoded?.value).toEqual(["EVAL", "return 1", "1", "mykey", "5", "60000"]);
    });
  });
});
