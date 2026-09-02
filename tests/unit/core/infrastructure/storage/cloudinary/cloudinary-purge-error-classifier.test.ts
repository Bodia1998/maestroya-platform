import { describe, expect, it } from "vitest";

import {
  classifyCloudinaryPurgeError,
  classifyStorageDeletionError,
  describeCloudinaryPurgeError,
  PERMANENT_PURGE_ERROR_CATEGORIES,
} from "@/infrastructure/storage/cloudinary/cloudinary-purge-error-classifier";
import {
  StorageDeletionFailedError,
  UnresolvableStorageUrlError,
} from "@/infrastructure/storage/cloudinary/verification-document-deletion-service";

describe("Module 94 — classifyCloudinaryPurgeError", () => {
  it.each([
    [401, "AUTHENTICATION"],
    [403, "AUTHENTICATION"],
    [420, "RATE_LIMITED"],
    [429, "RATE_LIMITED"],
    [404, "NOT_FOUND"],
    [400, "INVALID_REQUEST"],
    [500, "TRANSIENT"],
    [503, "TRANSIENT"],
  ] as const)("maps http_code %d to %s", (httpCode, expected) => {
    expect(classifyCloudinaryPurgeError({ http_code: httpCode, message: "x" })).toBe(expected);
  });

  it.each(["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "ECONNREFUSED", "EAI_AGAIN", "EPIPE"])(
    "maps network error code %s to TRANSIENT",
    (code) => {
      expect(classifyCloudinaryPurgeError({ code, message: "network failure" })).toBe("TRANSIENT");
    },
  );

  it("falls back to message sniffing when no http_code/code is present", () => {
    expect(classifyCloudinaryPurgeError(new Error("Request timed out"))).toBe("TRANSIENT");
    expect(classifyCloudinaryPurgeError(new Error("Rate limit exceeded"))).toBe("RATE_LIMITED");
    expect(classifyCloudinaryPurgeError(new Error("Invalid API key, unauthorized"))).toBe("AUTHENTICATION");
  });

  it("returns UNKNOWN for a completely unrecognized error shape, never throws", () => {
    expect(classifyCloudinaryPurgeError("a plain string")).toBe("UNKNOWN");
    expect(classifyCloudinaryPurgeError(null)).toBe("UNKNOWN");
    expect(classifyCloudinaryPurgeError(undefined)).toBe("UNKNOWN");
    expect(classifyCloudinaryPurgeError({})).toBe("UNKNOWN");
  });

  it("PERMANENT_PURGE_ERROR_CATEGORIES contains exactly AUTHENTICATION and INVALID_REQUEST", () => {
    expect([...PERMANENT_PURGE_ERROR_CATEGORIES].sort()).toEqual(["AUTHENTICATION", "INVALID_REQUEST"]);
  });
});

describe("Module 94 — classifyStorageDeletionError", () => {
  it("classifies UnresolvableStorageUrlError as INVALID_REQUEST (never retryable)", () => {
    expect(classifyStorageDeletionError(new UnresolvableStorageUrlError("https://not-cloudinary.example/x"))).toBe(
      "INVALID_REQUEST",
    );
  });

  it("classifies a StorageDeletionFailedError by its wrapped cause", () => {
    const error = new StorageDeletionFailedError("https://example.invalid/x.pdf", { http_code: 401, message: "nope" });
    expect(classifyStorageDeletionError(error)).toBe("AUTHENTICATION");
  });

  it("classifies an unrelated raw error via the general classifier", () => {
    expect(classifyStorageDeletionError(new Error("timeout"))).toBe("TRANSIENT");
  });
});

describe("Module 94 — describeCloudinaryPurgeError", () => {
  it("redacts URLs and bounds message length", () => {
    const longMessage = "failed at https://res.cloudinary.com/secret/path " + "x".repeat(500);
    const described = describeCloudinaryPurgeError("TRANSIENT", new Error(longMessage));
    expect(described).not.toContain("res.cloudinary.com");
    expect(described.length).toBeLessThanOrEqual(320);
    expect(described.startsWith("TRANSIENT:")).toBe(true);
  });
});
