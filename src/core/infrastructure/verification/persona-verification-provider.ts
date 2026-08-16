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

/**
 * Module 70.1 — Pre-Stripe Security & Integration Hardening. The outer
 * envelope Persona wraps every webhook delivery in — a `type: "event"`
 * resource whose own `id` is the delivery's unique event id (the
 * idempotency key), `attributes.name` is the event type (e.g.
 * `"inquiry.completed"`), and `attributes.payload` is the embedded
 * `Inquiry` resource (`PersonaInquiryResource` above) the rest of this
 * file already parses. See https://docs.withpersona.com/docs/webhooks.
 */
interface PersonaEventEnvelope {
  data: {
    id: string;
    type: string;
    attributes: {
      name?: string;
      payload?: PersonaInquiryResource;
    };
  };
}

/**
 * Module 70.1 — Pre-Stripe Security & Integration Hardening: replay
 * protection tolerance for the `t=` timestamp in `Persona-Signature`. A
 * signature is cryptographically valid forever (it never expires on its
 * own) — without also bounding how old `t` may be, a captured, genuinely
 * valid webhook body+signature pair could be replayed at any point in the
 * future to re-trigger synchronization. Five minutes matches the
 * tolerance Persona's own documentation recommends and Stripe's
 * webhook-signing guide uses for the same HMAC-with-timestamp pattern.
 */
const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

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

    // Replay protection — a timestamp that isn't a plain integer, or one
    // that falls outside the tolerance window (too old *or* implausibly
    // far in the future, e.g. a clock-skew/forgery attempt), is rejected
    // before the signature is even computed. See
    // `WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS`'s own doc comment.
    if (!/^\d+$/.test(timestamp)) return { valid: false };
    const timestampSeconds = Number(timestamp);
    const nowSeconds = Date.now() / 1000;
    if (Math.abs(nowSeconds - timestampSeconds) > WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS) {
      return { valid: false };
    }

    const expected = createHmac("sha256", this.webhookSecret).update(`${timestamp}.${rawBody}`).digest("hex");

    // `Buffer.from(signature, "hex")` silently drops trailing non-hex
    // characters instead of throwing, which would let a malformed
    // (non-hex) signature header slip past `timingSafeEqual`'s length
    // check with a coincidentally-matching prefix. Reject anything that
    // isn't clean, even-length hex up front, before ever touching
    // `timingSafeEqual`.
    if (!/^[0-9a-f]+$/i.test(signature) || signature.length !== expected.length) {
      return { valid: false };
    }

    const expectedBuffer = Buffer.from(expected, "hex");
    const providedBuffer = Buffer.from(signature, "hex");
    const valid =
      expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);

    if (!valid) return { valid: false };

    try {
      const envelope = JSON.parse(rawBody) as PersonaEventEnvelope;
      const externalEventId = envelope.data?.id;
      const eventType = envelope.data?.attributes?.name;
      const inquiry = envelope.data?.attributes?.payload;
      if (!inquiry) return { valid: true, externalEventId, eventType };
      return {
        valid: true,
        externalEventId,
        eventType,
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
