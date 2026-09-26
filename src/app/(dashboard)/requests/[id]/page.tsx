import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";

import { NotFoundError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeGetServiceRequestUseCase } from "@/application/use-cases/service-request/compose";
import { PageHeader } from "@/components/dashboard/page-header";
import { formatMoney } from "@/components/dashboard/quote-items-table";
import { localizeCategoryName } from "@/presentation/i18n/service-categories";
import { PageContainer } from "@/components/layout/page-container";
import { Section } from "@/components/layout/section";
import { ResponsiveGrid } from "@/components/layout/responsive-grid";
import { ActionBar } from "@/components/layout/action-bar";
import { RequestStatusBadge } from "../request-status-badge";
import { CancelServiceRequestDialog } from "./cancel-service-request-dialog";
import { ServiceRequestPhotoManager } from "./service-request-photo-manager";

export async function generateMetadata() {
  const t = await getTranslations("customer.requests");
  return { title: t("detail.metaTitle") };
}

/**
 * Customer-facing detail page for one of *their own* service requests only
 * — GetServiceRequestUseCase never trusts the `id` route param as proof of
 * ownership, it re-checks against the signed-in session's own
 * CustomerProfile. A request belonging to someone else surfaces as a plain
 * 404, identical to an id that doesn't exist at all, so this page can never
 * be used to probe for another customer's requests.
 */
export default async function ServiceRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireAuth();

  let request;
  try {
    request = await makeGetServiceRequestUseCase().execute(user.id, id);
  } catch (error) {
    if (error instanceof NotFoundError) {
      notFound();
    }
    throw error;
  }

  const isEditable = request.status === "PUBLISHED";
  const [t, tJobs, tServices, format, locale] = await Promise.all([
    getTranslations("customer.requests"),
    getTranslations("jobs"),
    getTranslations("services"),
    getFormatter(),
    getLocale(),
  ]);
  const budgetValue = (value: number | null) =>
    value !== null ? formatMoney(value, "EUR", locale) : t("detail.budgetUnset");

  return (
    <PageContainer>
      <PageHeader
        title={request.title}
        subtitle={localizeCategoryName(tServices, { slug: request.categorySlug, name: request.categoryName })}
        breadcrumbs={[{ label: t("list.title"), href: "/requests" }, { label: request.title }]}
        actions={<RequestStatusBadge status={request.status} />}
      />

      <Section title={t("detail.description")} gap="sm">
        <p className="whitespace-pre-line text-sm text-foreground/80">{request.description}</p>
      </Section>

      <ResponsiveGrid cols="2" gap="md" bordered>
        <div>
          <p className="text-foreground/60">{t("detail.location")}</p>
          <p className="font-medium">
            {request.location.line1}
            {request.location.line2 ? `, ${request.location.line2}` : ""}
          </p>
          <p className="text-foreground/70">
            {request.location.city}
            {request.location.province ? `, ${request.location.province}` : ""}{" "}
            {request.location.postalCode}
          </p>
          <p className="text-foreground/70">{request.location.country}</p>
        </div>
        <div>
          <p className="text-foreground/60">{t("detail.urgency")}</p>
          <p className="font-medium">
            {tJobs.has(`urgency.${request.urgency}` as never) ? tJobs(`urgency.${request.urgency}` as never) : request.urgency}
          </p>
        </div>
        {(request.budgetMin !== null || request.budgetMax !== null) && (
          <div>
            <p className="text-foreground/60">{t("detail.budget")}</p>
            <p className="font-medium">
              {t("detail.budgetRange", { min: budgetValue(request.budgetMin), max: budgetValue(request.budgetMax) })}
            </p>
          </div>
        )}
        <div>
          <p className="text-foreground/60">{t("detail.posted")}</p>
          <p className="font-medium">{format.dateTime(request.createdAt, { dateStyle: "medium", timeStyle: "short" })}</p>
        </div>
        <div>
          <p className="text-foreground/60">{t("detail.lastUpdated")}</p>
          <p className="font-medium">{format.dateTime(request.updatedAt, { dateStyle: "medium", timeStyle: "short" })}</p>
        </div>
      </ResponsiveGrid>

      <Section title={t("detail.photos")}>
        <ServiceRequestPhotoManager
          requestId={request.id}
          photos={request.photos}
          editable={isEditable}
        />
      </Section>

      {request.status === "ACCEPTED" && (
        <section className="rounded-md border border-border bg-black/5 p-4">
          <p className="text-sm">
            {t.rich("detail.acceptedNotice", {
              appointments: (chunks) => (
                <Link href="/appointments" className="font-medium underline">
                  {chunks}
                </Link>
              ),
              jobs: (chunks) => (
                <Link href="/jobs" className="font-medium underline">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </section>
      )}

      {isEditable && (
        <ActionBar>
          <Link
            href={`/requests/${request.id}/edit`}
            className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-transparent px-4 text-sm font-medium hover:bg-black/5"
          >
            {t("detail.editRequest")}
          </Link>
          <CancelServiceRequestDialog requestId={request.id} />
        </ActionBar>
      )}
    </PageContainer>
  );
}
