import { randomUUID } from "node:crypto";

import { Entity } from "@/domain/entities/entity";
import { ValidationError } from "@/domain/errors/domain-error";
import { type ConsentTypeValue } from "@/domain/value-objects/consent-type";

/**
 * Module 38 — GDPR Compliance.
 *
 * `Consent` is an immutable record of a user having granted (and, later,
 * possibly withdrawn) one of the platform's tracked consent types — terms
 * of service, privacy policy, or marketing. Modeled as an `Entity<Props>`
 * (same base class `Payment`, `domain/entities/payment.ts`, uses) rather
 * than a bare record type, because it needs an identity independent of its
 * attributes: granting the same consent type again after a withdrawal
 * produces a brand-new `Consent` row, not a mutation of the withdrawn one
 * (see `withdraw()` below) — GDPR's own "keep a history of consent, don't
 * overwrite it" expectation.
 *
 * Deliberately **immutable**: unlike `Payment` (which mutates `this.props`
 * in place through a state-machine graph), `Consent` has no transition
 * graph — granting and withdrawing are just two points in time on one
 * append-only fact. `withdraw()` therefore does not mutate the receiver;
 * it returns a *new* `Consent` instance with `withdrawnAt` set, leaving the
 * original untouched. This mirrors how `GrantConsentUseCase`/
 * `WithdrawConsentUseCase` are expected to use it: read the current active
 * consent (if any) from `ConsentRepository`, produce the next state via
 * this class, persist it, then publish the corresponding domain event
 * (`ConsentGranted`/`ConsentWithdrawn`) — the use case owns publishing, not
 * this entity (unlike `Payment.capture()`, which raises its own event; see
 * that class's own doc comment for why this module didn't need to follow
 * suit — GDPR's consent events are audit-trail entries, not aggregate-
 * internal side effects another part of the same transaction reacts to).
 */
export interface ConsentProps {
  userId: string;
  type: ConsentTypeValue;
  /** Free-form version identifier for the terms/policy text the user
   *  consented to (e.g. "2026-01-15" or "v3") — never validated against a
   *  fixed enum here; that lives entirely at the application edge/CMS that
   *  manages legal copy. */
  version: string;
  grantedAt: Date;
  /** `null` while the consent is still in effect. Once set, this specific
   *  `Consent` row is terminal — granting the same type again is always a
   *  new `Consent.grant()`, never a re-activation of a withdrawn one. */
  withdrawnAt: Date | null;
}

export interface GrantConsentInput {
  id?: string;
  userId: string;
  type: ConsentTypeValue;
  version: string;
  grantedAt?: Date;
}

export class Consent extends Entity<ConsentProps> {
  private constructor(props: ConsentProps, id: string) {
    super(props, id);
  }

  static grant(input: GrantConsentInput): Consent {
    if (!input.userId.trim()) {
      throw new ValidationError("A consent record must reference a user.");
    }
    if (!input.version.trim()) {
      throw new ValidationError("A consent record must carry a version of the text consented to.");
    }

    return new Consent(
      {
        userId: input.userId,
        type: input.type,
        version: input.version,
        grantedAt: input.grantedAt ?? new Date(),
        withdrawnAt: null,
      },
      input.id ?? randomUUID(),
    );
  }

  /** Rehydrates an already-persisted `Consent` row (`ConsentRepository`'s
   *  job) without re-running `grant()`'s input validation. */
  static reconstitute(props: ConsentProps, id: string): Consent {
    return new Consent({ ...props }, id);
  }

  get userId(): string {
    return this.props.userId;
  }

  get type(): ConsentTypeValue {
    return this.props.type;
  }

  get version(): string {
    return this.props.version;
  }

  get grantedAt(): Date {
    return this.props.grantedAt;
  }

  get withdrawnAt(): Date | null {
    return this.props.withdrawnAt;
  }

  /** Whether this consent is currently in effect (granted and not yet
   *  withdrawn). */
  get isActive(): boolean {
    return this.props.withdrawnAt === null;
  }

  /**
   * Returns a *new* `Consent` instance representing this same grant, now
   * withdrawn at `withdrawnAt`. Does not mutate `this` — see this class's
   * own doc comment for why. Throws if called on a consent that is already
   * withdrawn (withdrawing twice is not a meaningful state transition;
   * `WithdrawConsentUseCase` should treat an already-withdrawn consent as a
   * no-op at the application level rather than calling this again).
   */
  withdraw(withdrawnAt: Date = new Date()): Consent {
    if (!this.isActive) {
      throw new ValidationError("This consent has already been withdrawn.");
    }
    if (withdrawnAt.getTime() < this.props.grantedAt.getTime()) {
      throw new ValidationError("A consent cannot be withdrawn before it was granted.");
    }
    return new Consent({ ...this.props, withdrawnAt }, this.id);
  }
}
