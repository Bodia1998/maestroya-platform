import { createHmac, timingSafeEqual } from "node:crypto";

import { VerificationProviderError } from "@/domain/errors/domain-error";
import type { ProviderVerificationOutcome } from "@/domain/services/verification-provider-outcome";
import type {
  StartVerificationRequest,
  StartVerificationResult,
  VerificationProvider,
  VerificationStatusResult,
  WebhookValidationResult,
} from "@/application/ports/verification-provider";
import type { PersonaClient } from "@/infrastructure/verification/persona-client";

/**
 * Module 59 — Professional Verification (Persona).
 *
 * `VerificationProvider` implementation backed by Persona's Inquiries API.
 * The only file in this module that ever imports `PersonaClient` or knows
 * about a Persona `Inquiry`'s JSON:API shape — every method below maps
 * Persona's own vocabulary onto this port's provider-agnostic DTOs before
 * returning, so no Persona type or status string ever crosses into
 * application/domain code (see `VerificationProvider`'s own doc comment).
 *
 * ## Status mapping
 * Persona inquiry `status` -> `ProviderVerificationOutcome`
 * (domain/services/verification-provider-outcome.ts):
 *  - `created`, `pending` -> `PENDING`
 *  - `completed` -> `VERIFIED`
 *  - `failed`, `declined` -> `REJECTED`
 *  - `needs_review` -> `NEEDS_REVIEW`
 *  - `expired` -> `EXPIRED`
 *  - anything else (an unrecognized/future Persona status) -> `IN_PROGRESS`,
 *    the safe "still running, no decision yet, do not transition"
 *    default — see `mapProviderOutcomeToCaseStatus`'s own doc comment for
 *    why that outcome never itself changes a case's status.
 *
 * ## Data minimization
 * Nothing this class sends to or receives from Persona is persisted
 * beyond `providerVerificationId`/`providerStatus`/`providerSyncedAt` —
 * see `ProfessionalVerification`'s schema.prisma doc comment. Document
 * images, extracted document fields (address, date of birth, document
 * number), and selfie images live only in Persona's own systems; this
 * class never requests or stores them.
 */
const STATUS_TO_OUTCOME: Record<string, ProviderVerificationOutcome> = {
  created: "PENDING",
  pending: "PENDING",
  completed: "VERIFIED",
  approved: "VERIFIED",
  failed: "REJECTED",
  declined: "REJECTED",
  needs_review: "NEEDS_REVIEW",
  expired: "EXPIRED",
};

function mapPersonaStatus(rawStatus: string): ProviderVerificationOutcome {
  return STATUS_TO_OUTCOME[rawStatus] ?? "IN_PROGRESS";
}

interface PersonaInquiryAttributes {
  status: string;
  "reference-id"?: string | null;
}

interface PersonaInquiryResource {
  data: {
    id: string;
    type: string;
    attributes: PersonaInquiryAttributes;
  };
  meta?: {
    "one-time-link"?: string;
    "one-time-link-short"?: string;
  };
}

export interface PersonaVerificationProviderOptions {
  client: PersonaClient;
  templateId: string;
  webhookSecret?: string;
}

export class PersonaVerificationProvider implements VerificationProvider {
  readonly name = "PERSONA" as const;

  private readonly client: PersonaClient;
  private readonly templateId: string;
  private readonly webhookSecret?: string;

  constructor(options: PersonaVerificationProviderOptions) {
    this.client = options.client;
    this.templateId = options.templateId;
    this.webhookSecret = options.webhookSecret;
  }

  async createVerification(request: StartVerificationRequest): Promise<StartVerificationResult> {
    const response = await this.client.request<PersonaInquiryResource>({
      method: "POST",
      path: "/inquiries",
      body: {
        data: {
          attributes: {
            "inquiry-template-id": this.templateId,
            "reference-id": request.verificationId,
            fields: {
              "name-first": request.fullName.split(" ").slice(0, -1).join(" ") || request.fullName,
              "name-last": request.fullName.split(" ").slice(-1).join(" "),
              "address-country-code": request.countryCode,
            },
          },
        },
      },
    });

    const verificationUrl = response.meta?.["one-time-link"] ?? response.meta?.["one-time-link-short"];
    if (!verificationUrl) {
      throw new VerificationProviderError("PERSONA", "Persona did not return a hosted verification link.", false);
    }

    return {
      providerVerificationId: response.data.id,
      verificationUrl,
      outcome: mapPersonaStatus(response.data.attributes.status),
    };
  }

  async getVerification(providerVerificationId: string): Promise<VerificationStatusResult> {
    const response = await this.client.request<PersonaInquiryResource>({
      method: "GET",
      path: `/inquiries/${encodeURIComponent(providerVerificationId)}`,
    });
    return this.toStatusResult(response);
  }

  async refreshStatus(providerVerificationId: string): Promise<VerificationStatusResult> {
    // Persona has no separate "force re-check" endpoint distinct from
    // reading the inquiry's current state — an inquiry's status changes
    // only in response to the professional completing steps in Persona's
    // own hosted flow or an internal Persona reviewer decision, neither of
    // which this platform can trigger. Reading is the refresh.
    return this.getVerification(providerVerificationId);
  }

  async generateVerificationLink(providerVerificationId: string): Promise<string> {
    const response = await this.client.request<PersonaInquiryResource>({
      method: "POST",
      path: `/inquiries/${encodeURIComponent(providerVerificationId)}/generate-one-time-link`,
    });
    const verificationUrl = response.meta?.["one-time-link"] ?? response.meta?.["one-time-link-short"];
    if (!verificationUrl) {
      throw new VerificationProviderError("PERSONA", "Persona did not return a hosted verification link.", false);
    }
    return verificationUrl;
  }

  webhookValidation(rawBody: string, signatureHeader: string | null): WebhookValidationResult {
    if (!this.webhookSecret || !signatureHeader) {
      return { valid: false };
    }

    // Persona signs webhooks as `Persona-Signature: t=<timestamp>,v1=<hmac>`
    // (HMAC-SHA256 of `${timestamp}.${rawBody}`, hex-encoded) — see
    // https://docs.withpersona.com/docs/webhooks#verifying-webhooks.
    const parts = Object.fromEntries(
      signatureHeader.split(",").map((part) => {
        const [key, value] = part.split("=");
        return [key?.trim(), value?.trim()];
      }),
    );
    const timestamp = parts.t;
    const signature = parts.v1;
    if (!timestamp || !signature) return { valid: false };

    const expected = createHmac("sha256", this.webhookSecret).update(`${timestamp}.${rawBody}`).digest("hex");

    const expectedBuffer = Buffer.from(expected, "hex");
    const providedBuffer = Buffer.from(signature, "hex");
    const valid =
      expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);

    if (!valid) return { valid: false };

    try {
      const payload = JSON.parse(rawBody) as { data?: { attributes?: { payload?: PersonaInquiryResource } } };
      const inquiry = payload.data?.attributes?.payload;
      if (!inquiry) return { valid: true };
      return {
        valid: true,
        providerVerificationId: inquiry.data.id,
        outcome: mapPersonaStatus(inquiry.data.attributes.status),
        rawStatus: inquiry.data.attributes.status,
      };
    } catch {
      // Signature was valid but the body wasn't the shape expected — still
      // report `valid: true` (the signature genuinely came from Persona)
      // without a parsed outcome, rather than treating a shape change as a
      // forgery.
      return { valid: true };
    }
  }

  private toStatusResult(response: PersonaInquiryResource): VerificationStatusResult {
    return {
      providerVerificationId: response.data.id,
      outcome: mapPersonaStatus(response.data.attributes.status),
      rawStatus: response.data.attributes.status,
      checkedAt: new Date(),
    };
  }
}
