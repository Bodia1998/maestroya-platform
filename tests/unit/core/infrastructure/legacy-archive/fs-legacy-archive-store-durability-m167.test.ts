import { chmod, mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FsLegacyArchiveStore, LegacyArchivePublishedUnconfirmedError, LegacyArchiveStoreError, fsyncDirectory } from "@/infrastructure/legacy-archive/fs-legacy-archive-store";
import { buildLegacyArchive, verifyLegacyArchive } from "@/domain/services/legacy-archive";
import { fixtureSnapshot } from "../../../../test-utils/legacy-archive-m167-fixture";

let root: string;
const files = () => buildLegacyArchive(fixtureSnapshot({ rowsPerCategory: 1 }), { includeInvoiceContent: false, includeNarrative: false }, new Date("2026-10-15T12:00:00.000Z")).files;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "m167-dur-"));
});
afterEach(async () => {
  for (const entry of await readdir(root).catch(() => [] as string[])) await chmod(path.join(root, entry), 0o700).catch(() => undefined);
  await rm(root, { recursive: true, force: true });
});

describe("M167 — durability of publication", () => {
  it("fsyncs the staging directory, then renames, then fsyncs the parent directory (in that order)", async () => {
    const calls: string[] = [];
    const store = new FsLegacyArchiveStore(async (dir) => {
      calls.push(`${path.basename(dir).startsWith(".") ? "staging" : "parent"}:${(await readdir(root)).filter((n) => n === "archive").length}`);
    });
    const staged = await store.stage(path.join(root, "archive"), files());
    calls.length = 0;
    await store.commit(staged);
    // staging fsync happens while the final name does not exist yet; the parent fsync happens after the rename made it exist
    expect(calls).toEqual(["staging:0", "parent:1"]);
  });

  it("keeps the staging directory owner-writable until the rename (macOS refuses to rename a 0500 directory) and locks it to 0500 right after", async () => {
    const modeAt: Record<string, number> = {};
    const store = new FsLegacyArchiveStore(async (dir) => {
      const published = (await readdir(root)).includes("archive");
      modeAt[published ? "afterRename" : "beforeRename"] = (await stat(published ? path.join(root, "archive") : dir)).mode & 0o777;
    });
    const staged = await store.stage(path.join(root, "archive"), files());
    delete modeAt["beforeRename"];
    await store.commit(staged);
    expect(modeAt["beforeRename"]! & 0o200).toBe(0o200); // owner-writable at the moment of the pre-rename fsync, i.e. rename's precondition on macOS
    expect(modeAt["beforeRename"]).toBe(0o700);
    expect(modeAt["afterRename"]).toBe(0o500); // already locked when the parent flush runs
    for (const name of await readdir(path.join(root, "archive"))) expect((await stat(path.join(root, "archive", name))).mode & 0o777, name).toBe(0o400);
  });

  it("a parent-directory fsync failure is reported as published-but-unconfirmed, never as 'nothing published'", async () => {
    let n = 0;
    const store = new FsLegacyArchiveStore(async () => {
      n += 1;
      if (n === 3) throw new Error("EIO"); // stage-time fsync, commit staging fsync, then the parent fsync fails
    });
    const target = path.join(root, "archive");
    const staged = await store.stage(target, files());
    await expect(store.commit(staged)).rejects.toBeInstanceOf(LegacyArchivePublishedUnconfirmedError);
    expect(verifyLegacyArchive(await store.read(target)).ok).toBe(true); // it IS there and valid
    expect((await stat(target)).mode & 0o777).toBe(0o500); // and already locked down
  });

  it("refuses to stage while a partial directory from an interrupted export exists, and does not delete it", async () => {
    const store = new FsLegacyArchiveStore();
    const target = path.join(root, "archive");
    await mkdir(path.join(root, ".archive.partial-deadbeef"));
    await expect(store.stage(target, files())).rejects.toBeInstanceOf(LegacyArchiveStoreError);
    await expect(store.stage(target, files())).rejects.toThrow(/partial-deadbeef/);
    expect(await readdir(root)).toEqual([".archive.partial-deadbeef"]);
    // an unrelated partial directory of another target does not block this one
    await rm(path.join(root, ".archive.partial-deadbeef"), { recursive: true });
    await mkdir(path.join(root, ".other.partial-1"));
    await expect(new FsLegacyArchiveStore().stage(target, files())).resolves.toBeDefined();
  });

  it("fsyncDirectory works on a real directory and rejects a missing one", async () => {
    await expect(fsyncDirectory(root)).resolves.toBeUndefined();
    await expect(fsyncDirectory(path.join(root, "missing"))).rejects.toBeDefined();
  });
});
