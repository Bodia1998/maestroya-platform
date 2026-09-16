import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageContainer } from "@/components/layout/page-container";
import { Section } from "@/components/layout/section";
import { JsonLd } from "@/components/seo/json-ld";
import { buildBreadcrumbJsonLd, buildFaqJsonLd, buildServiceJsonLd } from "@/shared/seo/structured-data";
import { NATIONAL_COVERAGE_CONTENT } from "@/shared/content/national-coverage";
import { findVerifiedCountry } from "@/shared/content/verified-country";
import { listVerifiedTopLevelServiceCategories } from "@/shared/content/verified-service-category";
import { LOCATION_CONTENT } from "@/shared/content/locations";
import { findVerifiedCity } from "@/shared/content/verified-location";

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
 */
const getVerifiedNationalCoverage = cache(async () => {
  const country = await findVerifiedCountry(NATIONAL_COVERAGE_CONTENT.countryCode);
  if (!country) return null;
  return { country, content: NATIONAL_COVERAGE_CONTENT };
});

const TITLE = "MaestroYa en España — cobertura nacional";
const DESCRIPTION =
  "MaestroYa es un marketplace de servicios para el hogar pensado para operar en toda España. La disponibilidad real de profesionales depende de cada zona.";

export async function generateMetadata(): Promise<Metadata> {
  const verified = await getVerifiedNationalCoverage();
  if (!verified) return {};

  const path = "/ubicaciones/espana";
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: path },
    openGraph: { title: TITLE, description: DESCRIPTION, url: path },
    twitter: { title: TITLE, description: DESCRIPTION },
  };
}

export default async function NationalCoveragePage() {
  const verified = await getVerifiedNationalCoverage();
  if (!verified) {
    notFound();
  }

  const { content } = verified;
  const path = "/ubicaciones/espana";

  const [categories, verifiedLocalEntries] = await Promise.all([
    listVerifiedTopLevelServiceCategories(),
    Promise.all(
      LOCATION_CONTENT.map(async (location) => {
        const verifiedCity = await findVerifiedCity(location.cityName, location.provinceName, location.countryCode);
        return verifiedCity ? location : null;
      }),
    ).then((entries) => entries.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))),
  ]);

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
          name: "Servicios para el hogar a través de MaestroYa",
          path,
          description:
            "Marketplace de servicios para el hogar operado por MaestroYa en España. La disponibilidad de profesionales varía según la categoría de servicio y la zona.",
          areaServed: content.displayName,
        })}
      />
      <JsonLd
        data={buildBreadcrumbJsonLd([
          { name: "Inicio", path: "/" },
          { name: "Ubicaciones", path: "/ubicaciones" },
          { name: content.displayName, path },
        ])}
      />
      <JsonLd data={buildFaqJsonLd(content.faqs)} />

      <nav className="text-sm text-foreground/60">
        <Link href="/" className="hover:underline">
          Inicio
        </Link>{" "}
        /{" "}
        <Link href="/ubicaciones" className="hover:underline">
          Ubicaciones
        </Link>{" "}
        / <span className="text-foreground">{content.displayName}</span>
      </nav>

      <div>
        <h1 className="text-2xl font-semibold">MaestroYa en {content.displayName}</h1>
        <p className="mt-2 text-sm text-foreground/80">{content.intro}</p>
      </div>

      <Section title="Alcance de la plataforma" gap="sm">
        <p className="text-sm text-foreground/80">{content.coverageStatement}</p>
      </Section>

      {categories.length > 0 && (
        <Section title="Categorías de servicio" gap="sm">
          <ul className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <li key={category.id}>
                <Link
                  href={`/servicios/${category.slug}`}
                  className="rounded-full border border-border px-3 py-1 text-xs hover:border-primary/40 hover:bg-muted"
                >
                  {category.name}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Cómo funciona la disponibilidad local" gap="sm">
        <p className="text-sm text-foreground/80">{content.howLocalAvailabilityWorks}</p>
      </Section>

      <Section title="Localidades con cobertura confirmada" gap="sm">
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
                    {location.provinceName}, {location.countryName}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-foreground/70">
            Todavía no hay localidades con cobertura confirmada por datos reales de la plataforma.
          </p>
        )}
        <p className="text-xs text-foreground/60">
          Esta lista solo incluye localidades cuya cobertura está confirmada por los datos reales de la
          plataforma. Que una localidad no aparezca aquí no significa que MaestroYa no pueda operar allí en
          el futuro — significa que, hoy, no hay cobertura confirmada que mostrar.
        </p>
      </Section>

      <Section title="Preguntas frecuentes" gap="sm">
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
        <p className="text-sm text-foreground/70">
          ¿Listo para empezar? Publica una solicitud describiendo el servicio que necesitas y tu ubicación.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <Link
            href="/search"
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Buscar profesionales
          </Link>
          <Link
            href="/auth/register"
            className="inline-flex h-10 items-center justify-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
          >
            Unirme como profesional
          </Link>
        </div>
      </section>
    </PageContainer>
  );
}
