import { notFound } from "next/navigation";

import {
  removeCompanyVerificationDocumentFormAction,
  requestCompanyVerificationFormAction,
  resubmitCompanyVerificationFormAction,
  submitCompanyVerificationFormAction,
  uploadCompanyVerificationDocumentFormAction,
} from "@/app/(dashboard)/dashboard/company/[companyId]/verification/actions";
import { makeGetCompanyForMemberUseCase } from "@/application/use-cases/company/compose";
import { makeGetCompanyVerificationUseCase } from "@/application/use-cases/company-verification/compose";
import { NotFoundError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { PageHeader } from "@/components/dashboard/page-header";
import { Section } from "@/components/layout/section";

export const metadata = { title: "Company verification" };

const STATUS_COPY: Record<string, string> = {
  DRAFT: "Not yet submitted. Upload at least one business document and submit for review.",
  PENDING: "Submitted — waiting for an admin to review.",
  UNDER_REVIEW: "An admin is currently reviewing this request.",
  APPROVED: "Approved — your company shows a verified badge on its public profile.",
  REJECTED: "Rejected. See the reason below and resubmit when ready.",
  RESUBMISSION_REQUIRED: "Changes are required before this can be approved. See the instructions below.",
  EXPIRED: "This approval has expired. Start a new verification request.",
};

/** Module 18 — Company Professional: company verification dashboard —
 *  mirrors dashboard/professional/verification/page.tsx (Module 17).
 *  OWNER/ADMIN only — enforced server-side by every use case, this page
 *  itself just doesn't hide anything from other roles (same defense-in-
 *  depth note as the profile page). */
export default async function CompanyVerificationPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const user = await requireAuth();

  let company;
  try {
    company = await makeGetCompanyForMemberUseCase().execute(user.id, companyId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const verification = await makeGetCompanyVerificationUseCase().execute(user.id, companyId).catch(() => null);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Verification"
        breadcrumbs={[
          { label: company.tradeName ?? company.legalName, href: `/dashboard/company/${companyId}/profile` },
          { label: "Verification" },
        ]}
      />

      {!verification ? (
        <form action={requestCompanyVerificationFormAction.bind(null, companyId)}>
          <p className="text-sm text-foreground/70">This company has not started verification yet.</p>
          <button type="submit" className="mt-3 h-10 rounded-md bg-black px-4 text-sm font-medium text-white">
            Start verification
          </button>
        </form>
      ) : (
        <>
          <p className="rounded-md border border-border p-3 text-sm">
            Status: <span className="font-medium">{verification.status}</span> —{" "}
            {STATUS_COPY[verification.status] ?? ""}
          </p>

          {verification.rejectionReason && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-800">{verification.rejectionReason}</div>
          )}
          {verification.resubmissionReason && (
            <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">{verification.resubmissionReason}</div>
          )}

          <Section title="Documents">
            <ul className="flex flex-col gap-2">
              {verification.documents.map((doc) => (
                <li key={doc.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                  <span>{doc.type} — {doc.originalFilename}</span>
                  {(verification.status === "DRAFT" || verification.status === "RESUBMISSION_REQUIRED") && (
                    <form action={removeCompanyVerificationDocumentFormAction.bind(null, companyId, doc.id)}>
                      <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs">
                        Remove
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>

            {(verification.status === "DRAFT" || verification.status === "RESUBMISSION_REQUIRED") && (
              <form
                action={uploadCompanyVerificationDocumentFormAction.bind(null, companyId)}
                encType="multipart/form-data"
                className="flex flex-col gap-2"
              >
                <select name="type" className="rounded-md border border-border p-2 text-sm">
                  <option value="BUSINESS_LICENSE">Business licence</option>
                  <option value="TAX_CERTIFICATE">Tax certificate</option>
                  <option value="INSURANCE_CERTIFICATE">Insurance certificate</option>
                  <option value="PROFESSIONAL_CERTIFICATION">Professional certification</option>
                  <option value="PROOF_OF_ADDRESS">Proof of address</option>
                  <option value="OTHER">Other</option>
                </select>
                <input type="file" name="file" required className="text-sm" />
                <button type="submit" className="h-10 w-fit rounded-md border border-border px-4 text-sm">
                  Upload document
                </button>
              </form>
            )}
          </Section>

          <div className="flex gap-3">
            {verification.status === "DRAFT" && (
              <form action={submitCompanyVerificationFormAction.bind(null, companyId)}>
                <button type="submit" className="h-10 rounded-md bg-black px-4 text-sm font-medium text-white">
                  Submit for review
                </button>
              </form>
            )}
            {(verification.status === "REJECTED" || verification.status === "RESUBMISSION_REQUIRED") && (
              <form action={resubmitCompanyVerificationFormAction.bind(null, companyId)}>
                <button type="submit" className="h-10 rounded-md bg-black px-4 text-sm font-medium text-white">
                  Resubmit
                </button>
              </form>
            )}
          </div>
        </>
      )}
    </div>
  );
}
