import "server-only";

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { BackupArtifact, BackupVerificationResult, DatabaseBackupProvider } from "@/application/ports/database-backup-provider";

const execFileAsync = promisify(execFile);

export interface PgDumpDatabaseBackupProviderOptions {
  /** The `postgresql://...` connection string — read once at construction, never logged. */
  connectionString: string;
  /** Directory dump files are written to/read from. Created if missing. */
  storageDir: string;
  now?: () => Date;
}

/**
 * Module 54 — Backup & Disaster Recovery.
 *
 * The default `DatabaseBackupProvider`: shells out to PostgreSQL's own
 * `pg_dump`/`pg_restore` in the custom (`-Fc`) archive format, which is
 * compressed, supports `pg_restore --clean --if-exists` for a
 * transactional-as-possible restore, and — unlike plain-SQL `pg_dump`
 * output — lets `pg_restore` parallelize a large restore with `--jobs`.
 * This is the deployment-appropriate choice for the self-hosted/
 * `docker-compose.prod.yml` topology this module targets (see
 * `backup-config.ts`'s own doc comment); a managed-Postgres-provider
 * snapshot API is a different, equally valid implementation of this same
 * `DatabaseBackupProvider` port.
 *
 * ## FULL vs INCREMENTAL
 * `pg_dump` produces a logical, point-in-time dump of the whole database
 * — there is no logical-dump equivalent of a true incremental backup
 * (that requires WAL-based continuous archiving, a materially different
 * mechanism/provider this module does not implement today). This
 * provider therefore performs an identical full dump for both `type`
 * values; `since` is accepted (per the port's signature, for a future
 * WAL-based provider) and intentionally unused here. This is a real,
 * fully restorable backup either way — never a placeholder — the
 * `INCREMENTAL` distinction simply has no effect on *this* provider's
 * work today. See docs/MODULE_54_BACKUP_AND_DISASTER_RECOVERY.md,
 * "Incremental backups," for the full reasoning and the upgrade path.
 *
 * ## Never exposes sensitive information
 * `connectionString` (which embeds the database password) is never
 * passed as a CLI argument to the spawned `pg_dump`/`pg_restore`
 * process — CLI arguments are visible to every other process on the host
 * via `ps`. `toPgEnv()` instead parses it once into the standard
 * `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`/`PGSSLMODE`
 * environment variables both tools already read on their own, scoped to
 * the child process's own environment only. Every error thrown by this
 * class is passed through `redact()`, which additionally strips any
 * literal occurrence of the raw connection string before it can reach a
 * log line, a `BackupRecord.failureReason`, or an operator's terminal.
 */
export class PgDumpDatabaseBackupProvider implements DatabaseBackupProvider {
  private readonly connectionString: string;
  private readonly storageDir: string;
  private readonly now: () => Date;

  constructor(options: PgDumpDatabaseBackupProviderOptions) {
    this.connectionString = options.connectionString;
    this.storageDir = options.storageDir;
    this.now = options.now ?? (() => new Date());
  }

  async createBackup(type: "FULL" | "INCREMENTAL", _since: Date | null): Promise<BackupArtifact> {
    void type; // see this class's own doc comment — both types perform an identical full dump today.
    await mkdir(this.storageDir, { recursive: true });

    const fileName = `database-${this.now().toISOString().replace(/[:.]/g, "-")}.dump`;
    const filePath = path.join(this.storageDir, fileName);

    try {
      await execFileAsync("pg_dump", ["-Fc", "-f", filePath], { env: toPgEnv(this.connectionString) });
    } catch (error) {
      throw new Error(redact(`pg_dump failed while creating a ${type.toLowerCase()} database backup: ${describeExecError(error)}`, this.connectionString));
    }

    const { sizeBytes, checksumSha256 } = await hashFile(filePath);
    return { locationUri: filePath, sizeBytes, checksumSha256 };
  }

  async restoreBackup(artifact: BackupArtifact): Promise<void> {
    try {
      await execFileAsync("pg_restore", ["--clean", "--if-exists", artifact.locationUri], { env: toPgEnv(this.connectionString) });
    } catch (error) {
      throw new Error(redact(`pg_restore failed while restoring ${artifact.locationUri}: ${describeExecError(error)}`, this.connectionString));
    }
  }

  async verifyBackup(artifact: BackupArtifact): Promise<BackupVerificationResult> {
    try {
      const { checksumSha256 } = await hashFile(artifact.locationUri);
      if (checksumSha256 !== artifact.checksumSha256) {
        return { intact: false, reason: "Recomputed checksum does not match the checksum recorded at backup time." };
      }
      return { intact: true };
    } catch (error) {
      return { intact: false, reason: `Could not read backup artifact: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  async deleteBackup(artifact: BackupArtifact): Promise<void> {
    await rm(artifact.locationUri, { force: true });
  }
}

async function hashFile(filePath: string): Promise<{ sizeBytes: number; checksumSha256: string }> {
  const [fileStat, checksumSha256] = await Promise.all([stat(filePath), sha256OfFile(filePath)]);
  return { sizeBytes: fileStat.size, checksumSha256 };
}

function sha256OfFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/** Parses a `postgresql://user:pass@host:port/db?sslmode=...` connection string into the `PG*` environment variables `pg_dump`/`pg_restore` read natively — see this class's own doc comment for why. Falls back to inheriting `process.env` unchanged (and therefore whatever `PG*` variables, if any, are already set) when `connectionString` cannot be parsed as a URL, rather than throwing — a malformed `DATABASE_URL` here would already have failed Prisma's own connection at startup, so this is a defensive fallback, not the primary validation path. */
function toPgEnv(connectionString: string): NodeJS.ProcessEnv {
  try {
    const url = new URL(connectionString);
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (url.hostname) env.PGHOST = url.hostname;
    if (url.port) env.PGPORT = url.port;
    if (url.username) env.PGUSER = decodeURIComponent(url.username);
    if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);
    const database = url.pathname.replace(/^\//, "");
    if (database) env.PGDATABASE = database;
    const sslmode = url.searchParams.get("sslmode");
    if (sslmode) env.PGSSLMODE = sslmode;
    return env;
  } catch {
    return { ...process.env };
  }
}

function describeExecError(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

/** Strips any literal occurrence of the connection string (which embeds credentials) from an error message before it can be logged or surfaced. */
function redact(message: string, connectionString: string): string {
  return connectionString ? message.split(connectionString).join("[redacted]") : message;
}
