import { DomainError } from "@/domain/errors/domain-error";
import { parseLegacyArchiveRunConfig } from "@/application/use-cases/legacy-archive/legacy-archive-run-config";
import { LEGACY_ARCHIVE_BLOCKERS } from "@/domain/services/legacy-archive-spec";

/**
 * Module 167 — Legacy Archive & Retention Export: standalone operator entry point.
 *
 *   npm run legacy-archive-export -- --output-dir /abs/path/outside/the/repo --authorize-database-host <db host> \
 *       [--include-invoice-content] [--include-narrative]
 *   npm run legacy-archive-export -- --verify /abs/path/of/an/existing/archive
 *
 * EXPORT reads the database `DATABASE_URL` points at, using a single READ ONLY / REPEATABLE READ transaction (the database itself
 * refuses writes), and writes ONLY into a new directory that must not exist, outside the repository and outside any Git work tree.
 * It deletes nothing, changes no record and is wired to no route or cron. It is an operator tool: point it at a disposable database
 * for development; run it against production ONLY with explicit authorization, and never in CI. `--authorize-database-host` must
 * equal the host of `DATABASE_URL`, so a stray `.env` cannot silently aim it at the wrong database. The output contains financial
 * records and pseudonymous ids: store it on an encrypted volume with restricted access, and never commit it.
 *
 * RESTORE REHEARSAL (`--restore-rehearsal <dir> --authorize-database-host <host> [--keep-scratch-schema]`) verifies the archive first,
 * then loads it into a new archive-shaped schema of a DISPOSABLE database (loopback host and a database name ending in "_scratch" or
 * "_test" are required) and checks counts, checksums, exact totals and references; it rolls back unless --keep-scratch-schema is given.
 * Pin the digests recorded at export time with `--expect-manifest-sha256 <hex>` / `--expect-archive-digest <hex>` (verify + rehearsal).
 *
 * VERIFY needs no database and no environment: it re-checks an archive's checksums, counts, ordering, references and exact money
 * totals from its files alone.
 *
 * FAIL CLOSED: any configuration, access, integrity or write problem prints the error code and exits 2 — nothing is published, and
 * success is never reported after a partial failure. Output lists counts, hashes and ids of decisions only; never record contents.
 *
 * Exit codes: 0 = export complete and verified / archive verified; 1 = verification found issues; 2 = nothing could be produced.
 * "Complete" means the engineering export is complete and verified; it is NOT an approved retention archive (see the blockers).
 */

function describe(error: unknown): string {
  if (error instanceof DomainError) return `${error.code}: ${error.message}`;
  const e = error instanceof Error ? error : new Error(String(error));
  return `${e.name}: ${e.message.split("\n")[0]?.slice(0, 300) ?? ""}`;
}

async function main(): Promise<number> {
  let config;
  try {
    config = parseLegacyArchiveRunConfig({ argv: process.argv.slice(2), env: process.env, repoRoot: process.cwd() });
  } catch (error) {
    console.error(`legacy-archive-export: invalid arguments (fail closed). ${describe(error)}`);
    return 2;
  }

  if (config.mode === "verify") {
    try {
      const { makeVerifyLegacyArchiveUseCase } = await import("@/application/use-cases/legacy-archive/compose-verify");
      const result = await makeVerifyLegacyArchiveUseCase().execute(config.archivePath, config.pins);
      if (result.ok) {
        const pinned = result.pinned.manifestSha256 || result.pinned.archiveDigest ? `pinned to externally recorded ${[result.pinned.manifestSha256 ? "manifest sha256" : "", result.pinned.archiveDigest ? "archive digest" : ""].filter(Boolean).join(" + ")}` : "NOT pinned: consistency only, a consistently rewritten archive would pass";
        console.log(`legacy-archive-export: archive VERIFIED (${Object.values(result.recordCounts).reduce((a, b) => a + b, 0)} records, manifest sha256 ${result.manifestSha256}; ${pinned}). Verification proves integrity, not retention approval.`);
        return 0;
      }
      console.error(`legacy-archive-export: archive FAILED verification with ${result.issues.length} issue(s):`);
      for (const issue of result.issues) console.error(`  - ${issue.code}${issue.category ? ` [${issue.category}]` : ""}: ${issue.detail}`);
      return 1;
    } catch (error) {
      console.error(`legacy-archive-export: the archive could not be read (fail closed). ${describe(error)}`);
      return 2;
    }
  }

  if (config.mode === "restore-rehearsal") {
    try {
      const { makeRestoreLegacyArchiveRehearsalUseCase } = await import("@/application/use-cases/legacy-archive/compose-restore");
      const result = await makeRestoreLegacyArchiveRehearsalUseCase().execute(config.archivePath, { keepSchema: config.keepSchema, pins: config.pins });
      console.log(`legacy-archive-export: restore rehearsal into ${config.databaseHost} (scratch, archive-shaped schema) - ${result.ok ? "PASSED" : "FAILED"}`);
      console.log(`  manifest sha256: ${result.manifestSha256}`);
      console.log(`  pins:            ${config.pins.manifestSha256 || config.pins.archiveDigest ? "externally recorded digest(s) matched" : "none given (consistency only)"}`);
      console.log("  category                          rows  checksum-roundtrip");
      for (const [key, f] of Object.entries(result.figures.tables)) console.log(`  ${key.padEnd(33)} ${String(f.count).padStart(5)}  ${result.issues.some((i) => i.category === key && i.code === "RESTORE_CHECKSUM_MISMATCH") ? "MISMATCH" : "ok"}`);
      for (const n of result.invoiceNet) console.log(`  invoices ${n.currency}: invoiced ${n.invoiced} - credit notes ${n.creditNoted} = net ${n.net}`);
      for (const issue of result.issues) console.error(`  - ${issue.code}${issue.category ? ` [${issue.category}]` : ""}: ${issue.detail}`);
      console.log(result.keptSchema ? `  scratch schema KEPT: ${result.keptSchema} (drop it when finished)` : "  scratch schema rolled back; nothing left in the database.");
      console.log("  Proves the archive loads and reconciles in PostgreSQL; it does not prove the archive is complete, approved or a path back into the live system.");
      return result.ok ? 0 : 1;
    } catch (error) {
      console.error(`legacy-archive-export: the restore rehearsal could not run (fail closed; nothing was kept). ${describe(error)}`);
      return 2;
    }
  }

  try {
    const { makeExportLegacyArchiveUseCase } = await import("@/application/use-cases/legacy-archive/compose-export");
    const result = await makeExportLegacyArchiveUseCase().execute({ targetPath: config.targetPath, options: config.options });
    console.log(`legacy-archive-export: export COMPLETE and VERIFIED (read back from storage).`);
    console.log(`  target:          ${result.targetPath}`);
    console.log(`  generated at:    ${result.generatedAt.toISOString()}`);
    console.log(`  options:         includeInvoiceContent=${config.options.includeInvoiceContent} includeNarrative=${config.options.includeNarrative}`);
    console.log(`  total records:   ${result.totalRecords}`);
    console.log(`  manifest sha256: ${result.manifestSha256}`);
    console.log(`  archive digest:  ${result.archiveDigest}`);
    console.log("  category                          records  out-of-scope  db-control");
    for (const c of result.categories) console.log(`  ${c.key.padEnd(33)} ${String(c.recordCount).padStart(7)}  ${String(c.outOfScopeCount).padStart(12)}  ${c.controlled ? "yes" : "n/a (scoped in memory)"}`);
    console.log("  RECORD manifest sha256 and archive digest SEPARATELY from the archive (ticket / password manager): later verification is only tamper-evident if checked with --expect-*.");
    console.log("  NOT an approved retention archive. Unresolved decisions/gaps recorded in the manifest:");
    for (const b of LEGACY_ARCHIVE_BLOCKERS) console.log(`    ${b.id} [${b.kind}] ${b.title}`);
    return 0;
  } catch (error) {
    if (error instanceof DomainError && error.code === "LEGACY_ARCHIVE_PUBLISHED_UNCONFIRMED") {
      console.error(`legacy-archive-export: the archive WAS published at ${(error as DomainError & { targetPath: string }).targetPath} but is not confirmed durable (fail closed). ${describe(error)}`);
      return 2;
    }
    console.error(`legacy-archive-export: the export failed and nothing was published (fail closed). ${describe(error)}`);
    return 2;
  }
}

void main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`legacy-archive-export: unexpected failure (fail closed). ${describe(error)}`);
    process.exit(2);
  },
);
