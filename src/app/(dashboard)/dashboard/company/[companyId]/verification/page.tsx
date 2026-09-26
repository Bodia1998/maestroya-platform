import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

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

export async function generateMetadata() {
  const t = await getTranslations("company.verification");
  return { title: t("metaTitle") };
}

const STATUS_KEYS = [
  "DRAFT",
  "PENDING",
  "UNDER_REVIEW",
  "APPROVED",
  "REJECTED",
  "RESUBMISSION_REQUIRED",
  "EXPIRED",
] as const;

const DOC_TYPES = [
  "BUSINESS_LICENSE",
  "TAX_CERTIFICATE",
  "INSURANCE_CERTIFICATE",
  "PROFESSIONAL_CERTIFICATION",
  "PROOF_OF_ADDRESS",
  "OTHER",
] as const;

function isOneOf<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value);
}

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

  const t = await getTranslations("company.verification");
  const verification = await makeGetCompanyVerificationUseCase().execute(user.id, companyId).catch(() => null);

  return (
    <PageContainer gap="sm">
      <CompanyTabNav companyId={companyId} active="verification" />

      <PageHeader
        title={t("title")}
        breadcrumbs={[
          { label: company.tradeName ?? company.legalName, href: `/dashboard/company/${companyId}/profile` },
          { label: t("title") },
        ]}
      />

      {!verification ? (
        <Section bordered gap="lg">
          <p className="text-sm text-foreground/80">{t("notStarted")}</p>
          <form action={requestCompanyVerificationFormAction.bind(null, companyId)}>
            <Button type="submit">{t("start")}</Button>
          </form>
        </Section>
      ) : (
        <>
          <Section bordered gap="sm">
            <div className="flex items-center gap-3">
              <StatusBadge status={verification.status} />
            </div>
            <p className="text-sm text-foreground/80">{isOneOf(STATUS_KEYS, verification.status) ? t(`statusCopy.${verification.status}`) : ""}</p>

            {verification.rejectionReason && (
              <Alert variant="danger" title={t("reason")}>
                <p className="whitespace-pre-line">{verification.rejectionReason}</p>
              </Alert>
            )}
            {verification.resubmissionReason && (
              <Alert variant="warning" title={t("whatToUpdate")}>
                <p className="whitespace-pre-line">{verification.resubmissionReason}</p>
              </Alert>
            )}
          </Section>

          <Section title={t("documents")}>
            {verification.documents.length === 0 ? (
              <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-foreground/70">
                {t("noDocuments")}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {verification.documents.map((doc) => (
                  <li
                    key={doc.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">{isOneOf(DOC_TYPES, doc.type) ? t(`docTypes.${doc.type}`) : doc.type}</p>
                      <p className="truncate text-xs text-foreground/60">{doc.originalFilename}</p>
                    </div>
                    {(verification.status === "DRAFT" || verification.status === "RESUBMISSION_REQUIRED") && (
                      <form action={removeCompanyVerificationDocumentFormAction.bind(null, companyId, doc.id)}>
                        <Button type="submit" variant="outline" size="sm">
                          {t("remove")}
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
                <p className="text-sm font-medium">{t("uploadTitle")}</p>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="company-verification-doc-type">{t("docType")}</Label>
                  <Select id="company-verification-doc-type" name="type">
                    {DOC_TYPES.map((value) => (
                      <option key={value} value={value}>
                        {t(`docTypes.${value}`)}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="company-verification-doc-file">{t("file")}</Label>
                  <input id="company-verification-doc-file" type="file" name="file" required className="text-sm" />
                </div>
                <Button type="submit" variant="outline" className="w-fit">
                  {t("upload")}
                </Button>
              </form>
            )}
          </Section>

          <div className="flex gap-3">
            {verification.status === "DRAFT" && (
              <form action={submitCompanyVerificationFormAction.bind(null, companyId)}>
                <Button type="submit">{t("submit")}</Button>
              </form>
            )}
            {(verification.status === "REJECTED" || verification.status === "RESUBMISSION_REQUIRED") && (
              <form action={resubmitCompanyVerificationFormAction.bind(null, companyId)}>
                <Button type="submit">{t("resubmit")}</Button>
              </form>
            )}
          </div>
        </>
      )}
    </PageContainer>
  );
}
