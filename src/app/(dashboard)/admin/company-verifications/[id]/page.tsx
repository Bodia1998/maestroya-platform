import { notFound } from "next/navigation";

import { makeGetAdminCompanyVerificationUseCase } from "@/application/use-cases/company-verification/compose";
import { NotFoundError } from "@/domain/errors/domain-error";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Section } from "@/components/layout/section";
import { ResponsiveGrid } from "@/components/layout/responsive-grid";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
        actions={<StatusBadge status={detail.status} />}
      />

      <ResponsiveGrid cols="2" gap="md" bordered aria-label="Verification timeline">
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
      </ResponsiveGrid>

      {detail.rejectionReason && (
        <div role="status" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
          <p className="font-medium">Rejection reason</p>
          <p className="whitespace-pre-line">{detail.rejectionReason}</p>
        </div>
      )}
      {detail.resubmissionReason && (
        <div role="status" className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          <p className="font-medium">Resubmission instructions</p>
          <p className="whitespace-pre-line">{detail.resubmissionReason}</p>
        </div>
      )}

      <Section title="Documents">
        {detail.documents.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-foreground/70">
            No documents were uploaded.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {detail.documents.map((doc) => (
              <li
                key={doc.id}
                className="flex flex-col gap-2 rounded-md border border-border px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
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
                  className="shrink-0 self-start rounded-md border border-border px-2 py-1 text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:self-auto"
                >
                  Open<span className="sr-only"> {DOC_TYPE_LABELS[doc.type] ?? doc.type} document (opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Review actions" gap="lg" bordered>
        {isPending && (
          <form action={startCompanyVerificationReviewFormAction.bind(null, detail.id)}>
            <Button type="submit" variant="outline">
              Start review
            </Button>
          </form>
        )}

        {isDecidable ? (
          <>
            <form action={approveCompanyVerificationFormAction.bind(null, detail.id)}>
              <Button type="submit" className="bg-green-600 text-white hover:bg-green-700">
                Approve
              </Button>
            </form>

            <form action={rejectCompanyVerificationFormAction.bind(null, detail.id)} className="flex flex-col gap-2">
              <Label htmlFor="company-verification-reject-reason">Rejection reason (required)</Label>
              <Textarea id="company-verification-reject-reason" name="reason" required minLength={10} maxLength={1000} rows={2} />
              <Button type="submit" variant="danger" className="w-fit">
                Reject
              </Button>
            </form>

            <form
              action={requestCompanyVerificationResubmissionFormAction.bind(null, detail.id)}
              className="flex flex-col gap-2"
            >
              <Label htmlFor="company-verification-resubmission-reason">Resubmission instructions (required)</Label>
              <Textarea id="company-verification-resubmission-reason" name="reason" required minLength={10} maxLength={1000} rows={2} />
              <Button type="submit" variant="outline" className="w-fit">
                Request resubmission
              </Button>
            </form>
          </>
        ) : (
          <p className="text-sm text-foreground/70">
            No review decision is available for a request in the “{detail.status}” state.
          </p>
        )}
      </Section>
    </div>
  );
}
