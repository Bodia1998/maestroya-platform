import {
  InvalidInvoiceTransitionError,
  NotFoundError,
  SelfBillingNotAuthorizedError,
  UnauthorizedError,
} from "@/domain/errors/domain-error";
import type { InvoiceRecord, InvoiceRepository } from "@/domain/repositories/invoice-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { CompanyRepository } from "@/domain/repositories/company-repository";
import type { SelfBillingAuthorizationRepository } from "@/domain/repositories/self-billing-authorization-repository";
import { canTransitionInvoiceStatus } from "@/domain/services/invoice-lifecycle";
import { isSelfBillingAuthorized } from "@/domain/services/self-billing-authorization-rules";
import type { EventBus } from "@/application/ports/event-bus";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import { publishDomainEvent } from "@/application/services/events/publish-domain-event";
import { InvoiceAccepted } from "@/domain/events/invoice-accepted";

/**
 * Module 79 — Invoicing & Credit Notes.
 *
 * The professional invoice acceptance use case: PENDING_ACCEPTANCE ->
 * ACCEPTED. Enforces every rule the module brief lists under "ELECTRONIC
 * ACCEPTANCE":
 *
 *  - the professional/company must be authenticated (`acceptedByUserId` is
 *    always resolved from the caller's own session by the presentation
 *    layer — this use case never trusts a client-supplied "acting as"
 *    field);
 *  - only the Job's actual owning professional/company may accept —
 *    verified by comparing `acceptedByUserId` against
 *    `ProfessionalRecord.userId`/`CompanyRecord.ownerUserId`, never by
 *    the invoice id alone;
 *  - an already-ISSUED (or later) invoice can never be "accepted" again;
 *  - repeated acceptance requests by the SAME correctly-authorized user
 *    are a safe idempotent no-op (returns the already-ACCEPTED record
 *    unchanged) rather than an error — the module brief requires this be
 *    "safely idempotent or rejected," and a no-op is the friendlier of
 *    the two for a user who double-clicked "accept."
 *
 * Acceptance evidence (timestamp, agreement version, and — captured by
 * the presentation layer, never invented here — IP/user-agent on the
 * underlying `SelfBillingAuthorizationRecord`) is written atomically with
 * the status transition by `InvoiceRepository.accept`, never as a
 * separate step that could be lost. See the module brief's own caution
 * against claiming this constitutes a qualified electronic signature —
 * this use case makes no such claim anywhere in its code or events.
 */
export class AcceptInvoiceUseCase {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly companies: CompanyRepository,
    private readonly selfBillingAuthorizations: SelfBillingAuthorizationRepository,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(invoiceId: string, acceptedByUserId: string): Promise<InvoiceRecord> {
    const invoice = await this.invoices.findById(invoiceId);
    if (!invoice) {
      throw new NotFoundError("Invoice", invoiceId);
    }

    const owner = invoice.professionalProfileId
      ? ({ type: "PROFESSIONAL", id: invoice.professionalProfileId } as const)
      : ({ type: "COMPANY", id: invoice.companyProfileId as string } as const);
    const ownerRecord =
      owner.type === "PROFESSIONAL" ? await this.professionals.findById(owner.id) : await this.companies.findById(owner.id);
    if (!ownerRecord) {
      throw new NotFoundError(owner.type === "PROFESSIONAL" ? "ProfessionalProfile" : "CompanyProfile", owner.id);
    }
    const ownerUserId = owner.type === "PROFESSIONAL" ? (ownerRecord as { userId: string }).userId : (ownerRecord as { ownerUserId: string }).ownerUserId;
    if (ownerUserId !== acceptedByUserId) {
      throw new UnauthorizedError("Only the professional/company this invoice was issued to may accept it.");
    }

    if (invoice.status === "ACCEPTED" && invoice.acceptedByUserId === acceptedByUserId) {
      // Idempotent no-op — see this class's own doc comment.
      return invoice;
    }

    if (!canTransitionInvoiceStatus(invoice.status, "ACCEPTED")) {
      throw new InvalidInvoiceTransitionError(
        `Invoice ${invoiceId} cannot be accepted from status ${invoice.status} (an ISSUED/PAID/CANCELLED invoice can never be (re-)accepted).`,
      );
    }

    const authorization =
      owner.type === "PROFESSIONAL"
        ? await this.selfBillingAuthorizations.findActiveForProfessional(owner.id)
        : await this.selfBillingAuthorizations.findActiveForCompany(owner.id);
    if (!isSelfBillingAuthorized(authorization)) {
      throw new SelfBillingNotAuthorizedError(
        "This invoice's self-billing authorization is no longer active — it must be re-granted before the invoice can be accepted.",
      );
    }

    const acceptedAt = new Date();
    const { applied, record } = await this.invoices.accept({
      id: invoiceId,
      acceptedByUserId,
      acceptedAt,
      acceptanceAgreementVersion: authorization!.agreementVersion,
      fromStatuses: ["PENDING_ACCEPTANCE"],
    });
    if (!applied) {
      throw new InvalidInvoiceTransitionError(
        `Invoice ${invoiceId} is no longer PENDING_ACCEPTANCE (now ${record.status}) — the acceptance transition lost a race or was already applied.`,
      );
    }

    await publishDomainEvent(
      this.eventBus,
      new InvoiceAccepted(
        record.id,
        record.jobId,
        record.professionalProfileId,
        record.companyProfileId,
        acceptedByUserId,
        acceptedAt,
        authorization!.agreementVersion,
      ),
      this.failureReporter,
    );

    return record;
  }
}
