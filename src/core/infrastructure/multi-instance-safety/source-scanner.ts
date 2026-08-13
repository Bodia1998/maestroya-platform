import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Module 58 — Multi-Instance Safety Audit.
 *
 * The one small piece of infrastructure every checker in this module
 * shares: reading a source file, relative to the repository root, without
 * throwing when it is absent. This is deliberately the *only*
 * infrastructure primitive this module needs — every checker is
 * read-only static analysis over the repository's own already-committed
 * source tree, never a call to a real database, cache, or external
 * service (the same "in-process, no external system" posture Module 57's
 * `BenchmarkRunner` takes, for the analogous reason: this is a dev/CI
 * engineering tool, not production business logic).
 *
 * `repoRoot` defaults to `process.cwd()` — correct when this module runs
 * via `npm run multi-instance-audit` (the project root) or via `vitest`
 * (also invoked from the project root) — but is an injectable
 * constructor parameter so a test can point it at a fixture directory
 * instead of the real repository.
 */
export class SourceScanner {
  constructor(private readonly repoRoot: string = process.cwd()) {}

  /** The file's UTF-8 contents, or `null` if it does not exist or cannot be read. */
  async read(relativePath: string): Promise<string | null> {
    try {
      return await readFile(path.join(this.repoRoot, relativePath), "utf8");
    } catch {
      return null;
    }
  }

  /** Whether `relativePath` exists and matches `pattern` (a substring or a regular expression). `false` — not a throw — when the file is absent. */
  async contains(relativePath: string, pattern: RegExp | string): Promise<boolean> {
    const content = await this.read(relativePath);
    if (content === null) return false;
    return typeof pattern === "string" ? content.includes(pattern) : pattern.test(content);
  }

  /** Whether `relativePath` exists at all, regardless of content. */
  async exists(relativePath: string): Promise<boolean> {
    return (await this.read(relativePath)) !== null;
  }
}
