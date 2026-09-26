import { FileText } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeGetCustomerServiceRequestsUseCase } from "@/application/use-cases/service-request/compose";
import { PageHeader } from "@/components/dashboard/page-header";
import { RequestCard } from "@/components/dashboard/cards/request-card";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState } from "@/components/ui/empty-state";
import { PageContainer } from "@/components/layout/page-container";
import { localizeCategoryName } from "@/presentation/i18n/service-categories";

export async function generateMetadata() {
  const t = await getTranslations("customer.requests");
  return { title: t("list.title") };
}

export default async function ServiceRequestsPage() {
  const user = await requireAuth();
  // Never trust a client-supplied id here — requests are always looked up
  // for the authenticated session's own userId, exactly like the
  // Professional dashboard looks up "my professional profile".
  const [requests, t, tServices] = await Promise.all([
    makeGetCustomerServiceRequestsUseCase().execute(user.id),
    getTranslations("customer.requests"),
    getTranslations("services"),
  ]);

  return (
    <PageContainer maxWidth="3xl" gap="sm">
      <PageHeader
        title={t("list.title")}
        subtitle={t("list.subtitle")}
        actions={<ButtonLink href="/requests/new">{t("list.newRequest")}</ButtonLink>}
      />

      {requests.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={t("list.empty.title")}
          description={t("list.empty.description")}
          action={<ButtonLink href="/requests/new">{t("list.newRequest")}</ButtonLink>}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {requests.map((request) => (
            <li key={request.id}>
              <RequestCard
                href={`/requests/${request.id}`}
                title={request.title}
                status={request.status}
                categoryName={localizeCategoryName(tServices, { slug: request.categorySlug, name: request.categoryName })}
                city={request.location.city}
                createdAt={request.createdAt}
                updatedAt={request.updatedAt}
              />
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}
