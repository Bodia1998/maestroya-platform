import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";

import { PageContainer } from "@/components/layout/page-container";
import { Section } from "@/components/layout/section";
import { JsonLd } from "@/components/seo/json-ld";
import { buildBreadcrumbJsonLd } from "@/shared/seo/structured-data";
import { listVerifiedTopLevelServiceCategories } from "@/shared/content/verified-service-category";
import { getServiceContentBySlug } from "@/shared/content/services";
import { toOgLocale } from "@/shared/seo/site";
import {
  localizeCategoryDescription,
  localizeCategoryName,
} from "@/presentation/i18n/service-categories";

/**
 * Module 118 — AI-Readable Service & Location Knowledge.
 *
 * Index of public service pages. Deliberately intersects two sources —
 * the live, ACTIVE, top-level `ServiceCategory` rows (so a category
 * disabled in the database instantly disappears here, no redeploy
 * needed) and this module's curated `SERVICE_CONTENT` catalog (so a
 * category that exists in the database but has no reviewed public copy
 * yet is never linked to before it has real content — see
 * `shared/content/services.ts`'s own doc comment). Only categories
 * present in BOTH are listed.
 *
 * Module 120: title/description follow the visitor's locale; the
 * canonical URL is the same single URL for every language (no per-locale
 * URLs exist, so no hreflang alternates are emitted — see the root
 * layout's `generateMetadata`).
 */
export async function generateMetadata(): Promise<Metadata> {
  const [t, locale] = await Promise.all([getTranslations("seo"), getLocale()]);
  const title = t("servicesIndex.title");
  const description = t("servicesIndex.description");
  return {
    title,
    description,
    alternates: { canonical: "/servicios" },
    openGraph: { title, description, url: "/servicios", locale: toOgLocale(locale) },
    twitter: { title, description },
  };
}

export default async function ServicesIndexPage() {
  const [categories, t] = await Promise.all([
    listVerifiedTopLevelServiceCategories(),
    getTranslations("services"),
  ]);
  const publishable = categories.filter((category) => getServiceContentBySlug(category.slug));

  return (
    <PageContainer maxWidth="3xl" padded>
      <JsonLd
        data={buildBreadcrumbJsonLd([
          { name: t("breadcrumbs.home"), path: "/" },
          { name: t("breadcrumbs.services"), path: "/servicios" },
        ])}
      />

      <div>
        <h1 className="text-2xl font-semibold">{t("index.title")}</h1>
        <p className="mt-1 text-sm text-foreground/70">{t("index.intro")}</p>
      </div>

      {publishable.length > 0 ? (
        <Section gap="sm">
          <ul className="grid gap-3 sm:grid-cols-2">
            {publishable.map((category) => {
              const description = localizeCategoryDescription(t, category);
              return (
                <li key={category.id}>
                  <Link
                    href={`/servicios/${category.slug}`}
                    className="block rounded-md border border-border p-4 text-sm hover:border-primary/40 hover:bg-muted"
                  >
                    <span className="font-medium text-foreground">
                      {localizeCategoryName(t, category)}
                    </span>
                    {description && (
                      <span className="mt-1 block text-foreground/70">{description}</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </Section>
      ) : (
        <p className="text-sm text-foreground/70">{t("index.empty")}</p>
      )}

      <p className="text-sm text-foreground/70">
        {t.rich("index.locationsPrompt", {
          link: (chunks) => (
            <Link href="/ubicaciones" className="underline">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </PageContainer>
  );
}
