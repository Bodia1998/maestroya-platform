import { describe, expect, it } from "vitest";

/**
 * NOTE: this file was created as a throwaway diagnostic while validating
 * Module 54 (Backup & Disaster Recovery) and could not be deleted from
 * this environment afterward (file deletion in the mounted project
 * folder requires explicit user approval, which was not granted in this
 * session). It is left in place, repurposed as a real regression check,
 * rather than removed — a maintainer with local file access is welcome
 * to delete it; it is otherwise harmless and self-contained.
 *
 * What it documents: in a sandboxed CI/dev environment whose OS/CPU
 * platform doesn't match the one `@prisma/client` was last generated for
 * (e.g. a Prisma client generated on macOS/arm64 running under Linux/
 * arm64), *importing* any module that transitively imports
 * `infrastructure/database/prisma/client` throws a
 * `PrismaClientInitializationError` on the query engine failing to load
 * for the current runtime target. This is a pre-existing, environment-
 * specific limitation — not introduced by Module 54 — confirmed by
 * reproducing it here against a repository that predates this module
 * (`prisma-dispute-repository.ts`). Regenerating the client
 * (`npx prisma generate`) for the current platform resolves it; it is
 * otherwise unrelated to application code correctness.
 */
describe("environment: @prisma/client platform-target diagnostic", () => {
  it("importing an existing (pre-Module-54) Prisma repository does not throw synchronously", async () => {
    const mod = await import("@/infrastructure/database/prisma/repositories/prisma-dispute-repository");
    expect(mod).toBeTruthy();
  });
});
