import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { NotFoundError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeGetServiceRequestForProfessionalUseCase } from "@/application/use-cases/quotes/compose";
import { PageHeader } from "@/components/dashboard/page-header";
import { Section } from "@/components/layout/section";
import { ResponsiveGrid } from "@/components/layout/responsive-grid";
import { ActionBar } from "@/components/layout/action-bar";
import { getCategoryNameLocalizer } from "../../category-labels";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("professional.requests.detail");
  return { title: t("metaTitle") };
}

/**
 * Professional-facing detail page for a single eligible ServiceRequest.
 * GetServiceRequestForProfessionalUseCase never trusts the `id` route
 * param alone — a request that exists but that this professional isn't
 * eligible to respond to (wrong category, outside their radius, not
 * PUBLISHED, or their own request) surfaces as a plain 404, exactly like
 * an id that doesn't exist at all — see quote-eligibility.ts.
 */
export default async function ProfessionalServiceRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireAuth();

  let request;
  try {
    request = await makeGetServiceRequestForProfessionalUseCase().execute(user.id, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const [t, tRequests, tList, format, categories] = await Promise.all([
    getTranslations("professional.requests.detail"),
    getTranslations("professional.requests"),
    getTranslations("professional.requests.list"),
    getFormatter(),
    getCategoryNameLocalizer(),
  ]);
  const urgencyKey = `urgency.${request.urgency}`;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={request.title}
        subtitle={categories.byId(request.categoryId, request.categoryName)}
        breadcrumbs={[
          { label: tList("title"), href: "/dashboard/professional/requests" },
          { label: request.title },
        ]}
        actions={
          <span className="rounded-full bg-black/5 px-3 py-1 text-xs font-medium text-foreground/70">
            {tRequests("distance", { distance: request.distanceKm })}
          </span>
        }
      />

      <p className="rounded-md bg-black/5 px-4 py-3 text-sm text-foreground/70">
        {t("intro")}
      </p>

      <Section title={t("description")} gap="sm">
        <p className="whitespace-pre-line text-sm text-foreground/80">{request.description}</p>
      </Section>

      {/* Only coarse location (city/province) is ever shown here — the
          customer's exact address is never exposed to a professional who
          hasn't been accepted for the job (see ServiceRequestDiscoveryRepository). */}
      <ResponsiveGrid cols="2" gap="md" bordered>
        <div>
          <p className="text-foreground/60">{t("location")}</p>
          <p className="font-medium">
            {request.city}
            {request.province ? `, ${request.province}` : ""}
          </p>
        </div>
        <div>
          <p className="text-foreground/60">{t("urgency")}</p>
          <p className="font-medium">
            {tRequests.has(urgencyKey as never) ? tRequests(urgencyKey as never) : request.urgency}
          </p>
        </div>
        <div>
          <p className="text-foreground/60">{t("posted")}</p>
          <p className="font-medium">{format.dateTime(request.createdAt, { dateStyle: "medium" })}</p>
        </div>
      </ResponsiveGrid>

      <ActionBar>
        <Link
          href={`/dashboard/professional/requests/${request.id}/quote`}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
        >
          {t("createQuote")}
        </Link>
      </ActionBar>
    </div>
  );
}
