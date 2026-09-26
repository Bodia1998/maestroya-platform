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
  NATIONAL_COVERAGE_CONTENT,
  resolveNationalCoverageContent,
} from "@/shared/content/national-coverage";
import { findVerifiedCountry } from "@/shared/content/verified-country";
import { listVerifiedTopLevelServiceCategories } from "@/shared/content/verified-service-category";
import { LOCATION_CONTENT, localizeCountryName } from "@/shared/content/locations";
import { findVerifiedCity } from "@/shared/content/verified-location";
import { toOgLocale } from "@/shared/seo/site";
import { localizeCategoryName } from "@/presentation/i18n/service-categories";

/**
 * Module 118 (continuation) — Spain-wide geographic coverage.
 *
 * A STATIC sibling of `/ubicaciones/[slug]` — Next.js's router resolves
 * a static segment ahead of a dynamic one at the same level, so
 * `/ubicaciones/espana` always hits this file, never
 * `[slug]/page.tsx` with `slug === "espana"`. `locations.ts`'s
 * `LOCATION_CONTENT` catalog (city-level content) also never defines an
 * `"espana"` slug, so there is no ambiguity at the content layer either.
 *
 * This page states MaestroYa's platform-wide business scope (Spain) —
 * a claim about what MaestroYa the marketplace *is*, not a claim that
 * every municipality currently has active professionals. It is verified,
 * the same way every other page in this module is, against a real
 * database row: the seeded `Country` (`code: "ES"`) — never trusted from
 * the static content catalog alone.
 *
 * Module 120: rendered in the visitor's locale (prose from the server-only
 * `knowledge` namespace); the platform-scope vs. verified-local-availability
 * distinction is preserved in every language.
 */
const getVerifiedNationalCoverage = cache(async () => {
  const country = await findVerifiedCountry(NATIONAL_COVERAGE_CONTENT.countryCode);
  if (!country) return null;
  return { country, content: NATIONAL_COVERAGE_CONTENT };
});

export async function generateMetadata(): Promise<Metadata> {
  const verified = await getVerifiedNationalCoverage();
  if (!verified) return {};

  const [t, locale] = await Promise.all([getTranslations("seo"), getLocale()]);
  const title = t("nationalCoverage.title");
  const description = t("nationalCoverage.description");
  const path = "/ubicaciones/espana";
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title, description, url: path, locale: toOgLocale(locale) },
    twitter: { title, description },
  };
}

export default async function NationalCoveragePage() {
  const verified = await getVerifiedNationalCoverage();
  if (!verified) {
    notFound();
  }

  const path = "/ubicaciones/espana";

  const [t, tKnowledge, locale, categories, verifiedLocalEntries] = await Promise.all([
    getTranslations("services"),
    getTranslations("knowledge"),
    getLocale(),
    listVerifiedTopLevelServiceCategories(),
    Promise.all(
      LOCATION_CONTENT.map(async (location) => {
        const verifiedCity = await findVerifiedCity(
          location.cityName,
          location.provinceName,
          location.countryCode,
        );
        return verifiedCity ? location : null;
      }),
    ).then((entries) =>
      entries.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
    ),
  ]);
  const content = resolveNationalCoverageContent(verified.content, tKnowledge);
  const countryName = localizeCountryName(t, verified.content.countryCode);

  return (
    <PageContainer maxWidth="3xl" padded>
      {/*
        Deliberately NOT LocalBusiness: MaestroYa is not a physical
        business with an address in every Spanish municipality, and
        emitting LocalBusiness here would misrepresent the platform
        exactly the way Module 117's own "LocalBusiness Decision"
        already rejected for the platform as a whole. `Service.areaServed`
        states the marketplace's operating scope, not a per-city supply
        guarantee — the `description` below repeats that caveat inline so
        the structured data itself never reads as an availability claim.
      */}
      <JsonLd
        data={buildServiceJsonLd({
          name: content.structuredDataName,
          path,
          description: content.structuredDataDescription,
          areaServed: countryName,
          inLanguage: locale,
        })}
      />
      <JsonLd
        data={buildBreadcrumbJsonLd([
          { name: t("breadcrumbs.home"), path: "/" },
          { name: t("breadcrumbs.locations"), path: "/ubicaciones" },
          { name: countryName, path },
        ])}
      />
      <JsonLd data={buildFaqJsonLd(content.faqs, { inLanguage: locale })} />

      <nav className="text-sm text-foreground/60">
        <Link href="/" className="hover:underline">
          {t("breadcrumbs.home")}
        </Link>{" "}
        /{" "}
        <Link href="/ubicaciones" className="hover:underline">
          {t("breadcrumbs.locations")}
        </Link>{" "}
        / <span className="text-foreground">{countryName}</span>
      </nav>

      <div>
        <h1 className="text-2xl font-semibold">
          {t("nationalPage.title", { country: countryName })}
        </h1>
        <p className="mt-2 text-sm text-foreground/80">{content.intro}</p>
      </div>

      <Section title={t("shared.platformScopeTitle")} gap="sm">
        <p className="text-sm text-foreground/80">{content.coverageStatement}</p>
      </Section>

      {categories.length > 0 && (
        <Section title={t("nationalPage.categoriesTitle")} gap="sm">
          <ul className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <li key={category.id}>
                <Link
                  href={`/servicios/${category.slug}`}
                  className="rounded-full border border-border px-3 py-1 text-xs hover:border-primary/40 hover:bg-muted"
                >
                  {localizeCategoryName(t, category)}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={t("nationalPage.localAvailabilityTitle")} gap="sm">
        <p className="text-sm text-foreground/80">{content.howLocalAvailabilityWorks}</p>
      </Section>

      <Section title={t("shared.confirmedLocalitiesTitle")} gap="sm">
        {verifiedLocalEntries.length > 0 ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {verifiedLocalEntries.map((location) => (
              <li key={location.slug}>
                <Link
                  href={`/ubicaciones/${location.slug}`}
                  className="block rounded-md border border-border p-4 text-sm hover:border-primary/40 hover:bg-muted"
                >
                  <span className="font-medium text-foreground">{location.cityName}</span>
                  <span className="mt-1 block text-foreground/70">
                    {t("shared.provinceCountry", {
                      province: location.provinceName,
                      country: localizeCountryName(t, location.countryCode),
                    })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-foreground/70">{t("nationalPage.confirmedEmpty")}</p>
        )}
        <p className="text-xs text-foreground/60">{t("nationalPage.confirmedNote")}</p>
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

      <section className="rounded-md border border-border bg-black/5 p-4">
        <p className="text-sm text-foreground/70">{t("nationalPage.cta")}</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <Link
            href="/search"
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            {t("nationalPage.searchProfessionals")}
          </Link>
          <Link
            href="/auth/register"
            className="inline-flex h-10 items-center justify-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
          >
            {t("nationalPage.joinAsProfessional")}
          </Link>
        </div>
      </section>
    </PageContainer>
  );
}
