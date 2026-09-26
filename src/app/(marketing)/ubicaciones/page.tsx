import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";

import { PageContainer } from "@/components/layout/page-container";
import { Section } from "@/components/layout/section";
import { JsonLd } from "@/components/seo/json-ld";
import { buildBreadcrumbJsonLd } from "@/shared/seo/structured-data";
import { LOCATION_CONTENT, localizeCountryName } from "@/shared/content/locations";
import { findVerifiedCity } from "@/shared/content/verified-location";
import { NATIONAL_COVERAGE_CONTENT } from "@/shared/content/national-coverage";
import { toOgLocale } from "@/shared/seo/site";

/**
 * Module 118 (continuation) — Spain-wide geographic coverage.
 *
 * This index page now leads with MaestroYa's platform-wide (Spain) scope
 * — linking to `/ubicaciones/espana` — and keeps the original
 * "intersection, not union" list (curated content ∩ live database) of
 * individual localities with CONFIRMED coverage below it, clearly
 * labelled as such. The two are never merged into one undifferentiated
 * list: platform scope and verified local availability are different
 * claims (see the Module 118 report, "Platform Coverage vs. Verified
 * Local Availability").
 *
 * Module 120: rendered in the visitor's locale; one canonical URL.
 */
export async function generateMetadata(): Promise<Metadata> {
  const [t, locale] = await Promise.all([getTranslations("seo"), getLocale()]);
  const title = t("locationsIndex.title");
  const description = t("locationsIndex.description");
  return {
    title,
    description,
    alternates: { canonical: "/ubicaciones" },
    openGraph: { title, description, url: "/ubicaciones", locale: toOgLocale(locale) },
    twitter: { title, description },
  };
}

export default async function LocationsIndexPage() {
  const [t, verifiedEntries] = await Promise.all([
    getTranslations("services"),
    Promise.all(
      LOCATION_CONTENT.map(async (location) => {
        const verified = await findVerifiedCity(
          location.cityName,
          location.provinceName,
          location.countryCode,
        );
        return verified ? location : null;
      }),
    ).then((entries) =>
      entries.filter((location): location is NonNullable<typeof location> => Boolean(location)),
    ),
  ]);
  const countryName = (countryCode: string) => localizeCountryName(t, countryCode);

  return (
    <PageContainer maxWidth="3xl" padded>
      <JsonLd
        data={buildBreadcrumbJsonLd([
          { name: t("breadcrumbs.home"), path: "/" },
          { name: t("breadcrumbs.locations"), path: "/ubicaciones" },
        ])}
      />

      <div>
        <h1 className="text-2xl font-semibold">{t("locationsIndex.title")}</h1>
        <p className="mt-1 text-sm text-foreground/70">{t("locationsIndex.intro")}</p>
      </div>

      <Section title={t("shared.platformScopeTitle")} gap="sm">
        <Link
          href="/ubicaciones/espana"
          className="block rounded-md border border-border p-4 text-sm hover:border-primary/40 hover:bg-muted"
        >
          <span className="font-medium text-foreground">
            {t("locationsIndex.nationalCardTitle", {
              country: countryName(NATIONAL_COVERAGE_CONTENT.countryCode),
            })}
          </span>
          <span className="mt-1 block text-foreground/70">
            {t("locationsIndex.nationalCardDescription")}
          </span>
        </Link>
      </Section>

      <Section title={t("shared.confirmedLocalitiesTitle")} gap="sm">
        {verifiedEntries.length > 0 ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {verifiedEntries.map((location) => (
              <li key={location.slug}>
                <Link
                  href={`/ubicaciones/${location.slug}`}
                  className="block rounded-md border border-border p-4 text-sm hover:border-primary/40 hover:bg-muted"
                >
                  <span className="font-medium text-foreground">{location.cityName}</span>
                  <span className="mt-1 block text-foreground/70">
                    {t("shared.provinceCountry", {
                      province: location.provinceName,
                      country: countryName(location.countryCode),
                    })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-foreground/70">{t("locationsIndex.confirmedEmpty")}</p>
        )}
        <p className="text-xs text-foreground/60">{t("locationsIndex.confirmedNote")}</p>
      </Section>

      <p className="text-sm text-foreground/70">
        {t.rich("locationsIndex.servicesPrompt", {
          link: (chunks) => (
            <Link href="/servicios" className="underline">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </PageContainer>
  );
}
