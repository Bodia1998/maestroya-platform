import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "@/core/infrastructure/auth/password";

describe("password hashing", () => {
  it("verifies a correct password against its hash", async () => {
    const hash = await hashPassword("Sup3rSecret!");
    await expect(verifyPassword("Sup3rSecret!", hash)).resolves.toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("Sup3rSecret!");
    await expect(verifyPassword("WrongPassword1", hash)).resolves.toBe(false);
  });

  it("produces a different hash each time (salted)", async () => {
    const hashA = await hashPassword("Sup3rSecret!");
    const hashB = await hashPassword("Sup3rSecret!");
    expect(hashA).not.toBe(hashB);
  });

  it("never stores the plaintext password in the hash output", async () => {
    const hash = await hashPassword("Sup3rSecret!");
    expect(hash).not.toContain("Sup3rSecret!");
  });
});
