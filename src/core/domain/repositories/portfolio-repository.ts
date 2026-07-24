/**
 * Portfolio module (Module 14): repository interface for the PortfolioItem
 * aggregate. Follows the same "record + narrow repository interface"
 * convention as ReviewRepository/QuoteRepository — no `Entity<Props>`
 * subclass, pure business rules live in domain/services/portfolio-rules.ts,
 * this file only defines the shape data is read/written in.
 *
 * A PortfolioItem always belongs to exactly one ProfessionalProfile (see
 * schema.prisma's PortfolioItem model doc comment) — this codebase only
 * supports solo professionals end-to-end today, same scope note as
 * Review's revieweeProfessionalProfileId.
 */

export interface PortfolioItemRecord {
  id: string;
  professionalProfileId: string;
  serviceCategoryId: string | null;
  title: string;
  description: string | null;
  mediaUrl: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePortfolioItemData {
  professionalProfileId: string;
  serviceCategoryId: string | null;
  title: string;
  description: string | null;
  mediaUrl: string;
}

/**
 * Deliberately excludes `professionalProfileId` — ownership can never be
 * changed through an update, same "no reassigning ownership" convention as
 * UpdateProfessionalData/UpdateQuoteFields.
 */
export interface UpdatePortfolioItemData {
  serviceCategoryId: string | null;
  title: string;
  description: string | null;
  mediaUrl: string;
}

export interface ListPortfolioItemsOptions {
  limit: number;
  offset: number;
}

export interface PortfolioRepository {
  /** Excludes soft-deleted rows (returns null for a deleted item) — same
   *  "a deleted row behaves like it never existed" convention as
   *  Address/ServiceRequest's own `deletedAt: null` reads. */
  findById(id: string): Promise<PortfolioItemRecord | null>;

  /** Newest first (see ListPortfolioItemsOptions), excludes soft-deleted
   *  rows. Used both for the public professional-profile listing and the
   *  owner's own dashboard listing — this module has no distinct
   *  "public vs. private" projection of PortfolioItem (see this module's
   *  documentation for why every field here is safe to expose publicly). */
  listByProfessionalId(
    professionalProfileId: string,
    options: ListPortfolioItemsOptions,
  ): Promise<PortfolioItemRecord[]>;

  create(data: CreatePortfolioItemData): Promise<PortfolioItemRecord>;

  /** Implementations MUST NOT allow `professionalProfileId` to change —
   *  UpdatePortfolioItemData's type doesn't even have a field for it. */
  update(id: string, data: UpdatePortfolioItemData): Promise<PortfolioItemRecord>;

  /** Soft-deletes the item (`deletedAt` set) — the row is kept, never hard-
   *  deleted, same convention as Message.softDelete. */
  softDelete(id: string): Promise<void>;
}
