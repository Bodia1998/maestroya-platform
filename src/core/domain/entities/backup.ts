import { InvalidBackupTransitionError } from "@/domain/errors/domain-error";

/**
 * Module 54 — Backup & Disaster Recovery.
 *
 * The domain model for one backup run. Deliberately modelled as a small
 * state machine (`BackupStatus`) with transitions guarded on the
 * aggregate itself — the same convention `Payment`
 * (`domain/entities/payment.ts`) establishes for this codebase: "invalid
 * state changes are prevented" is a property of the entity, not
 * re-validated ad hoc at every call site.
 *
 * `BackupRecord` never knows *how* a backup is taken or restored — that
 * is `DatabaseBackupProvider`/`StorageBackupProvider`
 * (`application/ports/`), infrastructure concerns this file has zero
 * imports from. This file only knows the *lifecycle* and the *retention
 * math*, both pure and independent of any concrete backend — the same
 * "no business logic inside infrastructure" rule the module brief asks
 * for, enforced by construction: infrastructure has nothing to put
 * business logic *in* here.
 */

/** What system the backup captures. */
export type BackupTarget = "DATABASE" | "FILE_STORAGE";

/**
 * A full backup captures the entire target from scratch; an incremental
 * backup captures only what changed since the most recent backup (full or
 * incremental) for the same target. `BackupPlanningService` decides which
 * one is due next — this type only names the two kinds an artifact can be.
 */
export type BackupType = "FULL" | "INCREMENTAL";

export type BackupStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "VERIFIED"
  | "FAILED"
  | "RESTORED"
  | "EXPIRED";

/** Legal `status -> status[]` transitions. Anything not listed here is rejected. */
const ALLOWED_TRANSITIONS: Record<BackupStatus, readonly BackupStatus[]> = {
  PENDING: ["RUNNING", "FAILED"],
  RUNNING: ["COMPLETED", "FAILED"],
  COMPLETED: ["VERIFIED", "FAILED", "RESTORED", "EXPIRED"],
  VERIFIED: ["FAILED", "RESTORED", "EXPIRED"],
  FAILED: [],
  RESTORED: ["EXPIRED"],
  EXPIRED: [],
};

/**
 * Retention policy for a target — how long a backup is kept, with a
 * floor on the *count* retained so an operator can never end up with zero
 * recovery points just because every one of them aged past
 * `retentionDays` (e.g. a target that has not produced a fresh successful
 * backup in a while must not lose its last good one to a cron sweep).
 *
 * Deliberately a plain, immutable value object with no persistence
 * concerns of its own — the same role `RateLimitPolicy`
 * (`application/ports/rate-limit-policies.ts`) plays for its module.
 */
export class RetentionPolicy {
  constructor(
    /** How many days a backup remains eligible for restore before expiry. */
    readonly retentionDays: number,
    /** Never expire a target's `minRetainedBackups` most recent COMPLETED/VERIFIED backups, regardless of age. */
    readonly minRetainedBackups: number,
  ) {
    if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
      throw new RangeError(`RetentionPolicy.retentionDays must be a positive number, received ${String(retentionDays)}.`);
    }
    if (!Number.isInteger(minRetainedBackups) || minRetainedBackups < 1) {
      throw new RangeError(
        `RetentionPolicy.minRetainedBackups must be an integer >= 1, received ${String(minRetainedBackups)}.`,
      );
    }
  }

  expiryDateFor(completedAt: Date): Date {
    return new Date(completedAt.getTime() + this.retentionDays * 24 * 60 * 60 * 1000);
  }
}

export interface BackupCompletionDetails {
  sizeBytes: number;
  checksumSha256: string;
  locationUri: string;
}

/**
 * One backup run, from being scheduled through to expiry or restore.
 * Constructed only via `BackupRecord.schedule()` — there is no public
 * constructor, mirroring `Payment`'s own "aggregates are created through
 * a named factory, not `new`" convention.
 */
export class BackupRecord {
  private constructor(
    readonly id: string,
    readonly target: BackupTarget,
    readonly type: BackupType,
    readonly retentionPolicy: RetentionPolicy,
    private _status: BackupStatus,
    readonly createdAt: Date,
    private _startedAt: Date | null,
    private _completedAt: Date | null,
    private _expiresAt: Date | null,
    private _sizeBytes: number | null,
    private _checksumSha256: string | null,
    private _locationUri: string | null,
    private _verifiedAt: Date | null,
    private _restoredAt: Date | null,
    private _failureReason: string | null,
  ) {}

  static schedule(id: string, target: BackupTarget, type: BackupType, retentionPolicy: RetentionPolicy, now: Date): BackupRecord {
    return new BackupRecord(id, target, type, retentionPolicy, "PENDING", now, null, null, null, null, null, null, null, null, null);
  }

  /** Reconstructs a `BackupRecord` from persisted state — the repository's own factory, never for new records. */
  static rehydrate(fields: {
    id: string;
    target: BackupTarget;
    type: BackupType;
    retentionPolicy: RetentionPolicy;
    status: BackupStatus;
    createdAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
    expiresAt: Date | null;
    sizeBytes: number | null;
    checksumSha256: string | null;
    locationUri: string | null;
    verifiedAt: Date | null;
    restoredAt: Date | null;
    failureReason: string | null;
  }): BackupRecord {
    return new BackupRecord(
      fields.id,
      fields.target,
      fields.type,
      fields.retentionPolicy,
      fields.status,
      fields.createdAt,
      fields.startedAt,
      fields.completedAt,
      fields.expiresAt,
      fields.sizeBytes,
      fields.checksumSha256,
      fields.locationUri,
      fields.verifiedAt,
      fields.restoredAt,
      fields.failureReason,
    );
  }

  get status(): BackupStatus {
    return this._status;
  }

  get startedAt(): Date | null {
    return this._startedAt;
  }

  get completedAt(): Date | null {
    return this._completedAt;
  }

  get expiresAt(): Date | null {
    return this._expiresAt;
  }

  get sizeBytes(): number | null {
    return this._sizeBytes;
  }

  get checksumSha256(): string | null {
    return this._checksumSha256;
  }

  get locationUri(): string | null {
    return this._locationUri;
  }

  get verifiedAt(): Date | null {
    return this._verifiedAt;
  }

  get restoredAt(): Date | null {
    return this._restoredAt;
  }

  get failureReason(): string | null {
    return this._failureReason;
  }

  private assertTransition(next: BackupStatus): void {
    if (!ALLOWED_TRANSITIONS[this._status].includes(next)) {
      throw new InvalidBackupTransitionError(
        `Backup ${this.id} cannot transition from ${this._status} to ${next}.`,
      );
    }
  }

  markRunning(now: Date): void {
    this.assertTransition("RUNNING");
    this._status = "RUNNING";
    this._startedAt = now;
  }

  markCompleted(details: BackupCompletionDetails, now: Date): void {
    this.assertTransition("COMPLETED");
    this._status = "COMPLETED";
    this._completedAt = now;
    this._sizeBytes = details.sizeBytes;
    this._checksumSha256 = details.checksumSha256;
    this._locationUri = details.locationUri;
    this._expiresAt = this.retentionPolicy.expiryDateFor(now);
  }

  markFailed(reason: string, now: Date): void {
    this.assertTransition("FAILED");
    this._status = "FAILED";
    this._completedAt = now;
    this._failureReason = reason;
  }

  markVerified(now: Date): void {
    this.assertTransition("VERIFIED");
    this._status = "VERIFIED";
    this._verifiedAt = now;
  }

  markRestored(now: Date): void {
    this.assertTransition("RESTORED");
    this._restoredAt = now;
  }

  markExpired(now: Date): void {
    this.assertTransition("EXPIRED");
    this._status = "EXPIRED";
    // `expiresAt` already records when this happened logically; `now` is
    // accepted for symmetry with every other transition method but not
    // separately stored — there is no `expiredAt` field distinct from
    // `expiresAt` for the same reason `Payment` has no separate
    // "refundedAt" beyond `updatedAt`: one timestamp per meaningful event.
    void now;
  }

  /** Whether `now` is past this backup's computed expiry — pure, no side effect. */
  isExpired(now: Date): boolean {
    return this._expiresAt !== null && now.getTime() >= this._expiresAt.getTime();
  }

  /** Whether this record is currently a legitimate restore candidate on lifecycle grounds alone (see `RestoreValidationService` for the full check, including integrity). */
  isRestorable(now: Date): boolean {
    return (this._status === "COMPLETED" || this._status === "VERIFIED") && !this.isExpired(now);
  }
}
