import { DomainError } from "@/domain/errors/domain-error";
import type { LeadRequestCategoryRepository } from "@/domain/repositories/lead-request-category-repository";
import {
  isLeadRequestCategorySupported,
  type LeadRequestCategoryPolicy,
} from "@/domain/services/lead-request-category-support";
import type { CustomerLeadRequestReceipt, LeadRequestInput } from "@/application/dto/lead-request.dto";
import type { CreateLeadV1ServiceRequestUseCase } from "@/application/use-cases/lead/create-lead-v1-service-request.use-case";
import type { PublishLeadUseCase } from "@/application/use-cases/lead/publish-lead.use-case";

/** The chosen category is not one the LEAD_V1 pilot can serve. Fixed public message. */
export class LeadRequestCategoryUnsupportedError extends DomainError {
  readonly code = "LEAD_REQUEST_CATEGORY_UNSUPPORTED";

  constructor() {
    super("This service category is not available for requests yet.");
  }
}

export interface SubmitLeadRequestResult {
  /** Customer-safe acknowledgement — the only thing an entry point may return to the browser. */
  receipt: CustomerLeadRequestReceipt;
  /**
   * Server-side only (logging/tests): whether the backend publication
   * contract accepted the Lead right away. NEVER forwarded to the browser —
   * the customer experience is identical either way.
   */
  publication: "PUBLISHED" | "DEFERRED";
}

/**
 * Module 142 — the customer's "Request a service" submission, as one use case.
 *
 *   category support (Module 132 config) -> LEAD_V1 ServiceRequest + DRAFT Lead
 *   (Module 125, flow forced server-side) -> publication attempt (Module 133).
 *
 * `userId` must come from the server-side session; nothing identity-related is
 * accepted from `input`. Every decision stays in the existing use cases: this
 * class only orders them and decides what is safe to say back.
 *
 * Publication is attempted but not required for success: once the request
 * exists, a publication rejection (unpriceable, configuration problem) leaves
 * the Lead DRAFT — retryable by the existing PublishLeadUseCase — and must not
 * look like a failure to the customer, who would otherwise resubmit and create
 * a duplicate. Programmer/infrastructure errors from publication are likewise
 * contained for the same reason; the caller logs `publication: "DEFERRED"`.
 *
 * Financially inert, like the use cases it composes: no Quote, Payment,
 * LeadPurchase or contact data is touched, and nothing here prices anything.
 */
export class SubmitLeadRequestUseCase {
  constructor(
    private readonly categories: LeadRequestCategoryRepository,
    private readonly policy: LeadRequestCategoryPolicy,
    private readonly createRequest: Pick<CreateLeadV1ServiceRequestUseCase, "execute">,
    private readonly publishLead: Pick<PublishLeadUseCase, "execute">,
  ) {}

  async execute(userId: string, input: LeadRequestInput): Promise<SubmitLeadRequestResult> {
    const category = await this.categories.findActiveById(input.categoryId);
    if (!category || !isLeadRequestCategorySupported(category, this.policy)) {
      throw new LeadRequestCategoryUnsupportedError();
    }

    const { serviceRequest, lead } = await this.createRequest.execute(userId, input);

    let publication: SubmitLeadRequestResult["publication"] = "PUBLISHED";
    try {
      await this.publishLead.execute(userId, lead.id);
    } catch {
      publication = "DEFERRED";
    }

    return { receipt: { requestId: serviceRequest.id, status: "RECEIVED" }, publication };
  }
}
