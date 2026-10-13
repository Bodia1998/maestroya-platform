import { DomainError } from "@/domain/errors/domain-error";
import type { LeadRequestCategoryRepository } from "@/domain/repositories/lead-request-category-repository";
import {
  isLeadRequestCategorySupported,
  type LeadRequestCategoryPolicy,
} from "@/domain/services/lead-request-category-support";
import {
  LeadContactSharingRequiredError,
  LeadPrivacyPolicyNotConfiguredError,
  isValidNoticeVersion,
  type LeadPrivacyPolicy,
} from "@/domain/services/lead-privacy";
import {
  deriveLeadV1StructuredScope,
  type LeadScopeProvenance,
  type ScopeAnswerIssueCode,
  type ScopeQuestionnaireRegistry,
} from "@/domain/services/lead-scope-questionnaire";
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

export type LeadRequestScopeIssueCode = ScopeAnswerIssueCode | "QUESTIONNAIRE_NOT_AVAILABLE";

/**
 * Module 163 — the submitted scope answers cannot be used (invalid, incomplete, contradictory, or the category has no
 * questionnaire). Nothing was created. The fixed message is safe to show; `issues` (question ids and reason codes only — no values)
 * lets the entry point point the customer at the offending question.
 */
export class LeadRequestScopeInvalidError extends DomainError {
  readonly code = "LEAD_REQUEST_SCOPE_INVALID";

  constructor(readonly issues: readonly { code: LeadRequestScopeIssueCode; questionId: string | null }[]) {
    super("The scope answers could not be accepted.");
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
 * Module 158 — optional capture of the customer's contact-sharing choice at submission time. Absent = the pre-M158 behaviour,
 * unchanged. `policy` comes from the server configuration (never from the client); `record` is the ownership-checked
 * `RecordLeadContactSharingUseCase`; `cancelRequest` is the existing central request cancellation (compensation only).
 */
export interface LeadContactSharingCapture {
  policy: Pick<LeadPrivacyPolicy, "contactSharingBasis" | "noticeVersion">;
  record: (userId: string, leadId: string) => Promise<unknown>;
  cancelRequest: (requestId: string) => Promise<void>;
}

export interface SubmitLeadRequestOptions {
  /** The customer affirmatively accepted the contact-sharing notice / gave the consent. Only ever set from an explicit customer
   *  action; its absence is never read as consent. */
  contactSharingAccepted?: boolean;
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
    private readonly contactSharing?: LeadContactSharingCapture,
    /** Module 163: released questionnaires by category slug. Absent/empty = no category accepts structured scope answers. */
    private readonly scopeQuestionnaires: ScopeQuestionnaireRegistry = {},
  ) {}

  async execute(userId: string, input: LeadRequestInput, options: SubmitLeadRequestOptions = {}): Promise<SubmitLeadRequestResult> {
    const category = await this.categories.findActiveById(input.categoryId);
    if (!category || !isLeadRequestCategorySupported(category, this.policy)) {
      throw new LeadRequestCategoryUnsupportedError();
    }

    // Module 163 — decided BEFORE anything is created. Answers that are present are either valid for the category's questionnaire or
    // the whole submission is refused: they are never ignored, defaulted or treated as neutral. Absent answers stay allowed (the
    // request is simply estimated without structured scope).
    const scope = this.resolveScope(category, input.scopeAnswers);

    // Module 158 — decided BEFORE anything is created, so a refusal leaves no orphan request:
    //  - policy basis CONSENT: no affirmative acceptance => refuse (silence is never consent; fails closed), and a policy that cannot
    //    name its notice version cannot record evidence => refuse;
    //  - another basis: evidence is captured only when the customer affirmed the notice; otherwise nothing is recorded (we never
    //    fabricate evidence that a notice was shown);
    //  - no policy configured (D19 undecided) or no capture wired: unchanged behaviour.
    const capture = this.contactSharing;
    const basis = capture?.policy.contactSharingBasis ?? null;
    const accepted = options.contactSharingAccepted === true;
    if (capture && basis === "CONSENT" && !accepted) throw new LeadContactSharingRequiredError();
    if (capture && basis !== null && accepted && !isValidNoticeVersion(capture.policy.noticeVersion)) {
      throw new LeadPrivacyPolicyNotConfiguredError();
    }

    const { serviceRequest, lead } = await (scope ? this.createRequest.execute(userId, input, { scope }) : this.createRequest.execute(userId, input));

    if (capture && basis !== null && accepted) {
      try {
        await capture.record(userId, lead.id);
      } catch (error) {
        if (basis === "CONSENT") {
          // No consent evidence => the lead must not be offered. Take the just-created request (and its lead) off, then fail.
          await capture.cancelRequest(serviceRequest.id).catch(() => undefined);
          throw error;
        }
        // Notice-only basis: the notice record is evidence, not a precondition of the lawful basis; publication continues.
      }
    }

    let publication: SubmitLeadRequestResult["publication"] = "PUBLISHED";
    try {
      await this.publishLead.execute(userId, lead.id);
    } catch {
      publication = "DEFERRED";
    }

    return { receipt: { requestId: serviceRequest.id, status: "RECEIVED" }, publication };
  }

  private resolveScope(category: { slug: string; parentSlug: string | null }, answers: unknown): LeadScopeProvenance | undefined {
    if (answers === undefined) return undefined;
    const derivation = deriveLeadV1StructuredScope(this.scopeQuestionnaires, { categorySlug: category.slug, parentCategorySlug: category.parentSlug }, answers);
    if (derivation.status === "STRUCTURED") return { questionnaireVersion: derivation.structuredScope.questionnaireVersion, answers: derivation.answers };
    if (derivation.status === "REJECTED") throw new LeadRequestScopeInvalidError(derivation.issues);
    throw new LeadRequestScopeInvalidError([{ code: "QUESTIONNAIRE_NOT_AVAILABLE", questionId: null }]);
  }
}
