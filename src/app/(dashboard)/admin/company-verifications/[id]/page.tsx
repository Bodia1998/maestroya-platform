import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

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
import { getStatusLabeler } from "../../_lib/status-label";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return { title: t("common.metaTitle", { page: t("companyVerifications.detail.metaTitle") }) };
}

const DOCUMENT_TYPES = [
  "NATIONAL_ID",
  "PASSPORT",
  "DRIVER_LICENSE",
  "BUSINESS_LICENSE",
  "TAX_CERTIFICATE",
  "INSURANCE_CERTIFICATE",
  "PROFESSIONAL_CERTIFICATION",
  "PROOF_OF_ADDRESS",
  "BUSINESS_REGISTRATION",
  "OTHER",
] as const;
const DOCUMENT_TYPE_SET = new Set<string>(DOCUMENT_TYPES);

/** Module 18 — Company Professional: admin company-verification case
 *  detail + review actions — mirrors admin/verifications/[id]/page.tsx.
 *
 *  Module 106 — Secure Cloudinary Document Delivery: document links point
 *  at the authenticated `/api/documents/company-verification/[documentId]`
 *  proxy, never at `doc.fileUrl` directly — see that route's own doc
 *  comment. */
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
  const t = await getTranslations("admin");
  const format = await getFormatter();
  const statusLabel = await getStatusLabeler();
  const srOnly = (chunks: React.ReactNode) => <span className="sr-only">{chunks}</span>;
  const docTypeLabel = (type: string) =>
    DOCUMENT_TYPE_SET.has(type) ? t(`documentTypes.${type as (typeof DOCUMENT_TYPES)[number]}`) : type;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={detail.companyLegalName}
        subtitle={t("companyVerifications.detail.owner", { name: detail.ownerName ?? detail.ownerEmail ?? "—" })}
        breadcrumbs={[
          { label: t("companyVerifications.title"), href: "/admin/company-verifications" },
          { label: detail.companyLegalName },
        ]}
        actions={<StatusBadge status={detail.status} />}
      />

      <ResponsiveGrid cols="2" gap="md" bordered aria-label={t("verificationReview.timeline")}>
        <div>
          <p className="text-foreground/60">{t("verificationReview.submitted")}</p>
          <p className="font-medium">{detail.submittedAt ? format.dateTime(detail.submittedAt, { dateStyle: "medium", timeStyle: "short" }) : "—"}</p>
        </div>
        <div>
          <p className="text-foreground/60">{t("verificationReview.reviewed")}</p>
          <p className="font-medium">{detail.reviewedAt ? format.dateTime(detail.reviewedAt, { dateStyle: "medium", timeStyle: "short" }) : "—"}</p>
        </div>
        <div>
          <p className="text-foreground/60">{t("verificationReview.expires")}</p>
          <p className="font-medium">{detail.expiresAt ? format.dateTime(detail.expiresAt, { dateStyle: "medium" }) : "—"}</p>
        </div>
      </ResponsiveGrid>

      {detail.rejectionReason && (
        <div role="status" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
          <p className="font-medium">{t("verificationReview.rejectionReason")}</p>
          <p className="whitespace-pre-line">{detail.rejectionReason}</p>
        </div>
      )}
      {detail.resubmissionReason && (
        <div role="status" className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          <p className="font-medium">{t("verificationReview.resubmissionInstructions")}</p>
          <p className="whitespace-pre-line">{detail.resubmissionReason}</p>
        </div>
      )}

      <Section title={t("verificationReview.documents")}>
        {detail.documents.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-foreground/70">
            {t("verificationReview.noDocuments")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {detail.documents.map((doc) => (
              <li
                key={doc.id}
                className="flex flex-col gap-2 rounded-md border border-border px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-medium">{docTypeLabel(doc.type)}</p>
                  <p className="truncate text-xs text-foreground/60">
                    {doc.originalFilename} ·{" "}
                    {t("verificationReview.fileSize", {
                      size: format.number(Math.round(doc.fileSizeBytes / 1024), { maximumFractionDigits: 0 }),
                    })}
                  </p>
                </div>
                <a
                  href={`/api/documents/company-verification/${doc.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 self-start rounded-md border border-border px-2 py-1 text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:self-auto"
                >
                  {t.rich("verificationReview.openDocument", { type: docTypeLabel(doc.type), sr: srOnly })}
                </a>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t("verificationReview.reviewActions")} gap="lg" bordered>
        {isPending && (
          <form action={startCompanyVerificationReviewFormAction.bind(null, detail.id)}>
            <Button type="submit" variant="outline">
              {t("verificationReview.startReview")}
            </Button>
          </form>
        )}

        {isDecidable ? (
          <>
            <form action={approveCompanyVerificationFormAction.bind(null, detail.id)}>
              <Button type="submit" className="bg-green-600 text-white hover:bg-green-700">
                {t("verificationReview.approve")}
              </Button>
            </form>

            <form action={rejectCompanyVerificationFormAction.bind(null, detail.id)} className="flex flex-col gap-2">
              <Label htmlFor="company-verification-reject-reason">{t("verificationReview.rejectReasonLabel")}</Label>
              <Textarea id="company-verification-reject-reason" name="reason" required minLength={10} maxLength={1000} rows={2} />
              <Button type="submit" variant="danger" className="w-fit">
                {t("verificationReview.reject")}
              </Button>
            </form>

            <form
              action={requestCompanyVerificationResubmissionFormAction.bind(null, detail.id)}
              className="flex flex-col gap-2"
            >
              <Label htmlFor="company-verification-resubmission-reason">{t("verificationReview.resubmissionLabel")}</Label>
              <Textarea id="company-verification-resubmission-reason" name="reason" required minLength={10} maxLength={1000} rows={2} />
              <Button type="submit" variant="outline" className="w-fit">
                {t("verificationReview.requestResubmission")}
              </Button>
            </form>
          </>
        ) : (
          <p className="text-sm text-foreground/70">
            {t("verificationReview.noDecision", { status: statusLabel(detail.status) })}
          </p>
        )}
      </Section>
    </div>
  );
}
