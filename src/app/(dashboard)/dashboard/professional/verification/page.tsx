import Link from "next/link";

import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeGetProfessionalVerificationUseCase } from "@/application/use-cases/verification/compose";
import { VERIFICATION_DOCUMENT_TYPE_VALUES } from "@/domain/services/professional-verification-rules";
import {
  removeVerificationDocumentFormAction,
  requestVerificationFormAction,
  resubmitVerificationFormAction,
  submitVerificationFormAction,
  uploadVerificationDocumentFormAction,
} from "./actions";

export const metadata = { title: "Professional verification" };

const STATUS_COPY: Record<string, { label: string; badge: string; description: string }> = {
  DRAFT: {
    label: "Not submitted",
    badge: "bg-black/5 text-foreground/70",
    description:
      "Upload at least one identity document (national ID, passport or driver's licence) and any supporting documents, then submit for review.",
  },
  PENDING: {
    label: "Pending review",
    badge: "bg-amber-50 text-amber-700",
    description: "Your request is in the review queue. We'll let you know once a reviewer has looked at it.",
  },
  UNDER_REVIEW: {
    label: "Under review",
    badge: "bg-blue-50 text-blue-700",
    description: "A reviewer is currently checking your documents. No action is needed from you right now.",
  },
  APPROVED: {
    label: "Approved",
    badge: "bg-green-50 text-green-700",
    description: "You are a verified professional. A verified badge appears on your public profile.",
  },
  REJECTED: {
    label: "Rejected",
    badge: "bg-red-50 text-red-700",
    description: "Your request was not approved. See the reason below — you can address it and resubmit.",
  },
  RESUBMISSION_REQUIRED: {
    label: "Resubmission required",
    badge: "bg-amber-50 text-amber-700",
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
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-10">
        <h1 className="text-2xl font-semibold">Verification</h1>
        <p className="text-sm text-foreground/70">
          You need a professional profile before you can request verification.{" "}
          <Link href="/dashboard/professional" className="underline">
            Create your professional profile
          </Link>
          .
        </p>
      </div>
    );
  }

  const status = verification?.status ?? null;
  const canModifyDocs = status === "DRAFT" || status === "RESUBMISSION_REQUIRED";
  const canSubmit = status === "DRAFT";
  const canResubmit = status === "RESUBMISSION_REQUIRED" || status === "REJECTED";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold">Verification</h1>
        <p className="mt-1 text-sm text-foreground/70">
          Verify your identity to earn a “Verified professional” badge on your public profile.
        </p>
      </div>

      {!verification ? (
        <section className="flex flex-col gap-4 rounded-md border border-border p-5">
          <p className="text-sm text-foreground/80">You have not started a verification request yet.</p>
          <form action={requestVerificationFormAction}>
            <button type="submit" className="h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background">
              Start verification
            </button>
          </form>
        </section>
      ) : (
        <>
          <section className="flex flex-col gap-3 rounded-md border border-border p-5">
            <div className="flex items-center gap-3">
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_COPY[verification.status]?.badge ?? "bg-black/5"}`}
              >
                {STATUS_COPY[verification.status]?.label ?? verification.status}
              </span>
              {verification.expiresAt && verification.status === "APPROVED" && (
                <span className="text-xs text-foreground/60">
                  Valid until {verification.expiresAt.toLocaleDateString()}
                </span>
              )}
            </div>
            <p className="text-sm text-foreground/80">{STATUS_COPY[verification.status]?.description}</p>

            {verification.status === "REJECTED" && verification.rejectionReason && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-800">
                <p className="font-medium">Reason</p>
                <p className="whitespace-pre-line">{verification.rejectionReason}</p>
              </div>
            )}
            {verification.status === "RESUBMISSION_REQUIRED" && verification.resubmissionReason && (
              <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
                <p className="font-medium">What to update</p>
                <p className="whitespace-pre-line">{verification.resubmissionReason}</p>
              </div>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-medium">Documents</h2>
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
                        <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs">
                          Remove
                        </button>
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
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-foreground/70">Document type</span>
                  <select name="type" required className="h-10 rounded-md border border-border px-2 text-sm">
                    {VERIFICATION_DOCUMENT_TYPE_VALUES.map((t) => (
                      <option key={t} value={t}>
                        {DOC_TYPE_LABELS[t] ?? t}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-foreground/70">File (JPEG, PNG, WebP or PDF, max 10MB)</span>
                  <input
                    type="file"
                    name="file"
                    required
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    className="text-sm"
                  />
                </label>
                <button type="submit" className="h-10 w-fit rounded-md border border-border px-4 text-sm">
                  Upload
                </button>
              </form>
            )}
          </section>

          {(canSubmit || canResubmit) && (
            <section className="flex flex-col gap-2">
              <form action={canSubmit ? submitVerificationFormAction : resubmitVerificationFormAction}>
                <button
                  type="submit"
                  className="h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background"
                >
                  {canSubmit ? "Submit for review" : "Resubmit for review"}
                </button>
              </form>
              <p className="text-xs text-foreground/60">
                You must have at least one identity document uploaded before submitting.
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
