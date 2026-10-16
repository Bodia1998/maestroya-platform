import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LegacyArchiveStoreError, LegacyArchiveTargetExistsError, FsLegacyArchiveStore } from "@/infrastructure/legacy-archive/fs-legacy-archive-store";
import { buildLegacyArchive, verifyLegacyArchive, type ArchiveFile } from "@/domain/services/legacy-archive";
import { fixtureSnapshot } from "../../../../test-utils/legacy-archive-m167-fixture";

let root: string;
const files = (): ArchiveFile[] => buildLegacyArchive(fixtureSnapshot({ rowsPerCategory: 2 }), { includeInvoiceContent: false, includeNarrative: false }, new Date("2026-10-15T12:00:00.000Z")).files;
const store = new FsLegacyArchiveStore();
const mode = async (p: string) => (await stat(p)).mode & 0o777;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "m167-store-"));
});
afterEach(async () => {
  // Published archives are read-only directories; restore write access so the scratch area can be removed.
  for (const entry of await readdir(root).catch(() => [] as string[])) await chmod(path.join(root, entry), 0o700).catch(() => undefined);
  await rm(root, { recursive: true, force: true });
});

describe("M167 — FsLegacyArchiveStore", () => {
  it("stages, reads back, commits atomically, and the published archive verifies from disk", async () => {
    const target = path.join(root, "archive");
    const staged = await store.stage(target, files());
    expect((await readdir(root)).some((n) => n.includes(".partial-"))).toBe(true);
    expect(await readdir(root).then((n) => n.includes("archive"))).toBe(false); // nothing under the final name yet

    const readBack = await store.readStaged(staged);
    expect(verifyLegacyArchive(readBack).ok).toBe(true);

    await store.commit(staged);
    expect((await readdir(root)).filter((n) => n.includes(".partial-"))).toEqual([]);
    const names = (await readdir(target)).sort();
    expect(names).toEqual(files().map((f) => f.name).sort());
    expect(verifyLegacyArchive(await store.read(target)).ok).toBe(true);
  });

  it("protects what it writes: directory 0500, files 0400 once published (owner-only, read-only)", async () => {
    const target = path.join(root, "archive");
    await store.commit(await store.stage(target, files()));
    expect(await mode(target)).toBe(0o500);
    for (const name of await readdir(target)) expect(await mode(path.join(target, name)), name).toBe(0o400);
  });

  it("keeps staged files owner-only (0600) in a 0700 directory", async () => {
    const staged = await store.stage(path.join(root, "archive"), files());
    expect(await mode(staged.stagingPath)).toBe(0o700);
    for (const name of await readdir(staged.stagingPath)) expect(await mode(path.join(staged.stagingPath, name)), name).toBe(0o600);
    await store.discard(staged);
  });

  it("never overwrites or modifies an existing target", async () => {
    const target = path.join(root, "archive");
    await mkdir(target);
    await writeFile(path.join(target, "precious.txt"), "keep me");
    await expect(store.stage(target, files())).rejects.toBeInstanceOf(LegacyArchiveTargetExistsError);
    expect(await readdir(target)).toEqual(["precious.txt"]);
    expect(await readFile(path.join(target, "precious.txt"), "utf8")).toBe("keep me");
    expect((await readdir(root)).filter((n) => n.includes(".partial-"))).toEqual([]);
  });

  it("refuses to publish if the target appeared after staging, and the target stays untouched", async () => {
    const target = path.join(root, "archive");
    const staged = await store.stage(target, files());
    await mkdir(target);
    await writeFile(path.join(target, "other.txt"), "x");
    await expect(store.commit(staged)).rejects.toBeInstanceOf(LegacyArchiveTargetExistsError);
    expect(await readdir(target)).toEqual(["other.txt"]);
    await store.discard(staged);
    expect((await readdir(root)).filter((n) => n.includes(".partial-"))).toEqual([]);
  });

  it("discard removes only the staging directory it created", async () => {
    const target = path.join(root, "archive");
    const neighbour = path.join(root, "neighbour");
    await mkdir(neighbour);
    const staged = await store.stage(target, files());
    await store.discard(staged);
    expect((await readdir(root)).sort()).toEqual(["neighbour"]);
    await expect(store.discard({ stagingPath: neighbour, targetPath: target })).rejects.toBeInstanceOf(LegacyArchiveStoreError);
    expect(await readdir(root)).toContain("neighbour");
  });

  it("rejects relative paths, a missing parent, and unsafe or duplicate file names", async () => {
    await expect(store.stage("relative/archive", files())).rejects.toBeInstanceOf(LegacyArchiveStoreError);
    await expect(store.stage(path.join(root, "no-such-parent", "archive"), files())).rejects.toBeInstanceOf(LegacyArchiveStoreError);
    await expect(store.stage(path.join(root, "a1"), [{ name: "../escape", content: Buffer.from("x") }])).rejects.toBeInstanceOf(LegacyArchiveStoreError);
    await expect(store.stage(path.join(root, "a2"), [{ name: "sub/dir", content: Buffer.from("x") }])).rejects.toBeInstanceOf(LegacyArchiveStoreError);
    await expect(store.stage(path.join(root, "a3"), [{ name: "a.txt", content: Buffer.from("x") }, { name: "a.txt", content: Buffer.from("y") }])).rejects.toBeInstanceOf(LegacyArchiveStoreError);
    expect(await readdir(root)).toEqual([]);
  });

  it("refuses to write inside a Git work tree (an export must never be committable)", async () => {
    const repo = path.join(root, "some-repo");
    await mkdir(path.join(repo, ".git"), { recursive: true });
    await mkdir(path.join(repo, "nested"));
    await expect(store.stage(path.join(repo, "archive"), files())).rejects.toThrow(/Git work tree/);
    await expect(store.stage(path.join(repo, "nested", "archive"), files())).rejects.toThrow(/Git work tree/);
    expect(await readdir(repo)).toContain(".git");
    expect((await readdir(repo)).filter((n) => n.includes("archive") || n.includes(".partial-"))).toEqual([]);
  });

  it("refuses to read a directory that contains anything but regular files", async () => {
    const dir = path.join(root, "weird");
    await mkdir(path.join(dir, "subdir"), { recursive: true });
    await expect(store.read(dir)).rejects.toBeInstanceOf(LegacyArchiveStoreError);
    await expect(store.read(path.join(root, "missing"))).rejects.toBeInstanceOf(LegacyArchiveStoreError);
    await expect(store.read("relative")).rejects.toBeInstanceOf(LegacyArchiveStoreError);
  });

  it("detects on-disk tampering after publication when the archive is verified later", async () => {
    const target = path.join(root, "archive");
    await store.commit(await store.stage(target, files()));
    await chmod(target, 0o700);
    await chmod(path.join(target, "payments.ndjson"), 0o600);
    const original = await readFile(path.join(target, "payments.ndjson"), "utf8");
    await writeFile(path.join(target, "payments.ndjson"), original.replace(/"amount":"[0-9.]+"/, '"amount":"1.00"'));
    const result = verifyLegacyArchive(await store.read(target));
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain("CHECKSUM_MISMATCH");
  });
});
