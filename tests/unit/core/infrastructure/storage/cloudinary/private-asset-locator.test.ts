import { describe, expect, it } from "vitest";

import { isCloudinaryDeliveryUrl, parseCloudinaryPrivateAssetUrl } from "@/infrastructure/storage/cloudinary/private-asset-locator";

describe("parseCloudinaryPrivateAssetUrl (Module 106)", () => {
  it("parses a signed private image delivery URL", () => {
    const url =
      "https://res.cloudinary.com/demo/image/private/s--AbCdEf12--/v1700000000/maestroya/verifications/v-1/doc-uuid.png";
    expect(parseCloudinaryPrivateAssetUrl(url)).toEqual({
      publicId: "maestroya/verifications/v-1/doc-uuid",
      resourceType: "image",
    });
  });

  it("parses a private URL without a signature segment", () => {
    const url = "https://res.cloudinary.com/demo/image/private/v1700000000/maestroya/verifications/v-1/doc-uuid.png";
    expect(parseCloudinaryPrivateAssetUrl(url)).toEqual({
      publicId: "maestroya/verifications/v-1/doc-uuid",
      resourceType: "image",
    });
  });

  it("resolves a PDF (raw resource type) by extension even if the URL segment says otherwise", () => {
    const url = "https://res.cloudinary.com/demo/raw/private/v1700000000/maestroya/verifications/v-1/doc-uuid.pdf";
    expect(parseCloudinaryPrivateAssetUrl(url)).toEqual({
      publicId: "maestroya/verifications/v-1/doc-uuid",
      resourceType: "raw",
    });
  });

  it("returns null for a malformed URL", () => {
    expect(parseCloudinaryPrivateAssetUrl("not-a-url")).toBeNull();
  });

  it("returns null for a URL with no version segment", () => {
    expect(parseCloudinaryPrivateAssetUrl("https://res.cloudinary.com/demo/image/private/maestroya/doc.png")).toBeNull();
  });

  it("returns null when the version segment is the last path segment (no public id)", () => {
    expect(parseCloudinaryPrivateAssetUrl("https://res.cloudinary.com/demo/image/private/v1700000000")).toBeNull();
  });
});

describe("isCloudinaryDeliveryUrl (Module 106 — SSRF defense-in-depth for the download proxy)", () => {
  it("accepts a res.cloudinary.com HTTPS URL", () => {
    expect(isCloudinaryDeliveryUrl("https://res.cloudinary.com/demo/image/private/v1/doc.png")).toBe(true);
  });

  it("accepts a *.cloudinary.com custom-CNAME HTTPS URL", () => {
    expect(isCloudinaryDeliveryUrl("https://assets.cloudinary.com/demo/image/private/v1/doc.png")).toBe(true);
  });

  it("rejects a plain HTTP URL (even on the right host)", () => {
    expect(isCloudinaryDeliveryUrl("http://res.cloudinary.com/demo/image/private/v1/doc.png")).toBe(false);
  });

  it("rejects a lookalike host that merely contains cloudinary.com", () => {
    expect(isCloudinaryDeliveryUrl("https://res.cloudinary.com.evil.example/demo/doc.png")).toBe(false);
  });

  it("rejects an arbitrary internal/SSRF-style URL", () => {
    expect(isCloudinaryDeliveryUrl("https://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(isCloudinaryDeliveryUrl("https://internal.maestroya.local/secrets")).toBe(false);
  });

  it("rejects a malformed URL", () => {
    expect(isCloudinaryDeliveryUrl("not-a-url")).toBe(false);
  });
});
