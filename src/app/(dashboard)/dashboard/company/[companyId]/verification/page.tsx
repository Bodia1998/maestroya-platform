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
import { PageContainer } from "@/components/layout/page-container";
import { Section } from "@/components/layout/section";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { CompanyTabNav } from "../company-tab-nav";

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

const DOC_TYPE_LABELS: Record<string, string> = {
  BUSINESS_LICENSE: "Business licence",
  TAX_CERTIFICATE: "Tax certificate",
  INSURANCE_CERTIFICATE: "Insurance certificate",
  PROFESSIONAL_CERTIFICATION: "Professional certification",
  PROOF_OF_ADDRESS: "Proof of address",
  OTHER: "Other",
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
    <PageContainer gap="sm">
      <CompanyTabNav companyId={companyId} active="verification" />

      <PageHeader
        title="Verification"
        breadcrumbs={[
          { label: company.tradeName ?? company.legalName, href: `/dashboard/company/${companyId}/profile` },
          { label: "Verification" },
        ]}
      />

      {!verification ? (
        <Section bordered gap="lg">
          <p className="text-sm text-foreground/80">This company has not started verification yet.</p>
          <form action={requestCompanyVerificationFormAction.bind(null, companyId)}>
            <Button type="submit">Start verification</Button>
          </form>
        </Section>
      ) : (
        <>
          <Section bordered gap="sm">
            <div className="flex items-center gap-3">
              <StatusBadge status={verification.status} />
            </div>
            <p className="text-sm text-foreground/80">{STATUS_COPY[verification.status] ?? ""}</p>

            {verification.rejectionReason && (
              <Alert variant="danger" title="Reason">
                <p className="whitespace-pre-line">{verification.rejectionReason}</p>
              </Alert>
            )}
            {verification.resubmissionReason && (
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
                    {(verification.status === "DRAFT" || verification.status === "RESUBMISSION_REQUIRED") && (
                      <form action={removeCompanyVerificationDocumentFormAction.bind(null, companyId, doc.id)}>
                        <Button type="submit" variant="outline" size="sm">
                          Remove
                        </Button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {(verification.status === "DRAFT" || verification.status === "RESUBMISSION_REQUIRED") && (
              <form
                action={uploadCompanyVerificationDocumentFormAction.bind(null, companyId)}
                encType="multipart/form-data"
                className="flex flex-col gap-3 rounded-md border border-border p-4"
              >
                <p className="text-sm font-medium">Upload a document</p>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="company-verification-doc-type">Document type</Label>
                  <Select id="company-verification-doc-type" name="type">
                    {Object.entries(DOC_TYPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="company-verification-doc-file">File</Label>
                  <input id="company-verification-doc-file" type="file" name="file" required className="text-sm" />
                </div>
                <Button type="submit" variant="outline" className="w-fit">
                  Upload document
                </Button>
              </form>
            )}
          </Section>

          <div className="flex gap-3">
            {verification.status === "DRAFT" && (
              <form action={submitCompanyVerificationFormAction.bind(null, companyId)}>
                <Button type="submit">Submit for review</Button>
              </form>
            )}
            {(verification.status === "REJECTED" || verification.status === "RESUBMISSION_REQUIRED") && (
              <form action={resubmitCompanyVerificationFormAction.bind(null, companyId)}>
                <Button type="submit">Resubmit</Button>
              </form>
            )}
          </div>
        </>
      )}
    </PageContainer>
  );
}
