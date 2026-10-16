import { describe, expect, it, vi } from "vitest";

import type { LegacyArchiveStore, StagedLegacyArchive } from "@/application/ports/legacy-archive-store";
import { ExportLegacyArchiveUseCase } from "@/application/use-cases/legacy-archive/export-legacy-archive.use-case";
import { VerifyLegacyArchiveUseCase } from "@/application/use-cases/legacy-archive/verify-legacy-archive.use-case";
import type { LegacyArchiveReader } from "@/domain/repositories/legacy-archive-reader";
import {
  ArchiveControlMismatchError,
  ArchiveVerificationFailedError,
  LegacyArchiveScopeTooLargeError,
  type ArchiveFile,
  type LegacyArchiveOptions,
  type LegacyArchiveSnapshot,
} from "@/domain/services/legacy-archive";
import { LEGACY_ARCHIVE_BLOCKERS, LEGACY_ARCHIVE_CATEGORIES } from "@/domain/services/legacy-archive-spec";
import { deepFreeze, fixtureSnapshot, idOf } from "../../../../../test-utils/legacy-archive-m167-fixture";

const DEFAULT: LegacyArchiveOptions = { includeInvoiceContent: false, includeNarrative: false };
const TARGET = "/archives/m167-test";
const clock = (iso: string) => () => new Date(iso);

class FakeReader implements LegacyArchiveReader {
  calls: LegacyArchiveOptions[] = [];
  constructor(private readonly behaviour: () => Promise<LegacyArchiveSnapshot>) {}
  async readSnapshot(options: LegacyArchiveOptions) {
    this.calls.push(options);
    return this.behaviour();
  }
}

/** In-memory store with the same contract as the filesystem one: staged -> read back -> committed (never overwritten). */
class FakeStore implements LegacyArchiveStore {
  committed = new Map<string, ArchiveFile[]>();
  staged = new Map<string, ArchiveFile[]>();
  stageCalls = 0;
  commitCalls = 0;
  discarded: string[] = [];
  failStageTimes = 0;
  failCommit = false;
  corruptReadBack = false;

  async stage(targetPath: string, files: readonly ArchiveFile[]): Promise<StagedLegacyArchive> {
    this.stageCalls += 1;
    if (this.failStageTimes > 0) {
      this.failStageTimes -= 1;
      throw new Error("disk full");
    }
    if (this.committed.has(targetPath)) throw Object.assign(new Error("target exists"), { code: "LEGACY_ARCHIVE_TARGET_EXISTS" });
    const stagingPath = `${targetPath}.partial-${this.stageCalls}`;
    this.staged.set(stagingPath, files.map((f) => ({ name: f.name, content: Buffer.from(f.content) })));
    return { stagingPath, targetPath };
  }
  async readStaged(staged: StagedLegacyArchive) {
    const files = this.staged.get(staged.stagingPath)!.map((f) => ({ name: f.name, content: Buffer.from(f.content) }));
    if (this.corruptReadBack) files.find((f) => f.name === "payments.ndjson")!.content[0] = 0x58;
    return files;
  }
  async commit(staged: StagedLegacyArchive) {
    this.commitCalls += 1;
    if (this.failCommit) throw new Error("rename failed");
    this.committed.set(staged.targetPath, this.staged.get(staged.stagingPath)!);
    this.staged.delete(staged.stagingPath);
  }
  async discard(staged: StagedLegacyArchive) {
    this.discarded.push(staged.stagingPath);
    this.staged.delete(staged.stagingPath);
  }
  async read(archivePath: string) {
    const files = this.committed.get(archivePath);
    if (!files) throw new Error("not found");
    return files;
  }
}

const happyReader = (rows = 3) => new FakeReader(async () => deepFreeze(fixtureSnapshot({ rowsPerCategory: rows })));

describe("M167 — ExportLegacyArchiveUseCase", () => {
  it("reads once, verifies, stages, reads back, commits, and reports counts, digests and the unresolved blockers", async () => {
    const reader = happyReader();
    const store = new FakeStore();
    const result = await new ExportLegacyArchiveUseCase(reader, store, clock("2026-10-15T12:00:00.000Z")).execute({ targetPath: TARGET, options: DEFAULT });

    expect(reader.calls).toEqual([DEFAULT]);
    expect(result.status).toBe("COMPLETE");
    expect(result.totalRecords).toBe(LEGACY_ARCHIVE_CATEGORIES.length * 3);
    expect(result.generatedAt.toISOString()).toBe("2026-10-15T12:00:00.000Z");
    expect(result.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.archiveDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(result.categories.map((c) => c.key)).toEqual(LEGACY_ARCHIVE_CATEGORIES.map((c) => c.key));
    expect(result.categories.find((c) => c.key === "audit_logs")!.controlled).toBe(false);
    expect(result.categories.find((c) => c.key === "payments")!.controlled).toBe(true);
    // An export is never reported as an approved archive.
    expect(result.unresolvedBlockers).toEqual(LEGACY_ARCHIVE_BLOCKERS.map((b) => b.id));
    expect(Object.keys(result)).not.toContain("approved");
    expect(store.committed.has(TARGET)).toBe(true);
    expect(store.staged.size).toBe(0);
    expect(store.discarded).toEqual([]);
  });

  it("passes the requested options to the reader so excluded fields are never even selected", async () => {
    const reader = happyReader(1);
    await new ExportLegacyArchiveUseCase(reader, new FakeStore()).execute({ targetPath: TARGET, options: { includeInvoiceContent: true, includeNarrative: false } });
    expect(reader.calls).toEqual([{ includeInvoiceContent: true, includeNarrative: false }]);
  });

  it("succeeds on an empty dataset", async () => {
    const empty: LegacyArchiveSnapshot = { categories: Object.fromEntries(LEGACY_ARCHIVE_CATEGORIES.map((c) => [c.key, { rows: [], tableTotal: 0, control: { count: 0, totals: [] } }])) };
    const store = new FakeStore();
    const result = await new ExportLegacyArchiveUseCase(new FakeReader(async () => empty), store).execute({ targetPath: TARGET, options: DEFAULT });
    expect(result.totalRecords).toBe(0);
    expect(store.committed.get(TARGET)!.every((f) => f.name === "manifest.json" || f.name === "SHA256SUMS" || f.content.length === 0)).toBe(true);
  });

  it("is repeatable: two runs over the same data produce byte-identical category files and the same archive digest", async () => {
    const run = async (iso: string) => {
      const store = new FakeStore();
      const result = await new ExportLegacyArchiveUseCase(happyReader(4), store, clock(iso)).execute({ targetPath: TARGET, options: DEFAULT });
      return { result, files: store.committed.get(TARGET)! };
    };
    const a = await run("2026-10-15T12:00:00.000Z");
    const b = await run("2026-11-01T08:30:00.000Z");
    expect(b.result.archiveDigest).toBe(a.result.archiveDigest);
    for (const c of LEGACY_ARCHIVE_CATEGORIES) expect(b.files.find((f) => f.name === `${c.key}.ndjson`)!.content.equals(a.files.find((f) => f.name === `${c.key}.ndjson`)!.content), c.key).toBe(true);
    expect(b.result.manifestSha256).not.toBe(a.result.manifestSha256); // only generatedAt differs
  });

  it("refuses a second run into the same target and leaves the first archive untouched (duplicate execution)", async () => {
    const store = new FakeStore();
    const use = new ExportLegacyArchiveUseCase(happyReader(), store);
    await use.execute({ targetPath: TARGET, options: DEFAULT });
    const before = store.committed.get(TARGET)!.map((f) => f.content.toString("hex"));
    await expect(use.execute({ targetPath: TARGET, options: DEFAULT })).rejects.toMatchObject({ code: "LEGACY_ARCHIVE_TARGET_EXISTS" });
    expect(store.committed.get(TARGET)!.map((f) => f.content.toString("hex"))).toEqual(before);
    expect(store.staged.size).toBe(0);
  });

  it("writes nothing when the read fails (partial failure) and propagates the error", async () => {
    const store = new FakeStore();
    const boom = new FakeReader(async () => {
      throw new Error("connection reset");
    });
    await expect(new ExportLegacyArchiveUseCase(boom, store).execute({ targetPath: TARGET, options: DEFAULT })).rejects.toThrow("connection reset");
    expect(store.stageCalls).toBe(0);
    expect(store.committed.size).toBe(0);

    const tooLarge = new FakeReader(async () => {
      throw new LegacyArchiveScopeTooLargeError("payments", 10);
    });
    await expect(new ExportLegacyArchiveUseCase(tooLarge, store).execute({ targetPath: TARGET, options: DEFAULT })).rejects.toBeInstanceOf(LegacyArchiveScopeTooLargeError);
    expect(store.stageCalls).toBe(0);
  });

  it("writes nothing when the snapshot disagrees with the database's own control figures (truncation)", async () => {
    const snap = fixtureSnapshot({ rowsPerCategory: 3 });
    const p = snap.categories.payments!;
    const truncated: LegacyArchiveSnapshot = { categories: { ...snap.categories, payments: { ...p, rows: p.rows.slice(0, 1) } } };
    const store = new FakeStore();
    await expect(new ExportLegacyArchiveUseCase(new FakeReader(async () => truncated), store).execute({ targetPath: TARGET, options: DEFAULT })).rejects.toBeInstanceOf(ArchiveControlMismatchError);
    expect(store.stageCalls).toBe(0);
  });

  it("writes nothing when a relationship does not resolve (in-memory verification before staging)", async () => {
    const dangling = fixtureSnapshot({ rowsPerCategory: 2, patch: { payouts: () => ({ paymentId: idOf("payments", 50) }) } });
    const store = new FakeStore();
    const failure = await new ExportLegacyArchiveUseCase(new FakeReader(async () => dangling), store).execute({ targetPath: TARGET, options: DEFAULT }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ArchiveVerificationFailedError);
    expect((failure as ArchiveVerificationFailedError).issues.map((i) => i.code)).toContain("REFERENCE_UNRESOLVED");
    expect(store.stageCalls).toBe(0);
  });

  it("discards the staging area and publishes nothing when the read-back from storage is corrupted", async () => {
    const store = new FakeStore();
    store.corruptReadBack = true;
    await expect(new ExportLegacyArchiveUseCase(happyReader(), store).execute({ targetPath: TARGET, options: DEFAULT })).rejects.toBeInstanceOf(ArchiveVerificationFailedError);
    expect(store.commitCalls).toBe(0);
    expect(store.discarded).toHaveLength(1);
    expect(store.committed.size).toBe(0);
    expect(store.staged.size).toBe(0);
  });

  it("discards the staging area when publishing fails, and a retry then succeeds (retry behaviour)", async () => {
    const store = new FakeStore();
    const use = new ExportLegacyArchiveUseCase(happyReader(), store);
    store.failCommit = true;
    await expect(use.execute({ targetPath: TARGET, options: DEFAULT })).rejects.toThrow("rename failed");
    expect(store.discarded).toHaveLength(1);
    expect(store.committed.size).toBe(0);

    store.failCommit = false;
    store.failStageTimes = 1;
    await expect(use.execute({ targetPath: TARGET, options: DEFAULT })).rejects.toThrow("disk full");
    expect(store.committed.size).toBe(0);

    const result = await use.execute({ targetPath: TARGET, options: DEFAULT });
    expect(result.status).toBe("COMPLETE");
    expect(store.committed.has(TARGET)).toBe(true);
  });

  it("never mutates the snapshot it was given (source records unchanged) — the snapshot is deep-frozen", async () => {
    await expect(new ExportLegacyArchiveUseCase(happyReader(), new FakeStore()).execute({ targetPath: TARGET, options: { includeInvoiceContent: true, includeNarrative: true } })).resolves.toMatchObject({ status: "COMPLETE" });
  });

  it("holds only a query-only reader, a store and a clock: it cannot touch a repository, gateway or event bus", () => {
    const use = new ExportLegacyArchiveUseCase(happyReader(), new FakeStore());
    expect(Object.keys(use).sort()).toEqual(["now", "reader", "store"]);
  });
});

describe("M167 — VerifyLegacyArchiveUseCase", () => {
  it("verifies a committed archive, reports issues for a damaged one and propagates an unreadable one", async () => {
    const store = new FakeStore();
    await new ExportLegacyArchiveUseCase(happyReader(), store).execute({ targetPath: TARGET, options: DEFAULT });
    const verify = new VerifyLegacyArchiveUseCase(store);

    expect(await verify.execute(TARGET)).toMatchObject({ ok: true, issues: [] });

    const damaged = store.committed.get(TARGET)!.map((f) => ({ name: f.name, content: Buffer.from(f.content) }));
    damaged.find((f) => f.name === "refunds.ndjson")!.content[1] = 0x20;
    store.committed.set("/archives/damaged", damaged);
    const result = await verify.execute("/archives/damaged");
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain("CHECKSUM_MISMATCH");

    await expect(verify.execute("/archives/missing")).rejects.toThrow("not found");
  });

  it("does not modify the archive it verifies", async () => {
    const store = new FakeStore();
    await new ExportLegacyArchiveUseCase(happyReader(), store).execute({ targetPath: TARGET, options: DEFAULT });
    const before = store.committed.get(TARGET)!.map((f) => f.content.toString("hex"));
    const spy = vi.spyOn(store, "commit");
    await new VerifyLegacyArchiveUseCase(store).execute(TARGET);
    expect(spy).not.toHaveBeenCalled();
    expect(store.committed.get(TARGET)!.map((f) => f.content.toString("hex"))).toEqual(before);
  });
});
