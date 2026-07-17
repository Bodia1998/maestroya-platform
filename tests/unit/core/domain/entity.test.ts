import { describe, expect, it } from "vitest";

import { Entity } from "@/domain/entities/entity";

// Minimal concrete subclass purely for testing the abstract base class.
class TestEntity extends Entity<{ name: string }> {
  static create(name: string, id: string) {
    return new TestEntity({ name }, id);
  }
}

describe("Entity", () => {
  it("is equal to another entity with the same id", () => {
    const a = TestEntity.create("Alice", "id-1");
    const b = TestEntity.create("Bob", "id-1");

    expect(a.equals(b)).toBe(true);
  });

  it("is not equal to an entity with a different id", () => {
    const a = TestEntity.create("Alice", "id-1");
    const b = TestEntity.create("Alice", "id-2");

    expect(a.equals(b)).toBe(false);
  });

  it("is not equal to undefined", () => {
    const a = TestEntity.create("Alice", "id-1");

    expect(a.equals(undefined)).toBe(false);
  });
});

/**
 * Note the imports above: no Next.js, no Prisma, no React, no HTTP mocking.
 * This test runs in milliseconds because the domain layer has zero
 * framework dependencies — that isolation is the entire point of Clean
 * Architecture, and it's worth protecting as real modules get added here.
 */
