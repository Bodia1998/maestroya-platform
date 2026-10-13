import { getTranslations } from "next-intl/server";

import type { ScopeQuestionnaireView } from "@/domain/services/lead-scope-questionnaire";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { PageHeader } from "@/components/dashboard/page-header";
import { makeListLeadRequestCategoriesUseCase } from "@/application/use-cases/lead-request/compose";
import { localizeCategoryName } from "@/presentation/i18n/service-categories";
import { LeadRequestForm } from "./lead-request-form";

function scopeHasLabels(translator: unknown, scope: ScopeQuestionnaireView): boolean {
  const t = translator as { has: (key: string) => boolean };
  return scope.questions.every(
    (q) =>
      t.has(`scopeQuestions.${scope.categorySlug}.${q.id}.label`) &&
      (q.kind === "INTEGER_RANGE" || q.options.every((option) => t.has(`scopeQuestions.${scope.categorySlug}.${q.id}.options.${option}`))),
  );
}

export async function generateMetadata() {
  const t = await getTranslations("customer.requests.leadForm");
  return { title: t("title") };
}

/**
 * Module 142 — customer LEAD_V1 "Request a service". The category list is the
 * backend-authoritative one (Module 132 pilot configuration, via the use case):
 * this page only localizes names for display and never decides support itself.
 */
export default async function NewLeadRequestPage() {
  await requireAuth();

  const [options, t, tList, tServices] = await Promise.all([
    makeListLeadRequestCategoriesUseCase().execute(),
    getTranslations("customer.requests.leadForm"),
    getTranslations("customer.requests"),
    getTranslations("services"),
  ]);
  // Module 163: a questionnaire is offered only when EVERY label it needs is translated; a question without a label is never shown.
  const categories = options.map((category) => ({
    id: category.id,
    name: localizeCategoryName(tServices, category),
    ...(category.scope && scopeHasLabels(t, category.scope) ? { scope: category.scope } : {}),
  }));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        breadcrumbs={[{ label: tList("list.title"), href: "/requests" }, { label: t("title") }]}
      />
      <LeadRequestForm categories={categories} />
    </div>
  );
}
