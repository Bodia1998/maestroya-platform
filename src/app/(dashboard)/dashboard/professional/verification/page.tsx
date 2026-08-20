import Link from "next/link";

import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeGetProfessionalVerificationUseCase } from "@/application/use-cases/verification/compose";
import { VERIFICATION_DOCUMENT_TYPE_VALUES } from "@/domain/services/professional-verification-rules";
import { PageHeader } from "@/components/dashboard/page-header";
import { PageContainer } from "@/components/layout/page-container";
import { Section } from "@/components/layout/section";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  removeVerificationDocumentFormAction,
  requestVerificationFormAction,
  resubmitVerificationFormAction,
  submitVerificationFormAction,
  uploadVerificationDocumentFormAction,
} from "./actions";

export const metadata = { title: "Professional verification" };

const STATUS_COPY: Record<string, { label: string; description: string }> = {
  DRAFT: {
    label: "Not submitted",
    description:
      "Upload at least one identity document (national ID, passport or driver's licence) and any supporting documents, then submit for review.",
  },
  PENDING: {
    label: "Pending review",
    description: "Your request is in the review queue. We'll let you know once a reviewer has looked at it.",
  },
  UNDER_REVIEW: {
    label: "Under review",
    description: "A reviewer is currently checking your documents. No action is needed from you right now.",
  },
  APPROVED: {
    label: "Approved",
    description: "You are a verified professional. A verified badge appears on your public profile.",
  },
  REJECTED: {
    label: "Rejected",
    description: "Your request was not approved. See the reason below — you can address it and resubmit.",
  },
  RESUBMISSION_REQUIRED: {
    label: "Resubmission required",
    description: "A reviewer needs you to update your request. Follow the instructions below, then resubmit.",
  },
};

const DOC_TYPE_LABELS: Record<string, string> = {
  NATIONAL_ID: "National ID",
  PASSPORT: "Passport",
  DRIVER_LICENSE: "Driver's licence",
  BUSINESS_LICENSE: "Business licence",
  TAX_CERTIFICATE: "Tax certificate",
  INSURANCE_CERTIFICATE: "Insurance certificate",
  PROFESSIONAL_CERTIFICATION: "Professional certification",
  PROOF_OF_ADDRESS: "Proof of address",
  BUSINESS_REGISTRATION: "Business registration",
  OTHER: "Other",
};

/**
 * Professional Verification module (Module 17): the professional's own
 * verification page. Never renders sensitive internal data — the reviewer's
 * identity is never shown; only the professional-facing reason/instructions
 * (rejectionReason / resubmissionReason) are. Document links here are the
 * owner's own uploads.
 */
export default async function ProfessionalVerificationPage() {
  const user = await requireAuth();
  const { hasProfessionalProfile, verification } = await makeGetProfessionalVerificationUseCase().execute(user.id);

  if (!hasProfessionalProfile) {
    return (
      <PageContainer gap="sm">
        <PageHeader title="Verification" />
        <p className="text-sm text-foreground/70">
          You need a professional profile before you can request verification.{" "}
          <Link href="/dashboard/professional" className="underline">
            Create your professional profile
          </Link>
          .
        </p>
      </PageContainer>
    );
  }

  const status = verification?.status ?? null;
  const canModifyDocs = status === "DRAFT" || status === "RESUBMISSION_REQUIRED";
  const canSubmit = status === "DRAFT";
  const canResubmit = status === "RESUBMISSION_REQUIRED" || status === "REJECTED";

  return (
    <PageContainer>
      <PageHeader
        title="Verification"
        subtitle="Verify your identity to earn a “Verified professional” badge on your public profile."
      />

      {!verification ? (
        <Section bordered gap="lg">
          <p className="text-sm text-foreground/80">You have not started a verification request yet.</p>
          <form action={requestVerificationFormAction}>
            <Button type="submit">Start verification</Button>
          </form>
        </Section>
      ) : (
        <>
          <Section bordered gap="sm">
            <div className="flex items-center gap-3">
              <StatusBadge status={verification.status} label={STATUS_COPY[verification.status]?.label} />
              {verification.expiresAt && verification.status === "APPROVED" && (
                <span className="text-xs text-foreground/60">
                  Valid until {verification.expiresAt.toLocaleDateString()}
                </span>
              )}
            </div>
            <p className="text-sm text-foreground/80">{STATUS_COPY[verification.status]?.description}</p>

            {verification.status === "REJECTED" && verification.rejectionReason && (
              <Alert variant="danger" title="Reason">
                <p className="whitespace-pre-line">{verification.rejectionReason}</p>
              </Alert>
            )}
            {verification.status === "RESUBMISSION_REQUIRED" && verification.resubmissionReason && (
              <Alert variant="warning" title="What to update">
                <p className="whitespace-pre-line">{verification.resubmissionReason}</p>
              </Alert>
            )}
          </Section>

          <Section title="Documents">
            {verification.documents.length === 0 ? (
              <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-foreground/70">
                No documents uploaded yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {verification.documents.map((doc) => (
                  <li
                    key={doc.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">{DOC_TYPE_LABELS[doc.type] ?? doc.type}</p>
                      <p className="truncate text-xs text-foreground/60">{doc.originalFilename}</p>
                    </div>
                    {canModifyDocs && (
                      <form action={removeVerificationDocumentFormAction.bind(null, doc.id)}>
                        <Button type="submit" variant="outline" size="sm">
                          Remove
                        </Button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {canModifyDocs && (
              <form
                action={uploadVerificationDocumentFormAction}
                className="flex flex-col gap-3 rounded-md border border-border p-4"
              >
                <p className="text-sm font-medium">Upload a document</p>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="verification-doc-type">Document type</Label>
                  <Select id="verification-doc-type" name="type" required>
                    {VERIFICATION_DOCUMENT_TYPE_VALUES.map((t) => (
                      <option key={t} value={t}>
                        {DOC_TYPE_LABELS[t] ?? t}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="verification-doc-file">File (JPEG, PNG, WebP or PDF, max 10MB)</Label>
                  <input
                    id="verification-doc-file"
                    type="file"
                    name="file"
                    required
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    className="text-sm"
                  />
                </div>
                <Button type="submit" variant="outline" className="w-fit">
                  Upload
                </Button>
              </form>
            )}
          </Section>

          {(canSubmit || canResubmit) && (
            <section className="flex flex-col gap-2">
              <form action={canSubmit ? submitVerificationFormAction : resubmitVerificationFormAction}>
                <Button type="submit">{canSubmit ? "Submit for review" : "Resubmit for review"}</Button>
              </form>
              <p className="text-xs text-foreground/60">
                You must have at least one identity document uploaded before submitting.
              </p>
            </section>
          )}
        </>
      )}
    </PageContainer>
  );
}
