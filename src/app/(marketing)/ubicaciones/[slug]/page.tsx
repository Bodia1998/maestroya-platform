import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { PageContainer } from "@/components/layout/page-container";
import { Section } from "@/components/layout/section";
import { JsonLd } from "@/components/seo/json-ld";
import { buildBreadcrumbJsonLd, buildFaqJsonLd } from "@/shared/seo/structured-data";
import {
  getLocationContentBySlug,
  localizeCountryName,
  resolveLocationContent,
} from "@/shared/content/locations";
import { findVerifiedCity } from "@/shared/content/verified-location";
import { listVerifiedTopLevelServiceCategories } from "@/shared/content/verified-service-category";
import { getServiceContentBySlug } from "@/shared/content/services";
import { JUSTIFIED_SERVICE_LOCATION_PAIRS } from "@/shared/content/service-location-pairs";
import { toOgLocale } from "@/shared/seo/site";
import { localizeCategoryName } from "@/presentation/i18n/service-categories";

type LocationPageProps = { params: Promise<{ slug: string }> };

/**
 * Module 118 — AI-Readable Service & Location Knowledge.
 *
 * Same verify-then-render discipline as the service page: a location page
 * only exists for a slug that is BOTH in the curated `LOCATION_CONTENT`
 * catalog AND a real row in the live `City`/`Province`/`Country` tables.
 *
 * Module 120: rendered in the visitor's locale (prose from the server-only
 * `knowledge` namespace); city/province names are never translated.
 */
const getVerifiedLocation = cache(async (slug: string) => {
  const content = getLocationContentBySlug(slug);
  if (!content) return null;
  const verified = await findVerifiedCity(
    content.cityName,
    content.provinceName,
    content.countryCode,
  );
  if (!verified) return null;
  return { content, verified };
});

export async function generateMetadata({ params }: LocationPageProps): Promise<Metadata> {
  const { slug } = await params;
  const result = await getVerifiedLocation(slug);
  if (!result) return {};

  const { content } = result;
  const [t, locale] = await Promise.all([getTranslations("seo"), getLocale()]);
  const title = t("locationPage.title", { city: content.cityName });
  const description = t("locationPage.description", {
    city: content.cityName,
    province: content.provinceName,
  });
  const path = `/ubicaciones/${content.slug}`;

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title, description, url: path, locale: toOgLocale(locale) },
    twitter: { title, description },
  };
}

export default async function LocationPage({ params }: LocationPageProps) {
  const { slug } = await params;
  const result = await getVerifiedLocation(slug);
  if (!result) {
    notFound();
  }

  const { content } = result;
  const path = `/ubicaciones/${content.slug}`;
  const city = content.cityName;

  const [t, tKnowledge, locale, categories] = await Promise.all([
    getTranslations("services"),
    getTranslations("knowledge"),
    getLocale(),
    listVerifiedTopLevelServiceCategories(),
  ]);
  const text = resolveLocationContent(content, tKnowledge);

  const servicesHere = JUSTIFIED_SERVICE_LOCATION_PAIRS.filter(
    (pair) => pair.locationSlug === content.slug,
  )
    .map((pair) => {
      const category = categories.find((c) => c.slug === pair.serviceSlug);
      const serviceContent = getServiceContentBySlug(pair.serviceSlug);
      if (!category || !serviceContent) return null;
      return { category, serviceContent };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  const relatedLocations = content.relatedLocationSlugs
    .map((relatedSlug) => getLocationContentBySlug(relatedSlug))
    .filter((related): related is NonNullable<typeof related> => Boolean(related));

  return (
    <PageContainer maxWidth="3xl" padded>
      <JsonLd
        data={buildBreadcrumbJsonLd([
          { name: t("breadcrumbs.home"), path: "/" },
          { name: t("breadcrumbs.locations"), path: "/ubicaciones" },
          { name: city, path },
        ])}
      />
      <JsonLd data={buildFaqJsonLd(text.faqs, { inLanguage: locale })} />

      <nav className="text-sm text-foreground/60">
        <Link href="/" className="hover:underline">
          {t("breadcrumbs.home")}
        </Link>{" "}
        /{" "}
        <Link href="/ubicaciones" className="hover:underline">
          {t("breadcrumbs.locations")}
        </Link>{" "}
        / <span className="text-foreground">{city}</span>
      </nav>

      <div>
        <h1 className="text-2xl font-semibold">{t("locationPage.title", { city })}</h1>
        <p className="mt-1 text-sm text-foreground/60">
          {t("shared.provinceCountry", {
            province: content.provinceName,
            country: localizeCountryName(t, content.countryCode),
          })}
        </p>
        <p className="mt-2 text-sm text-foreground/80">{text.intro}</p>
      </div>

      {servicesHere.length > 0 && (
        <Section title={t("locationPage.servicesTitle", { city })} gap="sm">
          <ul className="grid gap-3 sm:grid-cols-2">
            {servicesHere.map(({ category }) => (
              <li key={category.id}>
                <Link
                  href={`/servicios/${category.slug}/${content.slug}`}
                  className="block rounded-md border border-border p-4 text-sm hover:border-primary/40 hover:bg-muted"
                >
                  <span className="font-medium text-foreground">
                    {t("shared.serviceInCity", {
                      service: localizeCategoryName(t, category),
                      city,
                    })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={t("locationPage.howItWorksTitle")} gap="sm">
        <ol className="list-decimal pl-5 text-sm text-foreground/80">
          <li>{t("locationPage.howItWorks.step1", { city })}</li>
          <li>{t("locationPage.howItWorks.step2")}</li>
          <li>{t("locationPage.howItWorks.step3")}</li>
        </ol>
      </Section>

      <Section title={t("shared.faqTitle")} gap="sm">
        <dl className="flex flex-col gap-4">
          {text.faqs.map((faq) => (
            <div key={faq.question}>
              <dt className="text-sm font-medium text-foreground">{faq.question}</dt>
              <dd className="mt-1 text-sm text-foreground/80">{faq.answer}</dd>
            </div>
          ))}
        </dl>
      </Section>

      {relatedLocations.length > 0 && (
        <Section title={t("locationPage.relatedTitle")} gap="sm">
          <ul className="flex flex-wrap gap-2">
            {relatedLocations.map((related) => (
              <li key={related.slug}>
                <Link
                  href={`/ubicaciones/${related.slug}`}
                  className="rounded-full border border-border px-3 py-1 text-xs hover:border-primary/40 hover:bg-muted"
                >
                  {related.cityName}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <section className="rounded-md border border-border bg-black/5 p-4">
        <p className="text-sm text-foreground/70">{t("locationPage.cta", { city })}</p>
        <Link
          href={{ pathname: "/search", query: { city } }}
          className="mt-3 inline-flex h-10 items-center justify-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
        >
          {t("locationPage.viewProfessionalsIn", { city })}
        </Link>
      </section>
    </PageContainer>
  );
}
