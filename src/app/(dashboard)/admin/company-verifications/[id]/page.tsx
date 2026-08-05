import { notFound } from "next/navigation";

import { makeGetAdminCompanyVerificationUseCase } from "@/application/use-cases/company-verification/compose";
import { NotFoundError } from "@/domain/errors/domain-error";
import { PageHeader } from "@/components/dashboard/page-header";
import {
  approveCompanyVerificationFormAction,
  rejectCompanyVerificationFormAction,
  requestCompanyVerificationResubmissionFormAction,
  startCompanyVerificationReviewFormAction,
} from "../actions";

export const metadata = { title: "Admin — Company verification detail" };

const DOC_TYPE_LABELS: Record<string, string> = {
  BUSINESS_LICENSE: "Business licence",
  TAX_CERTIFICATE: "Tax certificate",
  INSURANCE_CERTIFICATE: "Insurance certificate",
  PROFESSIONAL_CERTIFICATION: "Professional certification",
  PROOF_OF_ADDRESS: "Proof of address",
  NATIONAL_ID: "National ID",
  PASSPORT: "Passport",
  DRIVER_LICENSE: "Driver's licence",
  OTHER: "Other",
};

/** Module 18 — Company Professional: admin company-verification case
 *  detail + review actions — mirrors admin/verifications/[id]/page.tsx. */
export default async function AdminCompanyVerificationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let detail;
  try {
    detail = await makeGetAdminCompanyVerificationUseCase().execute(id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const isPending = detail.status === "PENDING";
  const isDecidable = detail.status === "PENDING" || detail.status === "UNDER_REVIEW";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={detail.companyLegalName}
        subtitle={`Owner: ${detail.ownerName ?? detail.ownerEmail ?? "—"}`}
        breadcrumbs={[
          { label: "Company verifications", href: "/admin/company-verifications" },
          { label: detail.companyLegalName },
        ]}
        actions={<span className="text-sm font-medium">{detail.status}</span>}
      />

      <section className="grid grid-cols-2 gap-4 rounded-md border border-border p-4 text-sm">
        <div>
          <p className="text-foreground/60">Submitted</p>
          <p className="font-medium">{detail.submittedAt ? detail.submittedAt.toLocaleString() : "—"}</p>
        </div>
        <div>
          <p className="text-foreground/60">Reviewed</p>
          <p className="font-medium">{detail.reviewedAt ? detail.reviewedAt.toLocaleString() : "—"}</p>
        </div>
        <div>
          <p className="text-foreground/60">Expires</p>
          <p className="font-medium">{detail.expiresAt ? detail.expiresAt.toLocaleDateString() : "—"}</p>
        </div>
      </section>

      {detail.rejectionReason && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-800">
          <p className="font-medium">Rejection reason</p>
          <p className="whitespace-pre-line">{detail.rejectionReason}</p>
        </div>
      )}
      {detail.resubmissionReason && (
        <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          <p className="font-medium">Resubmission instructions</p>
          <p className="whitespace-pre-line">{detail.resubmissionReason}</p>
        </div>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Documents</h2>
        {detail.documents.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-foreground/70">
            No documents were uploaded.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {detail.documents.map((doc) => (
              <li
                key={doc.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium">{DOC_TYPE_LABELS[doc.type] ?? doc.type}</p>
                  <p className="truncate text-xs text-foreground/60">
                    {doc.originalFilename} · {(doc.fileSizeBytes / 1024).toFixed(0)} KB
                  </p>
                </div>
                <a
                  href={doc.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md border border-border px-2 py-1 text-xs"
                >
                  Open
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-4 rounded-md border border-border p-4">
        <h2 className="text-lg font-medium">Review actions</h2>

        {isPending && (
          <form action={startCompanyVerificationReviewFormAction.bind(null, detail.id)}>
            <button type="submit" className="h-10 rounded-md border border-border px-4 text-sm">
              Start review
            </button>
          </form>
        )}

        {isDecidable ? (
          <>
            <form action={approveCompanyVerificationFormAction.bind(null, detail.id)}>
              <button type="submit" className="h-10 rounded-md bg-green-600 px-4 text-sm font-medium text-white">
                Approve
              </button>
            </form>

            <form action={rejectCompanyVerificationFormAction.bind(null, detail.id)} className="flex flex-col gap-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-foreground/70">Rejection reason (required)</span>
                <textarea name="reason" required minLength={10} maxLength={1000} rows={2} className="rounded-md border border-border p-2 text-sm" />
              </label>
              <button type="submit" className="h-10 w-fit rounded-md bg-red-600 px-4 text-sm font-medium text-white">
                Reject
              </button>
            </form>

            <form
              action={requestCompanyVerificationResubmissionFormAction.bind(null, detail.id)}
              className="flex flex-col gap-2"
            >
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-foreground/70">Resubmission instructions (required)</span>
                <textarea name="reason" required minLength={10} maxLength={1000} rows={2} className="rounded-md border border-border p-2 text-sm" />
              </label>
              <button type="submit" className="h-10 w-fit rounded-md border border-border px-4 text-sm">
                Request resubmission
              </button>
            </form>
          </>
        ) : (
          <p className="text-sm text-foreground/70">
            No review decision is available for a request in the “{detail.status}” state.
          </p>
        )}
      </section>
    </div>
  );
}
