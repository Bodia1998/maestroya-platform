import { describe, expect, it } from "vitest";

import {
  applyCarrierToHeaders,
  carrierFromHeaders,
  carrierFromRecord,
  hasTraceContext,
  TRACE_CONTEXT_HEADERS,
} from "@/infrastructure/tracing/trace-carrier";

describe("infrastructure/tracing/trace-carrier", () => {
  it("TRACE_CONTEXT_HEADERS is exactly the W3C Trace Context header pair", () => {
    expect(TRACE_CONTEXT_HEADERS).toEqual(["traceparent", "tracestate"]);
  });

  describe("carrierFromHeaders", () => {
    it("extracts traceparent/tracestate when present", () => {
      const headers = new Headers({
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        tracestate: "vendor=value",
        "x-request-id": "should-not-be-copied",
      });
      expect(carrierFromHeaders(headers)).toEqual({
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        tracestate: "vendor=value",
      });
    });

    it("returns an empty carrier when no trace-context headers are present", () => {
      expect(carrierFromHeaders(new Headers({ "content-type": "application/json" }))).toEqual({});
    });

    it("never copies arbitrary headers (cookies, Authorization) into the carrier", () => {
      const headers = new Headers({ cookie: "session=secret", authorization: "Bearer token" });
      expect(carrierFromHeaders(headers)).toEqual({});
    });
  });

  describe("carrierFromRecord", () => {
    it("extracts trace-context fields from a plain record", () => {
      const record = { traceparent: "00-abc-def-01", queue: "jobs", data: {} };
      expect(carrierFromRecord(record)).toEqual({ traceparent: "00-abc-def-01" });
    });

    it("returns {} for null/undefined input", () => {
      expect(carrierFromRecord(null)).toEqual({});
      expect(carrierFromRecord(undefined)).toEqual({});
    });

    it("ignores non-string values at the trace-context keys", () => {
      expect(carrierFromRecord({ traceparent: 12345 })).toEqual({});
    });
  });

  describe("applyCarrierToHeaders", () => {
    it("writes carrier entries onto the given Headers in place", () => {
      const headers = new Headers();
      applyCarrierToHeaders({ traceparent: "00-abc-def-01" }, headers);
      expect(headers.get("traceparent")).toBe("00-abc-def-01");
    });

    it("skips falsy values", () => {
      const headers = new Headers();
      applyCarrierToHeaders({ traceparent: "" }, headers);
      expect(headers.has("traceparent")).toBe(false);
    });
  });

  describe("hasTraceContext", () => {
    it("is false for null/undefined/empty carriers", () => {
      expect(hasTraceContext(null)).toBe(false);
      expect(hasTraceContext(undefined)).toBe(false);
      expect(hasTraceContext({})).toBe(false);
    });

    it("is true when a carrier holds at least one entry", () => {
      expect(hasTraceContext({ traceparent: "00-abc-def-01" })).toBe(true);
    });
  });
});
