import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeGetProfessionalVerificationUseCase } from "@/application/use-cases/verification/compose";
import { VERIFICATION_DOCUMENT_TYPE_VALUES } from "@/domain/services/professional-verification-rules";
import { MAX_VERIFICATION_DOCUMENT_BYTES } from "@/application/dto/verification.dto";
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

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("professional.verification");
  return { title: t("metaTitle") };
}

/** Statuses with their own label + explanation in `professional.verification.status.*`. */
const STATUS_KEYS = ["DRAFT", "PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED", "RESUBMISSION_REQUIRED"] as const;
type StatusKey = (typeof STATUS_KEYS)[number];

function isStatusKey(value: string): value is StatusKey {
  return (STATUS_KEYS as readonly string[]).includes(value);
}

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
  const [t, format] = await Promise.all([getTranslations("professional.verification"), getFormatter()]);
  const docTypeLabel = (type: string): string => {
    const key = `documentTypes.${type}`;
    return t.has(key as never) ? t(key as never) : type;
  };

  if (!hasProfessionalProfile) {
    return (
      <PageContainer gap="sm">
        <PageHeader title={t("title")} />
        <p className="text-sm text-foreground/70">
          {t.rich("noProfile", {
            link: (chunks) => (
              <Link href="/dashboard/professional" className="underline">
                {chunks}
              </Link>
            ),
          })}
        </p>
      </PageContainer>
    );
  }

  const status = verification?.status ?? null;
  const canModifyDocs = status === "DRAFT" || status === "RESUBMISSION_REQUIRED";
  const canSubmit = status === "DRAFT";
  const canResubmit = status === "RESUBMISSION_REQUIRED" || status === "REJECTED";
  const statusKey = verification && isStatusKey(verification.status) ? verification.status : null;

  return (
    <PageContainer>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
      />

      {!verification ? (
        <Section bordered gap="lg">
          <p className="text-sm text-foreground/80">{t("notStarted")}</p>
          <form action={requestVerificationFormAction}>
            <Button type="submit">{t("start")}</Button>
          </form>
        </Section>
      ) : (
        <>
          <Section bordered gap="sm">
            <div className="flex items-center gap-3">
              <StatusBadge
                status={verification.status}
                label={statusKey ? t(`status.${statusKey}.label`) : undefined}
              />
              {verification.expiresAt && verification.status === "APPROVED" && (
                <span className="text-xs text-foreground/60">
                  {t("validUntil", { date: format.dateTime(verification.expiresAt, { dateStyle: "medium" }) })}
                </span>
              )}
            </div>
            {statusKey && <p className="text-sm text-foreground/80">{t(`status.${statusKey}.description`)}</p>}

            {verification.status === "REJECTED" && verification.rejectionReason && (
              <Alert variant="danger" title={t("rejectionReasonTitle")}>
                <p className="whitespace-pre-line">{verification.rejectionReason}</p>
              </Alert>
            )}
            {verification.status === "RESUBMISSION_REQUIRED" && verification.resubmissionReason && (
              <Alert variant="warning" title={t("resubmissionReasonTitle")}>
                <p className="whitespace-pre-line">{verification.resubmissionReason}</p>
              </Alert>
            )}
          </Section>

          <Section title={t("documentsTitle")}>
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
                      <p className="font-medium">{docTypeLabel(doc.type)}</p>
                      <p className="truncate text-xs text-foreground/60">{doc.originalFilename}</p>
                    </div>
                    {canModifyDocs && (
                      <form action={removeVerificationDocumentFormAction.bind(null, doc.id)}>
                        <Button type="submit" variant="outline" size="sm">
                          {t("remove")}
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
                <p className="text-sm font-medium">{t("uploadTitle")}</p>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="verification-doc-type">{t("documentType")}</Label>
                  <Select id="verification-doc-type" name="type" required>
                    {VERIFICATION_DOCUMENT_TYPE_VALUES.map((type) => (
                      <option key={type} value={type}>
                        {docTypeLabel(type)}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="verification-doc-file">
                    {t("fileLabel", { maxMb: MAX_VERIFICATION_DOCUMENT_BYTES / (1024 * 1024) })}
                  </Label>
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
                  {t("upload")}
                </Button>
              </form>
            )}
          </Section>

          {(canSubmit || canResubmit) && (
            <section className="flex flex-col gap-2">
              <form action={canSubmit ? submitVerificationFormAction : resubmitVerificationFormAction}>
                <Button type="submit">{canSubmit ? t("submit") : t("resubmit")}</Button>
              </form>
              <p className="text-xs text-foreground/60">
                {t("submitHint")}
              </p>
            </section>
          )}
        </>
      )}
    </PageContainer>
  );
}
