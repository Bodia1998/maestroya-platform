import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { PageContainer } from "@/components/layout/page-container";
import { Section } from "@/components/layout/section";
import { JsonLd } from "@/components/seo/json-ld";
import {
  buildBreadcrumbJsonLd,
  buildFaqJsonLd,
  buildServiceJsonLd,
} from "@/shared/seo/structured-data";
import {
  findVerifiedTopLevelServiceCategory,
  listVerifiedTopLevelServiceCategories,
} from "@/shared/content/verified-service-category";
import { getServiceContentBySlug, resolveServiceContent } from "@/shared/content/services";
import { LOCATION_CONTENT } from "@/shared/content/locations";
import { JUSTIFIED_SERVICE_LOCATION_PAIRS } from "@/shared/content/service-location-pairs";
import { toOgLocale } from "@/shared/seo/site";
import {
  localizeCategoryDescription,
  localizeCategoryName,
} from "@/presentation/i18n/service-categories";

type ServicePageProps = { params: Promise<{ slug: string }> };

/**
 * Module 118 — AI-Readable Service & Location Knowledge.
 *
 * A public service page only ever exists for a slug that is BOTH a real,
 * ACTIVE, top-level `ServiceCategory` (checked live, every request — see
 * `findVerifiedTopLevelServiceCategory`) AND has reviewed, curated public
 * copy (`services.ts`). Either missing → 404, never a partially-rendered
 * page with a category name but no content, or content for a category
 * that no longer exists/is inactive.
 *
 * Wrapped in `cache()` for the same reason
 * `(marketing)/professionals/[id]/page.tsx` wraps its own lookup —
 * `generateMetadata` and the page component would otherwise run this
 * query twice per request.
 *
 * Module 120: every visible string (and the FAQ/Service JSON-LD built
 * from it) is rendered in the visitor's locale — curated prose from the
 * server-only `knowledge` namespace, page chrome from `services`. The
 * canonical URL is the same for every language.
 */
const getVerifiedService = cache(async (slug: string) => {
  const category = await findVerifiedTopLevelServiceCategory(slug);
  const content = getServiceContentBySlug(slug);
  if (!category || !content) return null;
  return { category, content };
});

export async function generateMetadata({ params }: ServicePageProps): Promise<Metadata> {
  const { slug } = await params;
  const verified = await getVerifiedService(slug);
  if (!verified) return {};

  const { category, content } = verified;
  const [t, tServices, tKnowledge, locale] = await Promise.all([
    getTranslations("seo"),
    getTranslations("services"),
    getTranslations("knowledge"),
    getLocale(),
  ]);
  const title = t("servicePage.title", { service: localizeCategoryName(tServices, category) });
  const description =
    localizeCategoryDescription(tServices, category) ??
    t("servicePage.descriptionFallback", {
      service: resolveServiceContent(content, tKnowledge).nameInSentence,
    });
  const path = `/servicios/${category.slug}`;

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title, description, url: path, locale: toOgLocale(locale) },
    twitter: { title, description },
  };
}

export default async function ServiceCategoryPage({ params }: ServicePageProps) {
  const { slug } = await params;
  const verified = await getVerifiedService(slug);
  if (!verified) {
    notFound();
  }

  const { category } = verified;
  const path = `/servicios/${category.slug}`;

  const [t, tKnowledge, locale, allCategories] = await Promise.all([
    getTranslations("services"),
    getTranslations("knowledge"),
    getLocale(),
    listVerifiedTopLevelServiceCategories(),
  ]);
  const content = resolveServiceContent(verified.content, tKnowledge);
  const serviceName = localizeCategoryName(t, category);
  const serviceDescription = localizeCategoryDescription(t, category);

  const relatedServices = content.relatedServiceSlugs
    .map((relatedSlug) => getServiceContentBySlug(relatedSlug))
    .filter((related): related is NonNullable<typeof related> => Boolean(related));

  const categoryBySlug = new Map(allCategories.map((c) => [c.slug, c]));

  const availableLocations = JUSTIFIED_SERVICE_LOCATION_PAIRS.filter(
    (pair) => pair.serviceSlug === category.slug,
  )
    .map((pair) => LOCATION_CONTENT.find((location) => location.slug === pair.locationSlug))
    .filter((location): location is NonNullable<typeof location> => Boolean(location));

  return (
    <PageContainer maxWidth="3xl" padded>
      <JsonLd
        data={buildServiceJsonLd({
          name: serviceName,
          path,
          description: serviceDescription,
          inLanguage: locale,
        })}
      />
      <JsonLd
        data={buildBreadcrumbJsonLd([
          { name: t("breadcrumbs.home"), path: "/" },
          { name: t("breadcrumbs.services"), path: "/servicios" },
          { name: serviceName, path },
        ])}
      />
      <JsonLd data={buildFaqJsonLd(content.faqs, { inLanguage: locale })} />

      <nav className="text-sm text-foreground/60">
        <Link href="/" className="hover:underline">
          {t("breadcrumbs.home")}
        </Link>{" "}
        /{" "}
        <Link href="/servicios" className="hover:underline">
          {t("breadcrumbs.services")}
        </Link>{" "}
        / <span className="text-foreground">{serviceName}</span>
      </nav>

      <div>
        <h1 className="text-2xl font-semibold">{serviceName}</h1>
        <p className="mt-2 text-sm text-foreground/80">{content.intro}</p>
      </div>

      <Section title={t("servicePage.whatYouCanRequestTitle")} gap="sm">
        <ul className="list-disc pl-5 text-sm text-foreground/80">
          {content.commonJobTypes.map((jobType) => (
            <li key={jobType}>{jobType}</li>
          ))}
        </ul>
      </Section>

      <Section title={t("servicePage.whatProfessionalsProvideTitle")} gap="sm">
        <ul className="list-disc pl-5 text-sm text-foreground/80">
          {content.whatProfessionalsTypicallyProvide.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </Section>

      <Section title={t("servicePage.howItWorksTitle")} gap="sm">
        <ol className="list-decimal pl-5 text-sm text-foreground/80">
          <li>{t("servicePage.howItWorks.step1", { service: content.nameInSentence })}</li>
          <li>{t("servicePage.howItWorks.step2")}</li>
          <li>{t("servicePage.howItWorks.step3")}</li>
          <li>{t("servicePage.howItWorks.step4")}</li>
        </ol>
      </Section>

      {availableLocations.length > 0 && (
        <Section title={t("servicePage.areasTitle")} gap="sm">
          <ul className="flex flex-wrap gap-2">
            {availableLocations.map((location) => (
              <li key={location.slug}>
                <Link
                  href={`/servicios/${category.slug}/${location.slug}`}
                  className="rounded-full border border-border px-3 py-1 text-xs hover:border-primary/40 hover:bg-muted"
                >
                  {t("shared.serviceInCity", { service: serviceName, city: location.cityName })}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={t("servicePage.beforeRequestingTitle")} gap="sm">
        <ul className="list-disc pl-5 text-sm text-foreground/80">
          {content.considerations.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </Section>

      <Section title={t("shared.faqTitle")} gap="sm">
        <dl className="flex flex-col gap-4">
          {content.faqs.map((faq) => (
            <div key={faq.question}>
              <dt className="text-sm font-medium text-foreground">{faq.question}</dt>
              <dd className="mt-1 text-sm text-foreground/80">{faq.answer}</dd>
            </div>
          ))}
        </dl>
      </Section>

      {relatedServices.length > 0 && (
        <Section title={t("servicePage.relatedTitle")} gap="sm">
          <ul className="flex flex-wrap gap-2">
            {relatedServices.map((related) => {
              const relatedCategory = categoryBySlug.get(related.slug);
              return (
                <li key={related.slug}>
                  <Link
                    href={`/servicios/${related.slug}`}
                    className="rounded-full border border-border px-3 py-1 text-xs hover:border-primary/40 hover:bg-muted"
                  >
                    {relatedCategory ? localizeCategoryName(t, relatedCategory) : related.slug}
                  </Link>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      <section className="rounded-md border border-border bg-black/5 p-4">
        <p className="text-sm text-foreground/70">
          {t("servicePage.cta", { service: content.nameInSentence })}
        </p>
        <Link
          href={{ pathname: "/requests/new", query: { categoryId: category.id } }}
          className="mt-3 inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          {t("shared.requestThisService")}
        </Link>
      </section>
    </PageContainer>
  );
}
