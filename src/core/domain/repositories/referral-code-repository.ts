/**
 * Module 60 — Referral & Marketing Attribution Platform: repository
 * interface for `ReferralCode` — the administered, unique code strings a
 * professional/marketing campaign shares (e.g. `?r=telegram_valencia`).
 * Narrow, record-shaped interface — same convention as
 * `professional-verification-repository.ts` — with the actual format
 * rules living in `domain/services/referral-code-rules.ts`, not here.
 */
export interface ReferralCodeRecord {
  id: string;
  /** Already normalized (lowercase) — see `normalizeReferralCode`. */
  code: string;
  /** The user this code is attributed to (e.g. a professional's own
   *  referral link), or `null` for a platform-level/campaign code with no
   *  single owner (e.g. `"instagram_launch"`). */
  ownerUserId: string | null;
  /** Free-text description for an admin's own reference — never shown to
   *  a visitor. */
  label: string | null;
  createdAt: Date;
}

export interface CreateReferralCodeData {
  code: string;
  ownerUserId?: string | null;
  label?: string | null;
}

export interface ReferralCodeRepository {
  create(data: CreateReferralCodeData): Promise<ReferralCodeRecord>;
  findByCode(code: string): Promise<ReferralCodeRecord | null>;
  findById(id: string): Promise<ReferralCodeRecord | null>;
  /** Every administered code — used by reporting to enumerate labels; not
   *  suitable for a public listing (no pagination — the platform's own
   *  referral-code catalog is expected to stay small; add pagination here
   *  if that assumption stops holding). */
  list(): Promise<ReferralCodeRecord[]>;
  /**
   * Module 61 — Affiliate & Partner System: every code owned by
   * `ownerUserId`, newest first. Added for the Partner System to list a
   * partner's own generated referral links without introducing a second
   * "partner referral code" table — a partner's links are just
   * `ReferralCode` rows whose `ownerUserId` is the partner's own `userId`.
   * See docs/MODULE_61's "Referral Attribution" section.
   */
  findByOwnerUserId(ownerUserId: string): Promise<ReferralCodeRecord[]>;
}
