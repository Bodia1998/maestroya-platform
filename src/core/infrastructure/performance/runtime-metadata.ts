import "server-only";

import { execFileSync } from "node:child_process";

import packageJson from "../../../../package.json";

import type { LoadTestRunMetadata } from "@/domain/repositories/load-test-result-repository";

/**
 * Module 57 — Load Testing & Capacity Planning.
 *
 * Resolves the provenance metadata `PersistCapacityReportUseCase` stamps
 * onto the `LoadTestRun` row that anchors a full capacity-report run:
 * which commit/branch produced it, which app version, and which
 * environment it ran in. Every git lookup is read-only (`git rev-parse`)
 * and wrapped so a missing `git` binary or a checkout that isn't a repo
 * (e.g. a deploy artifact with `.git` stripped) degrades to `null` fields
 * rather than failing the whole report — this metadata is diagnostic
 * context for a report, never a requirement for producing one.
 */
export function resolveRuntimeMetadata(): LoadTestRunMetadata {
  return {
    gitCommit: readGit(["rev-parse", "HEAD"]),
    gitBranch: readGit(["rev-parse", "--abbrev-ref", "HEAD"]),
    appVersion: packageJson.version ?? null,
    environment: process.env.LOAD_TEST_ENVIRONMENT ?? process.env.NODE_ENV ?? null,
  };
}

function readGit(args: readonly string[]): string | null {
  try {
    const output = execFileSync("git", args as string[], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return output.length > 0 ? output : null;
  } catch {
    return null;
  }
}
