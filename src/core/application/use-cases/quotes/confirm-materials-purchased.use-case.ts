import { NullNotificationCreator } from "@/application/ports/notification-creator";
import type { NotificationCreator } from "@/application/ports/notification-creator";
import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { QuoteRecord, QuoteRepository } from "@/domain/repositories/quote-repository";
import type { ServiceRequestRepository } from "@/domain/repositories/service-request-repository";
import { canConfirmMaterialsPurchase } from "@/domain/services/materials-procurement-rules";

/**
 * Module 63 — Materials Procurement Workflow: the *customer* confirms
 * they have purchased every item on the required-materials checklist
 * attached to their accepted (or still-open) Quote. Implements the
 * workflow step "Customer purchases materials -> Customer confirms" from
 * the module spec — this is the action that flips
 * `Quote.materialsConfirmedAt` from null to set, which is in turn the
 * only thing `StartJobUseCase` checks before letting work begin (see
 * `domain/services/materials-procurement-rules.ts`'s
 * `canStartJobGivenMaterials`).
 *
 * Authorization is never based on a client-supplied customerId/quoteId
 * pairing being "trusted" — same convention as AcceptQuoteUseCase: every
 * ownership check here is re-derived from the authenticated session's own
 * CustomerProfile, via the ServiceRequest the Quote belongs to. A Quote
 * that exists but isn't on the caller's own ServiceRequest surfaces as
 * the same NotFoundError as one that doesn't exist at all.
 */
export class ConfirmMaterialsPurchasedUseCase {
  constructor(
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly serviceRequests: ServiceRequestRepository,
    private readonly quotes: QuoteRepository,
    // Notifications module (Module 15): both optional, defaulting to
    // undefined/a no-op so every pre-existing direct construction of this
    // use case (this module's own tests) keeps compiling and behaving
    // exactly as before — see NullNotificationCreator's own doc comment.
    private readonly professionals?: ProfessionalRepository,
    private readonly notifications: NotificationCreator = new NullNotificationCreator(),
  ) {}

  async execute(userId: string, quoteId: string): Promise<QuoteRecord> {
    const customer = await this.customerProfiles.findByUserId(userId);
    if (!customer) {
      throw new NotFoundError("Quote", quoteId);
    }

    const quote = await this.quotes.findById(quoteId);
    if (!quote) {
      throw new NotFoundError("Quote", quoteId);
    }

    const request = await this.serviceRequests.findById(quote.serviceRequestId);
    if (!request || request.customerId !== customer.id) {
      throw new NotFoundError("Quote", quoteId);
    }

    if (!canConfirmMaterialsPurchase(quote.materialsStrategy, quote.materialsConfirmedAt)) {
      throw new ValidationError(
        quote.materialsStrategy === "CUSTOMER_PURCHASED"
          ? "Materials for this quote have already been confirmed as purchased."
          : "This quote doesn't require the customer to purchase materials.",
      );
    }

    const confirmed = await this.quotes.confirmMaterialsPurchased(quote.id, userId);

    // Best-effort — mirrors AcceptQuoteUseCase's own doc comment: a
    // notification-creation failure must never undo or fail the
    // confirmation itself. `professionals` is optional (see this class's
    // own doc comment) — skipped entirely if not supplied.
    if (this.professionals && quote.professionalProfileId) {
      try {
        const professional = await this.professionals.findById(quote.professionalProfileId);
        if (professional) {
          await this.notifications.notify({
            userId: professional.userId,
            type: "MATERIALS_PURCHASE_CONFIRMED",
            title: "Materials purchase confirmed",
            message: "The customer confirmed that all required materials have been purchased.",
            resourceType: "QUOTE",
            resourceId: confirmed.id,
            actionUrl: `/dashboard/professional/quotes`,
          });
        }
      } catch (error) {
        console.error("Failed to create materials-purchase-confirmed notification", error);
      }
    }

    return confirmed;
  }
}
