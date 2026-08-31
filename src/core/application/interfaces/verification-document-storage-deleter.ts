/**
 * Module 88 — GDPR Erasure Execution & Document Retention.
 *
 * The single abstraction application/use-case code is allowed to depend on
 * for actually deleting a verification document's stored file. Mirrors the
 * existing `VerificationDocumentUploadService`'s own "one narrow interface
 * per storage operation" convention (same file, same folder) rather than
 * widening that interface — upload and delete are different failure modes
 * (delete must be safely retryable; a partially-failed upload is simply
 * discarded, never retried in place) and different callers (upload is
 * called from the professional's own document-upload use case; delete is
 * only ever called from `ExecuteAccountErasureUseCase`).
 *
 * Deliberately takes the *stored* `fileUrl` (exactly what
 * `VerificationDocumentRecord.fileUrl` holds) rather than a provider-
 * specific id — no Cloudinary `public_id`/`resource_type`/`type` concept
 * leaks into application code, same "provider MUST NOT appear anywhere in
 * this module" rule `VerificationProvider`'s own doc comment documents for
 * Persona.
 */
export interface VerificationDocumentStorageDeleter {
  /**
   * Deletes the stored file behind `fileUrl`. Must be safe to call more
   * than once for the same URL (a file already gone from the provider is
   * treated as success, not an error — see the Cloudinary implementation's
   * own doc comment) so a caller can always retry after a prior failure
   * without first checking whether the previous attempt actually
   * succeeded.
   *
   * Rejects (never silently swallows) on a genuine failure — a caller that
   * wants "log and continue" behavior (as `ExecuteAccountErasureUseCase`
   * does, per this module's transaction-boundary requirement: an external
   * storage failure must never fail or roll back the database erasure
   * that already committed) must catch this itself.
   */
  deleteByUrl(fileUrl: string): Promise<void>;
}
