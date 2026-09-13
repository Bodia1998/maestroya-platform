import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CloudinaryPrivateDocumentDeliveryService,
  DocumentDeliveryFailedError,
  UnresolvableDocumentUrlError,
} from "@/infrastructure/storage/cloudinary/private-document-delivery-service";

/**
 * Module 106 — Secure Cloudinary Document Delivery.
 *
 * Unit coverage for the server-side-only Cloudinary fetch helper behind
 * both download routes. Confirms: it refuses to fetch anything that
 * isn't recognizably one of this app's own private-upload URLs (SSRF
 * defense-in-depth / Threat 9), it never needs or touches the Cloudinary
 * API key/secret (the fetch is a plain HTTPS GET against the
 * already-signed stored URL — no credential material is read from `env`
 * anywhere in this class), and it surfaces provider failures as a typed
 * error rather than letting a raw fetch rejection/HTTP status leak
 * upward.
 */
const originalFetch = global.fetch;

describe("CloudinaryPrivateDocumentDeliveryService", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("fetches a valid private Cloudinary document URL and returns its bytes", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(bytes, { status: 200 }) as unknown as Response,
    );

    const service = new CloudinaryPrivateDocumentDeliveryService();
    const result = await service.fetchDocument(
      "https://res.cloudinary.com/demo/image/private/s--sig--/v1/maestroya/verifications/v-1/doc-1.png",
    );

    expect(Buffer.from(result.body)).toEqual(Buffer.from(bytes));
    expect(global.fetch).toHaveBeenCalledWith(
      "https://res.cloudinary.com/demo/image/private/s--sig--/v1/maestroya/verifications/v-1/doc-1.png",
      { cache: "no-store" },
    );
  });

  it("refuses a non-Cloudinary URL without ever calling fetch (SSRF defense-in-depth)", async () => {
    const service = new CloudinaryPrivateDocumentDeliveryService();

    await expect(service.fetchDocument("https://attacker.example/steal")).rejects.toThrow(
      UnresolvableDocumentUrlError,
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses a Cloudinary-hosted URL that doesn't match this app's own private-upload shape", async () => {
    const service = new CloudinaryPrivateDocumentDeliveryService();

    await expect(service.fetchDocument("https://res.cloudinary.com/demo/image/upload/logo.png")).rejects.toThrow(
      UnresolvableDocumentUrlError,
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("wraps a non-2xx Cloudinary response as a typed delivery failure, not a raw leak", async () => {
    vi.mocked(global.fetch).mockResolvedValue(new Response(null, { status: 404 }) as unknown as Response);
    const service = new CloudinaryPrivateDocumentDeliveryService();

    await expect(
      service.fetchDocument("https://res.cloudinary.com/demo/image/private/v1/maestroya/verifications/v-1/doc-1.png"),
    ).rejects.toThrow(DocumentDeliveryFailedError);
  });

  it("wraps a network failure as a typed delivery failure", async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error("ECONNRESET"));
    const service = new CloudinaryPrivateDocumentDeliveryService();

    await expect(
      service.fetchDocument("https://res.cloudinary.com/demo/image/private/v1/maestroya/verifications/v-1/doc-1.png"),
    ).rejects.toThrow(DocumentDeliveryFailedError);
  });

  it("never reads any Cloudinary credential from the environment — the source file has no env/config import at all", async () => {
    const path = await import("node:path");
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      path.join(process.cwd(), "src/core/infrastructure/storage/cloudinary/private-document-delivery-service.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/CLOUDINARY_API_(KEY|SECRET)/);
    expect(source).not.toMatch(/from ["']@\/infrastructure\/config\/env["']/);
  });
});
