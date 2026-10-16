import path from "node:path";

import { DomainError } from "@/domain/errors/domain-error";
import { DEFAULT_LEGACY_ARCHIVE_OPTIONS, type ArchivePins, type LegacyArchiveOptions } from "@/domain/services/legacy-archive";

export class LegacyArchiveConfigError extends DomainError {
  readonly code = "LEGACY_ARCHIVE_CONFIG_INVALID";
}

export type LegacyArchiveRunConfig =
  | { mode: "verify"; archivePath: string; pins: ArchivePins }
  | { mode: "restore-rehearsal"; archivePath: string; pins: ArchivePins; keepSchema: boolean; databaseHost: string }
  | { mode: "export"; targetPath: string; options: LegacyArchiveOptions; databaseHost: string };

const VALUE_FLAGS = new Set(["--output-dir", "--authorize-database-host", "--verify", "--restore-rehearsal", "--expect-manifest-sha256", "--expect-archive-digest"]);
const BOOLEAN_FLAGS = new Set(["--include-invoice-content", "--include-narrative", "--keep-scratch-schema"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const HEX_64 = /^[0-9a-f]{64}$/;
/**
 * A scratch database is named as one: lowercase letters, digits and underscores, ending in a `_test` or `_scratch` segment (or just
 * `test` / `scratch`). `maestroya_test` passes; `latest`, `contest`, `test_prod`, `maestroya` and `MaestroYa-Test` do not. This is a
 * naming convention that catches mistakes; it cannot tell what a loopback port really leads to (an SSH tunnel to a remote database
 * looks like localhost), so the operator's authorization remains the real control.
 */
const SCRATCH_DATABASE_NAME = /^(?:[a-z][a-z0-9_]*_)?(?:test|scratch)$/;

/**
 * Module 167 — parses and validates the operator script's arguments. FAIL CLOSED: every unknown, duplicated, missing or
 * inconsistent input throws; nothing is defaulted that could point an export at the wrong place.
 *
 * Export requires, all explicit:
 *  - `--output-dir <absolute path>` outside the repository (an export must never end up in Git);
 *  - `--authorize-database-host <host>` equal to the host of `DATABASE_URL` — the operator's statement of which database is being
 *    read, so a stray `.env` cannot silently point the export at production;
 *  - `DATABASE_URL`.
 * Messages never echo the connection string, credentials or either host.
 */
export function parseLegacyArchiveRunConfig(input: { argv: readonly string[]; env: Readonly<Record<string, string | undefined>>; repoRoot: string }): LegacyArchiveRunConfig {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < input.argv.length; i += 1) {
    const arg = input.argv[i]!;
    const eq = arg.indexOf("=");
    const name = eq > 0 ? arg.slice(0, eq) : arg;
    if (VALUE_FLAGS.has(name)) {
      const value = eq > 0 ? arg.slice(eq + 1) : input.argv[++i];
      if (value === undefined || value === "" || value.startsWith("--")) throw new LegacyArchiveConfigError(`${name} requires a value.`);
      if (values.has(name)) throw new LegacyArchiveConfigError(`${name} was given more than once.`);
      values.set(name, value);
    } else if (BOOLEAN_FLAGS.has(arg)) {
      if (flags.has(arg)) throw new LegacyArchiveConfigError(`${arg} was given more than once.`);
      flags.add(arg);
    } else {
      throw new LegacyArchiveConfigError(`Unknown argument "${name}".`);
    }
  }

  const absolute = (label: string, value: string): string => {
    if (value.includes("\0") || !path.isAbsolute(value)) throw new LegacyArchiveConfigError(`${label} must be an absolute path.`);
    return path.resolve(value);
  };

  const authorizedDatabase = (): { host: string; name: string } => {
    const authorizedHost = values.get("--authorize-database-host");
    if (authorizedHost === undefined) throw new LegacyArchiveConfigError("--authorize-database-host is required: state the host of the database you are authorized to read.");
    const databaseUrl = input.env.DATABASE_URL;
    if (!databaseUrl) throw new LegacyArchiveConfigError("DATABASE_URL is not set.");
    let databaseHost: string;
    let databaseName: string;
    try {
      const url = new URL(databaseUrl);
      databaseHost = url.hostname.toLowerCase();
      databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
    } catch {
      throw new LegacyArchiveConfigError("DATABASE_URL is not a valid URL.");
    }
    if (databaseHost === "") throw new LegacyArchiveConfigError("DATABASE_URL has no host.");
    if (authorizedHost.trim().toLowerCase() !== databaseHost) throw new LegacyArchiveConfigError("--authorize-database-host does not match the host of DATABASE_URL; refusing to read.");
    return { host: databaseHost, name: databaseName };
  };

  const pins: ArchivePins = {};
  const pin = (flag: string): string | undefined => {
    const v = values.get(flag)?.trim().toLowerCase();
    if (v !== undefined && !HEX_64.test(v)) throw new LegacyArchiveConfigError(`${flag} must be 64 lowercase hexadecimal characters.`);
    return v;
  };
  const expectedManifest = pin("--expect-manifest-sha256");
  const expectedDigest = pin("--expect-archive-digest");
  if (expectedManifest !== undefined) pins.manifestSha256 = expectedManifest;
  if (expectedDigest !== undefined) pins.archiveDigest = expectedDigest;
  const pinFlags = ["--expect-manifest-sha256", "--expect-archive-digest"].filter((f) => values.has(f)).length;

  const verifyPath = values.get("--verify");
  const restorePath = values.get("--restore-rehearsal");
  if (verifyPath !== undefined && restorePath !== undefined) throw new LegacyArchiveConfigError("--verify and --restore-rehearsal cannot be combined.");
  if (verifyPath !== undefined) {
    if (values.size > 1 + pinFlags || flags.size > 0) throw new LegacyArchiveConfigError("--verify cannot be combined with export arguments (only --expect-manifest-sha256 / --expect-archive-digest are allowed).");
    return { mode: "verify", archivePath: absolute("--verify", verifyPath), pins };
  }
  if (restorePath !== undefined) {
    if (values.has("--output-dir") || flags.has("--include-invoice-content") || flags.has("--include-narrative")) throw new LegacyArchiveConfigError("--restore-rehearsal cannot be combined with export arguments.");
    const { host: databaseHost, name: databaseName } = authorizedDatabase();
    if (!LOOPBACK_HOSTS.has(databaseHost)) throw new LegacyArchiveConfigError("--restore-rehearsal only runs against a loopback database (localhost, 127.0.0.1, ::1); refusing.");
    if (!SCRATCH_DATABASE_NAME.test(databaseName)) throw new LegacyArchiveConfigError("--restore-rehearsal requires a database name that ends in \"_test\" or \"_scratch\" (lowercase letters, digits, underscores); refusing.");
    return { mode: "restore-rehearsal", archivePath: absolute("--restore-rehearsal", restorePath), pins, keepSchema: flags.has("--keep-scratch-schema"), databaseHost };
  }
  if (flags.has("--keep-scratch-schema") || pinFlags > 0) throw new LegacyArchiveConfigError("--keep-scratch-schema and the --expect-* pins apply to --verify / --restore-rehearsal only.");

  const output = values.get("--output-dir");
  if (output === undefined) throw new LegacyArchiveConfigError("--output-dir is required.");
  const targetPath = absolute("--output-dir", output);
  const repoRoot = path.resolve(input.repoRoot);
  const relative = path.relative(repoRoot, targetPath);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) throw new LegacyArchiveConfigError("--output-dir must be outside the repository: an export must never be placed where it could be committed.");

  const { host: databaseHost } = authorizedDatabase();

  return {
    mode: "export",
    targetPath,
    databaseHost,
    options: { ...DEFAULT_LEGACY_ARCHIVE_OPTIONS, includeInvoiceContent: flags.has("--include-invoice-content"), includeNarrative: flags.has("--include-narrative") },
  };
}
