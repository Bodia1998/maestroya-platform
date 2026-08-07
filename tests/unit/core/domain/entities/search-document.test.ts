import { describe, expect, it } from "vitest";

import { buildSearchDocumentId } from "@/domain/entities/search-document";

describe("domain/entities/search-document", () => {
  describe("buildSearchDocumentId", () => {
    it("prefixes the id with the lowercased kind", () => {
      expect(buildSearchDocumentId("PROFESSIONAL", "abc-123")).toBe("professional:abc-123");
      expect(buildSearchDocumentId("COMPANY", "abc-123")).toBe("company:abc-123");
      expect(buildSearchDocumentId("SERVICE_REQUEST", "abc-123")).toBe("service_request:abc-123");
    });

    it("is deterministic — the same kind/entityId always produces the same id", () => {
      expect(buildSearchDocumentId("PROFESSIONAL", "abc-123")).toBe(buildSearchDocumentId("PROFESSIONAL", "abc-123"));
    });

    it("keeps professionals and service requests from colliding even if they share a UUID", () => {
      const sameEntityId = "11111111-1111-1111-1111-111111111111";
      expect(buildSearchDocumentId("PROFESSIONAL", sameEntityId)).not.toBe(
        buildSearchDocumentId("SERVICE_REQUEST", sameEntityId),
      );
    });
  });
});
