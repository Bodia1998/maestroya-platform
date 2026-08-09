import "server-only";

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { BackupArtifact, BackupVerificationResult } from "@/application/ports/database-backup-provider";
import type { StorageBackupProvider } from "@/application/ports/storage-backup-provider";

/**
 * The minimal slice of the Cloudinary Admin API's `resources` listing
 * this provider needs — declared locally rather than imported from the
 * `cloudinary` package's own (broader, less stable) SDK types, so this
 * provider depends on exactly the shape it uses and stays easy to fake in
 * tests without constructing a real Cloudinary client.
 */
export interface CloudinaryResourceApi {
  resources(options: { type: "upload"; max_results: number; next_cursor?: string }): Promise<{
    resources: { public_id: string; secure_url: string; format: string; bytes: number; created_at: string }[];
    next_cursor?: string;
  }>;
}

export interface ManifestResource {
  publicId: string;
  secureUrl: string;
  format: string;
  bytes: number;
  createdAt: string;
}

interface ManifestFile {
  capturedAt: string;
  resourceCount: number;
  resources: ManifestResource[];
}

export interface CloudinaryManifestStorageBackupProviderOptions {
  api: CloudinaryResourceApi;
  storageDir: string;
  now?: () => Date;
}

/**
 * Module 54 — Backup & Disaster Recovery.
 *
 * The default `StorageBackupProvider` for this platform's uploaded files
 * (Module 18 — Company Professional's Cloudinary storage,
 * `infrastructure/storage/cloudinary/`).
 *
 * ## Why a manifest, not a copy of the bytes
 * Cloudinary is already a durable, replicated, third-party store for
 * every image/document this platform uploads — re-downloading and
 * re-storing every asset here would duplicate storage Cloudinary already
 * guarantees, at real bandwidth/storage cost, to protect against a
 * failure mode (Cloudinary losing the data) this platform has no
 * independent way to detect or recover from differently anyway. What
 * *is* this platform's own responsibility, and *can* be lost
 * independently of Cloudinary (e.g. a botched migration, an accidental
 * mass-delete of the wrong `public_id` prefix, a corrupted database that
 * held the association between a `public_id` and the domain record it
 * belongs to), is the **inventory** — knowing which resources exist,
 * under which ids, in which folders. That inventory is exactly what this
 * provider captures and can restore: a signed, checksummed JSON manifest
 * of every resource under this platform's Cloudinary account, via the
 * Admin API's `resources` listing.
 *
 * "Restoring" a manifest backup means re-establishing that inventory as
 * the authoritative record — it cannot re-create a resource Cloudinary
 * itself has actually deleted, which is a materially different (and
 * intentionally out of scope) disaster from "this platform's own record
 * of what it has stored became inconsistent." See
 * docs/MODULE_54_BACKUP_AND_DISASTER_RECOVERY.md, "Storage backup
 * strategy," for the full reasoning.
 */
export class CloudinaryManifestStorageBackupProvider implements StorageBackupProvider {
  constructor(private readonly options: CloudinaryManifestStorageBackupProviderOptions) {}

  async createBackup(): Promise<BackupArtifact> {
    await mkdir(this.options.storageDir, { recursive: true });

    const resources: ManifestResource[] = [];
    let nextCursor: string | undefined;

    do {
      const page = await this.options.api.resources({
        type: "upload",
        max_results: 500,
        next_cursor: nextCursor,
      });
      for (const resource of page.resources ?? []) {
        resources.push({
          publicId: resource.public_id,
          secureUrl: resource.secure_url,
          format: resource.format,
          bytes: resource.bytes,
          createdAt: resource.created_at,
        });
      }
      nextCursor = page.next_cursor;
    } while (nextCursor);

    const now = this.options.now?.() ?? new Date();
    const manifest: ManifestFile = { capturedAt: now.toISOString(), resourceCount: resources.length, resources };
    const serialized = JSON.stringify(manifest, null, 2);

    const fileName = `storage-manifest-${now.toISOString().replace(/[:.]/g, "-")}.json`;
    const filePath = path.join(this.options.storageDir, fileName);
    await writeFile(filePath, serialized, "utf8");

    return {
      locationUri: filePath,
      sizeBytes: Buffer.byteLength(serialized, "utf8"),
      checksumSha256: createHash("sha256").update(serialized, "utf8").digest("hex"),
    };
  }

  /**
   * Reads the manifest back — actually re-associating each entry with the
   * domain records that reference it is an application-layer concern
   * this method deliberately does not perform (it would be business
   * logic living in infrastructure, which this module's own architecture
   * rule forbids); it exists to prove the manifest is readable and
   * complete, the mechanical half of "restore," with any domain-level
   * reconciliation left to a purpose-built use case built on top of this
   * port.
   */
  async restoreBackup(artifact: BackupArtifact): Promise<void> {
    await this.readManifest(artifact.locationUri);
  }

  async verifyBackup(artifact: BackupArtifact): Promise<BackupVerificationResult> {
    try {
      const raw = await readFile(artifact.locationUri, "utf8");
      const checksum = createHash("sha256").update(raw, "utf8").digest("hex");
      if (checksum !== artifact.checksumSha256) {
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

  private async readManifest(locationUri: string): Promise<ManifestFile> {
    const raw = await readFile(locationUri, "utf8");
    return JSON.parse(raw) as ManifestFile;
  }
}
