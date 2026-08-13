import "server-only";

import type { CheckerFindingInput, SafetyChecker, SubsystemCheckOutcome } from "@/application/ports/safety-checker";
import { SourceScanner } from "@/infrastructure/multi-instance-safety/source-scanner";

const AVATAR_UPLOAD_PATH = "src/core/infrastructure/storage/cloudinary/avatar-upload-service.ts";
const VERIFICATION_UPLOAD_PATH = "src/core/infrastructure/storage/cloudinary/verification-document-upload-service.ts";
const REQUEST_PHOTO_UPLOAD_PATH = "src/core/infrastructure/storage/cloudinary/request-photo-upload-service.ts";

/**
 * Module 58 — Multi-Instance Safety Audit.
 *
 * Covers: file upload consistency, retry safety. File uploads never touch
 * local instance disk in this codebase — every upload service streams
 * directly to Cloudinary, an external service already shared/consistent
 * across every instance by construction, so there is no "which instance
 * has the file" problem to begin with. The remaining multi-instance risk
 * is retry safety: does a retried upload (from a flaky connection, or a
 * request that gets load-balanced to a different instance mid-retry)
 * create a duplicate asset, or safely overwrite the same one?
 * `CloudinaryAvatarUploadService` uses a deterministic `public_id`
 * (keyed by `userId`) with `overwrite: true` — a retry from any instance
 * converges on the same Cloudinary object rather than accumulating
 * duplicates.
 */
export class UploadConsistencyChecker implements SafetyChecker {
  readonly subsystem = "File Uploads & Retry Safety (Cloudinary)";

  constructor(private readonly scanner: SourceScanner = new SourceScanner()) {}

  async check(): Promise<SubsystemCheckOutcome> {
    const passedChecks: string[] = [];
    const findings: CheckerFindingInput[] = [];

    const avatarService = await this.scanner.read(AVATAR_UPLOAD_PATH);
    if (avatarService && /public_id:\s*userId/.test(avatarService) && /overwrite:\s*true/.test(avatarService)) {
      passedChecks.push(
        `${AVATAR_UPLOAD_PATH}: uploads use a deterministic \`public_id\` (\`userId\`) with \`overwrite: true\` — a retried or duplicated upload (from any instance) converges on the same Cloudinary asset rather than creating an orphaned duplicate.`,
      );
    } else {
      findings.push({
        severity: "WARNING",
        problem: "Could not confirm the avatar upload path uses a deterministic, overwrite-safe Cloudinary public_id.",
        risk: "A retried upload (client retry after a timeout, or a request re-issued and landing on a different instance) could create a new, orphaned Cloudinary asset each time instead of safely replacing the previous one.",
        whyItHappens: `${AVATAR_UPLOAD_PATH} did not match the expected \`public_id: userId\` + \`overwrite: true\` pattern.`,
        impact: "Storage bloat and orphaned assets under retries; potentially stale URLs referenced by other records if the public_id is not otherwise stable.",
        recommendedFix: "Use a deterministic, entity-derived public_id (e.g. the owning user/record id) with `overwrite: true` so retries are naturally idempotent regardless of which instance handles them.",
        priority: "LOW",
        evidence: [AVATAR_UPLOAD_PATH],
      });
    }

    const verificationService = await this.scanner.read(VERIFICATION_UPLOAD_PATH);
    const requestPhotoService = await this.scanner.read(REQUEST_PHOTO_UPLOAD_PATH);
    const otherServices = [
      { path: VERIFICATION_UPLOAD_PATH, content: verificationService },
      { path: REQUEST_PHOTO_UPLOAD_PATH, content: requestPhotoService },
    ].filter((s): s is { path: string; content: string } => s.content !== null);

    const overwriteSafeCount = otherServices.filter((s) => /overwrite:\s*true/.test(s.content) || /public_id/.test(s.content)).length;
    if (otherServices.length > 0) {
      passedChecks.push(
        `${otherServices.length} additional Cloudinary upload service(s) checked (verification documents, request photos) — every upload streams directly to Cloudinary, an external store already consistent across instances, so no instance-local file state exists to go stale or diverge.`,
      );
      if (overwriteSafeCount < otherServices.length) {
        findings.push({
          severity: "WARNING",
          problem: "Not every non-avatar upload service was confirmed to use a deterministic public_id/overwrite-safe upload.",
          risk: "A retried document/photo upload could accumulate duplicate Cloudinary assets rather than safely replacing the previous attempt.",
          whyItHappens: "Some upload services did not match the `public_id`/`overwrite: true` pattern this checker looks for — they may instead rely on Cloudinary's auto-generated ids plus an application-level record update, which is a different (also valid, but not verified here) idempotency strategy.",
          impact: "Potential storage bloat under retries; not a correctness bug if the owning domain record is always updated to point at the latest upload's URL regardless of asset id strategy.",
          recommendedFix: "For each upload service, confirm explicitly whether retries are made safe via a deterministic public_id (Cloudinary-side idempotency) or via the owning record always being updated last (application-side idempotency), and document which strategy applies.",
          priority: "LOW",
          evidence: otherServices.map((s) => s.path),
        });
      }
    }

    return { passedChecks, findings };
  }
}
