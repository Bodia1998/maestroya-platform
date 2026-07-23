/**
 * Offers/Quotes module: repository interface for the existing
 * `Quote` / `QuoteItem` models (see schema.prisma). Follows the same
 * "narrow, module-scoped interface" convention as ServiceRequestRepository —
 * only the operations this module's use cases need.
 *
 * Scope note: `Quote.companyProfileId` (a company, rather than a solo
 * professional, submitting a quote) exists on the schema for a future
 * Company module this feature does not implement — every operation here is
 * scoped to `professionalProfileId` only, never `companyProfileId`.
 */

export type QuoteStatusValue =
  | "PENDING"
  | "SENT"
  | "VIEWED"
  | "ACCEPTED"
  | "REJECTED"
  | "EXPIRED"
  | "WITHDRAWN";

export interface QuoteItemInput {
  description: string;
  /** Decimal(10,2) in the schema — see domain/services/money.ts for how
   *  this is rounded/validated at the application boundary. */
  quantity: number;
  unitPrice: number;
}

export interface QuoteItemRecord extends QuoteItemInput {
  id: string;
  /** Always `quantity * unitPrice`, computed server-side — see money.ts.
   *  Never trusted from client input even if supplied. */
  amount: number;
  sortOrder: number;
}

export interface QuoteRecord {
  id: string;
  serviceRequestId: string;
  /** ProfessionalProfile.id — never a User.id. Ownership of a Quote is
   *  always this field, checked against the authenticated session's own
   *  ProfessionalProfile, never a client-supplied id. */
  professionalProfileId: string;
  /** The User who actually submitted the quote — for a solo professional
   *  this is always their own userId (see CreateQuoteUseCase). */
  submittedByUserId: string;
  status: QuoteStatusValue;
  /** Always the sum of `items[].amount` — see money.ts. */
  totalAmount: number;
  currency: string;
  validUntil: Date | null;
  notes: string | null;
  items: QuoteItemRecord[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateQuoteData {
  serviceRequestId: string;
  professionalProfileId: string;
  submittedByUserId: string;
  totalAmount: number;
  currency: string;
  validUntil: Date | null;
  notes: string | null;
  items: QuoteItemInput[];
}

/**
 * Every field here is always supplied in full by UpdateQuoteUseCase (unlike
 * UpdateServiceRequestFields, which is a partial "set what's given" shape)
 * — an edit always resubmits the complete set of items and recalculates
 * the total from them, so there is no partial-merge ambiguity for money
 * fields. Deliberately excludes `serviceRequestId`/`professionalProfileId`/
 * `submittedByUserId` — those can never be changed by an update.
 */
export interface UpdateQuoteFields {
  totalAmount: number;
  currency: string;
  validUntil: Date | null;
  notes: string | null;
  items: QuoteItemInput[];
}

export interface QuoteRepository {
  findById(id: string): Promise<QuoteRecord | null>;
  findManyByProfessionalId(
    professionalProfileId: string,
    status?: QuoteStatusValue,
  ): Promise<QuoteRecord[]>;
  findManyByServiceRequestId(serviceRequestId: string): Promise<QuoteRecord[]>;
  /**
   * Used by CreateQuoteUseCase to enforce "a professional cannot create
   * more than one active quote for the same ServiceRequest" — "active"
   * meaning SENT or VIEWED (see domain/services/quote-state.ts's
   * OPEN_QUOTE_STATUSES). Returns null if the professional's only quote(s)
   * for this request are already WITHDRAWN/terminal.
   */
  findActiveByServiceRequestAndProfessional(
    serviceRequestId: string,
    professionalProfileId: string,
  ): Promise<QuoteRecord | null>;
  /**
   * Chat module: unlike `findActiveByServiceRequestAndProfessional` (open
   * statuses only), this finds a quote regardless of status — used by
   * OpenConversationUseCase to check "has this professional ever quoted this
   * request," which stays true even after the quote is withdrawn/rejected/
   * accepted (see conversation-state.ts's doc comment on why chat access
   * outlives quote status).
   */
  findByServiceRequestAndProfessional(
    serviceRequestId: string,
    professionalProfileId: string,
  ): Promise<QuoteRecord | null>;
  create(data: CreateQuoteData): Promise<QuoteRecord>;
  update(id: string, data: UpdateQuoteFields): Promise<QuoteRecord>;
  updateStatus(id: string, status: QuoteStatusValue): Promise<void>;
}
