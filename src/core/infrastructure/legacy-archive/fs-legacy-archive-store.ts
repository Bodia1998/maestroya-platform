import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

import type { LegacyArchiveStore, StagedLegacyArchive } from "@/application/ports/legacy-archive-store";
import { DomainError } from "@/domain/errors/domain-error";
import type { ArchiveFile } from "@/domain/services/legacy-archive";

export class LegacyArchiveTargetExistsError extends DomainError {
  readonly code = "LEGACY_ARCHIVE_TARGET_EXISTS";
  constructor() {
    super("The archive target already exists; an archive is never overwritten. Choose a new directory.");
  }
}
export class LegacyArchiveStoreError extends DomainError {
  readonly code = "LEGACY_ARCHIVE_STORE_ERROR";
}

/** Errors that mean "this platform / filesystem cannot fsync a directory" rather than "the disk failed". */
const FSYNC_DIRECTORY_UNSUPPORTED = new Set(["EINVAL", "EISDIR", "EPERM", "ENOTSUP", "EOPNOTSUPP", "EBADF"]);

/** Flushes a directory's entries to disk, so a created or renamed entry survives a crash or power loss. */
export async function fsyncDirectory(dir: string): Promise<void> {
  let handle;
  try {
    handle = await open(dir, "r");
    await handle.sync();
  } catch (error) {
    if (FSYNC_DIRECTORY_UNSUPPORTED.has((error as NodeJS.ErrnoException).code ?? "")) return;
    throw error;
  } finally {
    await handle?.close();
  }
}

/** The archive WAS published, but the flush of its directory entry could not be confirmed. Distinct from a failed export. */
export class LegacyArchivePublishedUnconfirmedError extends DomainError {
  readonly code = "LEGACY_ARCHIVE_PUBLISHED_UNCONFIRMED";
  constructor(readonly targetPath: string) {
    super("The archive was published, but making its directory read-only or flushing its directory entry to disk could not be confirmed. Verify it with --verify and check its permissions before relying on it.");
  }
}

const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const exists = async (p: string): Promise<boolean> => {
  try {
    await lstat(p);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
};

/** True when `dir` or any ancestor contains `.git`: an export must never be placed where it could be committed. */
async function insideGitWorkTree(dir: string): Promise<boolean> {
  let current = dir;
  for (;;) {
    if (await exists(path.join(current, ".git"))) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

/**
 * Module 167 — local-filesystem archive store.
 *
 * Safety properties (each pinned by a test):
 *  - the target must be absolute, its parent must exist, and neither may sit inside a Git work tree;
 *  - an existing target is never overwritten or modified;
 *  - files are created exclusively (`wx`), owner-only (0600) and fsynced into a private staging directory (0700) next to the target;
 *  - `commit` re-checks that the target is still absent, makes files read-only (0400), then publishes with a single atomic rename —
 *    so the final name only ever points at a complete, previously verified archive — and only then makes the directory 0500 (macOS
 *    refuses to rename a directory that is not owner-writable; until then it is owner-only 0700 with read-only files). The staging directory is
 *    fsynced before the rename and the parent after it, so a crash cannot leave the name pointing at entries that were never flushed;
 *  - a leftover staging directory from an interrupted run is never deleted automatically (it may belong to a run that is still going)
 *    but it is never ignored either: `stage` refuses to start while one exists for the same target, and names it so an operator can
 *    inspect and remove it;
 *  - `discard` removes only the staging directory this store created.
 * It cannot provide encryption at rest or write-once storage (blocker B7): put the target on an encrypted volume.
 */
export class FsLegacyArchiveStore implements LegacyArchiveStore {
  /** `fsync` of a directory; injectable so the durability steps can be observed in tests. */
  constructor(private readonly syncDirectory: (dir: string) => Promise<void> = fsyncDirectory) {}

  async stage(targetPath: string, files: readonly ArchiveFile[]): Promise<StagedLegacyArchive> {
    if (typeof targetPath !== "string" || targetPath.includes("\0") || !path.isAbsolute(targetPath)) throw new LegacyArchiveStoreError("The archive target must be an absolute path.");
    const target = path.resolve(targetPath);
    const parent = path.dirname(target);
    let parentReal: string;
    try {
      if (!(await stat(parent)).isDirectory()) throw new Error("not a directory");
      parentReal = await realpath(parent);
    } catch {
      throw new LegacyArchiveStoreError("The parent directory of the archive target does not exist.");
    }
    if (await insideGitWorkTree(parentReal)) throw new LegacyArchiveStoreError("Refusing to write an archive inside a Git work tree.");
    if (await exists(target)) throw new LegacyArchiveTargetExistsError();
    const leftovers = (await readdir(parentReal)).filter((name) => name.startsWith(`.${path.basename(target)}.partial-`));
    if (leftovers.length > 0) throw new LegacyArchiveStoreError(`A staging directory from an interrupted export already exists for this target (${leftovers.join(", ")}). It is not removed automatically: confirm no export is running, inspect it, delete it yourself, then retry.`);
    for (const file of files) if (!SAFE_FILE_NAME.test(file.name)) throw new LegacyArchiveStoreError("An archive file name is not allowed.");
    if (new Set(files.map((f) => f.name)).size !== files.length) throw new LegacyArchiveStoreError("Archive file names must be unique.");

    const stagingPath = path.join(parentReal, `.${path.basename(target)}.partial-${randomBytes(6).toString("hex")}`);
    await mkdir(stagingPath, { mode: 0o700 });
    const staged: StagedLegacyArchive = { stagingPath, targetPath: path.join(parentReal, path.basename(target)) };
    try {
      await chmod(stagingPath, 0o700);
      for (const file of files) {
        const handle = await open(path.join(stagingPath, file.name), "wx", 0o600);
        try {
          await handle.writeFile(file.content);
          await handle.sync();
        } finally {
          await handle.close();
        }
      }
      await this.syncDirectory(stagingPath);
      return staged;
    } catch (error) {
      await this.discard(staged).catch(() => undefined);
      throw error;
    }
  }

  readStaged(staged: StagedLegacyArchive): Promise<ArchiveFile[]> {
    return this.read(staged.stagingPath);
  }

  async read(archivePath: string): Promise<ArchiveFile[]> {
    if (typeof archivePath !== "string" || !path.isAbsolute(archivePath)) throw new LegacyArchiveStoreError("The archive path must be absolute.");
    let entries;
    try {
      entries = await readdir(archivePath, { withFileTypes: true });
    } catch {
      throw new LegacyArchiveStoreError("The archive directory cannot be read.");
    }
    const out: ArchiveFile[] = [];
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (!entry.isFile()) throw new LegacyArchiveStoreError("The archive directory contains something that is not a regular file.");
      out.push({ name: entry.name, content: await readFile(path.join(archivePath, entry.name)) });
    }
    return out;
  }

  async commit(staged: StagedLegacyArchive): Promise<void> {
    if (await exists(staged.targetPath)) throw new LegacyArchiveTargetExistsError();
    const names = await readdir(staged.stagingPath);
    // Files become read-only while the directory is still writable; nothing is visible under the final name yet.
    for (const name of names) await chmod(path.join(staged.stagingPath, name), 0o400);
    // The staging directory must stay owner-WRITABLE (0700) until after the rename. On macOS/BSD, renaming a directory requires write
    // permission on the directory being renamed (the kernel rewrites its ".." entry), so a 0500 directory fails with EACCES even when
    // the parent is writable; Linux does not check this for a same-parent rename, which is why the failure only appeared on macOS.
    // Locking the directory first therefore cannot be portable. Making it read-only AFTER the rename exposes nothing: the directory is
    // owner-only (0700, set at creation) and every file in it is already 0400, so no other user can read or change it in the interval.
    await this.syncDirectory(staged.stagingPath);
    await rename(staged.stagingPath, staged.targetPath);
    try {
      await chmod(staged.targetPath, 0o500);
      await this.syncDirectory(path.dirname(staged.targetPath));
    } catch {
      // The archive IS published and complete (its files are read-only and the directory owner-only); only locking the directory or the
      // flush of its entry could not be confirmed. Say so precisely rather than reporting a failed export. The published directory is
      // never removed here: the staging path no longer exists, so nothing is discarded.
      throw new LegacyArchivePublishedUnconfirmedError(staged.targetPath);
    }
  }

  async discard(staged: StagedLegacyArchive): Promise<void> {
    if (!path.basename(staged.stagingPath).includes(".partial-")) throw new LegacyArchiveStoreError("Refusing to remove a directory that is not an archive staging directory.");
    if (!(await exists(staged.stagingPath))) return;
    await chmod(staged.stagingPath, 0o700).catch(() => undefined);
    await rm(staged.stagingPath, { recursive: true, force: true });
  }
}
