import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageContainer } from "@/components/layout/page-container";
import { Section } from "@/components/layout/section";
import { JsonLd } from "@/components/seo/json-ld";
import { buildBreadcrumbJsonLd, buildFaqJsonLd, buildServiceJsonLd } from "@/shared/seo/structured-data";
import { findVerifiedTopLevelServiceCategory } from "@/shared/content/verified-service-category";
import { getServiceContentBySlug } from "@/shared/content/services";
import { findVerifiedCity } from "@/shared/content/verified-location";
import { getLocationContentBySlug } from "@/shared/content/locations";
import { isJustifiedServiceLocationPair } from "@/shared/content/service-location-pairs";

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
 */
const getVerifiedPair = cache(async (serviceSlug: string, locationSlug: string) => {
  if (!isJustifiedServiceLocationPair(serviceSlug, locationSlug)) return null;

  const serviceContent = getServiceContentBySlug(serviceSlug);
  const locationContent = getLocationContentBySlug(locationSlug);
  if (!serviceContent || !locationContent) return null;

  const [category, city] = await Promise.all([
    findVerifiedTopLevelServiceCategory(serviceSlug),
    findVerifiedCity(locationContent.cityName, locationContent.provinceName, locationContent.countryCode),
  ]);
  if (!category || !city) return null;

  return { category, city, serviceContent, locationContent };
});

export async function generateMetadata({ params }: ServiceLocationPageProps): Promise<Metadata> {
  const { slug, location } = await params;
  const verified = await getVerifiedPair(slug, location);
  if (!verified) return {};

  const { category, locationContent } = verified;
  const title = `${category.name} en ${locationContent.cityName} — MaestroYa`;
  const description = `Solicita ${category.name.toLowerCase()} en ${locationContent.cityName} (${locationContent.provinceName}) a través de MaestroYa y compara presupuestos.`;
  const path = `/servicios/${category.slug}/${locationContent.slug}`;

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title, description, url: path },
    twitter: { title, description },
  };
}

export default async function ServiceInLocationPage({ params }: ServiceLocationPageProps) {
  const { slug, location } = await params;
  const verified = await getVerifiedPair(slug, location);
  if (!verified) {
    notFound();
  }

  const { category, locationContent, serviceContent } = verified;
  const path = `/servicios/${category.slug}/${locationContent.slug}`;
  const serviceLower = category.name.toLowerCase();

  // Merged FAQ: the service's own FAQ plus one location-specific question,
  // never a duplicate of either page's full FAQ set verbatim — this is
  // the page's own, distinct on-page content (Phase 17 — no thin,
  // templated duplication).
  const faqs = [
    {
      question: `¿Puedo solicitar ${serviceLower} en ${locationContent.cityName}?`,
      answer: `Sí. Puedes publicar una solicitud de ${serviceLower} indicando una dirección en ${locationContent.cityName} (${locationContent.provinceName}). Los profesionales de esta categoría que cubran la zona podrán revisarla y enviarte un presupuesto.`,
    },
    ...serviceContent.faqs.slice(0, 2),
  ];

  return (
    <PageContainer maxWidth="3xl" padded>
      <JsonLd
        data={buildServiceJsonLd({
          name: `${category.name} en ${locationContent.cityName}`,
          path,
          description: category.description,
          areaServed: locationContent.cityName,
        })}
      />
      <JsonLd
        data={buildBreadcrumbJsonLd([
          { name: "Inicio", path: "/" },
          { name: "Servicios", path: "/servicios" },
          { name: category.name, path: `/servicios/${category.slug}` },
          { name: locationContent.cityName, path },
        ])}
      />
      <JsonLd data={buildFaqJsonLd(faqs)} />

      <nav className="text-sm text-foreground/60">
        <Link href="/" className="hover:underline">
          Inicio
        </Link>{" "}
        /{" "}
        <Link href="/servicios" className="hover:underline">
          Servicios
        </Link>{" "}
        /{" "}
        <Link href={`/servicios/${category.slug}`} className="hover:underline">
          {category.name}
        </Link>{" "}
        / <span className="text-foreground">{locationContent.cityName}</span>
      </nav>

      <div>
        <h1 className="text-2xl font-semibold">
          {category.name} en {locationContent.cityName}
        </h1>
        <p className="mt-2 text-sm text-foreground/80">
          {serviceContent.intro} MaestroYa tiene cobertura confirmada en {locationContent.cityName} (
          {locationContent.provinceName}), por lo que puedes publicar tu solicitud indicando una dirección
          en esta localidad.
        </p>
      </div>

      <Section title="Qué puedes solicitar" gap="sm">
        <ul className="list-disc pl-5 text-sm text-foreground/80">
          {serviceContent.commonJobTypes.map((jobType) => (
            <li key={jobType}>{jobType}</li>
          ))}
        </ul>
      </Section>

      <Section title={`Cómo funciona en ${locationContent.cityName}`} gap="sm">
        <ol className="list-decimal pl-5 text-sm text-foreground/80">
          <li>Publicas una solicitud de {serviceLower} con una dirección en {locationContent.cityName}.</li>
          <li>Los profesionales de esta categoría que cubren la zona pueden enviarte un presupuesto.</li>
          <li>Comparas los presupuestos y aceptas el que prefieras.</li>
        </ol>
      </Section>

      <Section title="Preguntas frecuentes" gap="sm">
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
          ¿Listo para empezar? Publica tu solicitud de {serviceLower} en {locationContent.cityName}.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <Link
            href={{
              pathname: "/requests/new",
              query: { categoryId: category.id, city: locationContent.cityName },
            }}
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Solicitar este servicio
          </Link>
          <Link
            href={{ pathname: "/search", query: { categoryId: category.id, city: locationContent.cityName } }}
            className="inline-flex h-10 items-center justify-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
          >
            Ver profesionales
          </Link>
        </div>
      </section>
    </PageContainer>
  );
}
