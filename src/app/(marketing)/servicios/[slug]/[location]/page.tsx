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
import { findVerifiedTopLevelServiceCategory } from "@/shared/content/verified-service-category";
import { getServiceContentBySlug, resolveServiceContent } from "@/shared/content/services";
import { findVerifiedCity } from "@/shared/content/verified-location";
import { getLocationContentBySlug } from "@/shared/content/locations";
import { isJustifiedServiceLocationPair } from "@/shared/content/service-location-pairs";
import { toOgLocale } from "@/shared/seo/site";
import {
  localizeCategoryDescription,
  localizeCategoryName,
} from "@/presentation/i18n/service-categories";

type ServiceLocationPageProps = { params: Promise<{ slug: string; location: string }> };

/**
 * Module 118 — AI-Readable Service & Location Knowledge — Phase 5.
 *
 * The most tightly guarded page in this module: renders only when ALL of
 * the following hold, checked live on every request:
 *  1. `slug` is a real, ACTIVE, top-level `ServiceCategory`.
 *  2. `location` is a real `City` (with its `Province`/`Country`).
 *  3. This exact (service, location) pair was deliberately reviewed and
 *     listed in `JUSTIFIED_SERVICE_LOCATION_PAIRS` (see that file's own
 *     doc comment) — the existence of both a valid service and a valid
 *     location does NOT, by itself, justify a combined page (Phase 5's
 *     explicit "do not auto-generate the full cross-product" rule).
 *
 * Any of the three failing → 404. This is what keeps this route from
 * ever becoming a doorway-page generator: adding a new city later does
 * NOT automatically create six new pages, because step 3 still requires
 * a deliberate addition to the pairs list.
 *
 * Module 120: rendered in the visitor's locale (curated prose from the
 * server-only `knowledge` namespace, chrome from `services`); city and
 * province names are proper nouns and never translated.
 */
const getVerifiedPair = cache(async (serviceSlug: string, locationSlug: string) => {
  if (!isJustifiedServiceLocationPair(serviceSlug, locationSlug)) return null;

  const serviceContent = getServiceContentBySlug(serviceSlug);
  const locationContent = getLocationContentBySlug(locationSlug);
  if (!serviceContent || !locationContent) return null;

  const [category, city] = await Promise.all([
    findVerifiedTopLevelServiceCategory(serviceSlug),
    findVerifiedCity(
      locationContent.cityName,
      locationContent.provinceName,
      locationContent.countryCode,
    ),
  ]);
  if (!category || !city) return null;

  return { category, city, serviceContent, locationContent };
});

export async function generateMetadata({ params }: ServiceLocationPageProps): Promise<Metadata> {
  const { slug, location } = await params;
  const verified = await getVerifiedPair(slug, location);
  if (!verified) return {};

  const { category, locationContent, serviceContent } = verified;
  const [t, tServices, tKnowledge, locale] = await Promise.all([
    getTranslations("seo"),
    getTranslations("services"),
    getTranslations("knowledge"),
    getLocale(),
  ]);
  const title = t("serviceLocationPage.title", {
    service: localizeCategoryName(tServices, category),
    city: locationContent.cityName,
  });
  const description = t("serviceLocationPage.description", {
    service: resolveServiceContent(serviceContent, tKnowledge).nameInSentence,
    city: locationContent.cityName,
    province: locationContent.provinceName,
  });
  const path = `/servicios/${category.slug}/${locationContent.slug}`;

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title, description, url: path, locale: toOgLocale(locale) },
    twitter: { title, description },
  };
}

export default async function ServiceInLocationPage({ params }: ServiceLocationPageProps) {
  const { slug, location } = await params;
  const verified = await getVerifiedPair(slug, location);
  if (!verified) {
    notFound();
  }

  const { category, locationContent } = verified;
  const path = `/servicios/${category.slug}/${locationContent.slug}`;
  const [t, tKnowledge, locale] = await Promise.all([
    getTranslations("services"),
    getTranslations("knowledge"),
    getLocale(),
  ]);
  const serviceContent = resolveServiceContent(verified.serviceContent, tKnowledge);
  const serviceName = localizeCategoryName(t, category);
  const serviceInSentence = serviceContent.nameInSentence;
  const city = locationContent.cityName;
  const province = locationContent.provinceName;
  const serviceInCity = t("shared.serviceInCity", { service: serviceName, city });

  // Merged FAQ: the service's own FAQ plus one location-specific question,
  // never a duplicate of either page's full FAQ set verbatim — this is
  // the page's own, distinct on-page content (Phase 17 — no thin,
  // templated duplication).
  const faqs = [
    {
      question: t("serviceLocationPage.localFaq.question", { service: serviceInSentence, city }),
      answer: t("serviceLocationPage.localFaq.answer", {
        service: serviceInSentence,
        city,
        province,
      }),
    },
    ...serviceContent.faqs.slice(0, 2),
  ];

  return (
    <PageContainer maxWidth="3xl" padded>
      <JsonLd
        data={buildServiceJsonLd({
          name: serviceInCity,
          path,
          description: localizeCategoryDescription(t, category),
          areaServed: city,
          inLanguage: locale,
        })}
      />
      <JsonLd
        data={buildBreadcrumbJsonLd([
          { name: t("breadcrumbs.home"), path: "/" },
          { name: t("breadcrumbs.services"), path: "/servicios" },
          { name: serviceName, path: `/servicios/${category.slug}` },
          { name: city, path },
        ])}
      />
      <JsonLd data={buildFaqJsonLd(faqs, { inLanguage: locale })} />

      <nav className="text-sm text-foreground/60">
        <Link href="/" className="hover:underline">
          {t("breadcrumbs.home")}
        </Link>{" "}
        /{" "}
        <Link href="/servicios" className="hover:underline">
          {t("breadcrumbs.services")}
        </Link>{" "}
        /{" "}
        <Link href={`/servicios/${category.slug}`} className="hover:underline">
          {serviceName}
        </Link>{" "}
        / <span className="text-foreground">{city}</span>
      </nav>

      <div>
        <h1 className="text-2xl font-semibold">{serviceInCity}</h1>
        <p className="mt-2 text-sm text-foreground/80">
          {serviceContent.intro} {t("serviceLocationPage.confirmedCoverage", { city, province })}
        </p>
      </div>

      <Section title={t("servicePage.whatYouCanRequestTitle")} gap="sm">
        <ul className="list-disc pl-5 text-sm text-foreground/80">
          {serviceContent.commonJobTypes.map((jobType) => (
            <li key={jobType}>{jobType}</li>
          ))}
        </ul>
      </Section>

      <Section title={t("serviceLocationPage.howItWorksTitle", { city })} gap="sm">
        <ol className="list-decimal pl-5 text-sm text-foreground/80">
          <li>{t("serviceLocationPage.howItWorks.step1", { service: serviceInSentence, city })}</li>
          <li>{t("serviceLocationPage.howItWorks.step2")}</li>
          <li>{t("serviceLocationPage.howItWorks.step3")}</li>
        </ol>
      </Section>

      <Section title={t("shared.faqTitle")} gap="sm">
        <dl className="flex flex-col gap-4">
          {faqs.map((faq) => (
            <div key={faq.question}>
              <dt className="text-sm font-medium text-foreground">{faq.question}</dt>
              <dd className="mt-1 text-sm text-foreground/80">{faq.answer}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <section className="rounded-md border border-border bg-black/5 p-4">
        <p className="text-sm text-foreground/70">
          {t("serviceLocationPage.cta", { service: serviceInSentence, city })}
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <Link
            href={{
              pathname: "/requests/new",
              query: { categoryId: category.id, city },
            }}
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            {t("shared.requestThisService")}
          </Link>
          <Link
            href={{ pathname: "/search", query: { categoryId: category.id, city } }}
            className="inline-flex h-10 items-center justify-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
          >
            {t("shared.viewProfessionals")}
          </Link>
        </div>
      </section>
    </PageContainer>
  );
}
