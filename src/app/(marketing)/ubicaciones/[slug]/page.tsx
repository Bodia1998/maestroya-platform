import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageContainer } from "@/components/layout/page-container";
import { Section } from "@/components/layout/section";
import { JsonLd } from "@/components/seo/json-ld";
import { buildBreadcrumbJsonLd, buildFaqJsonLd } from "@/shared/seo/structured-data";
import { getLocationContentBySlug } from "@/shared/content/locations";
import { findVerifiedCity } from "@/shared/content/verified-location";
import { listVerifiedTopLevelServiceCategories } from "@/shared/content/verified-service-category";
import { getServiceContentBySlug } from "@/shared/content/services";
import { JUSTIFIED_SERVICE_LOCATION_PAIRS } from "@/shared/content/service-location-pairs";

type LocationPageProps = { params: Promise<{ slug: string }> };

/**
 * Module 118 — AI-Readable Service & Location Knowledge.
 *
 * Same verify-then-render discipline as the service page: a location page
 * only exists for a slug that is BOTH in the curated `LOCATION_CONTENT`
 * catalog AND a real row in the live `City`/`Province`/`Country` tables.
 */
const getVerifiedLocation = cache(async (slug: string) => {
  const content = getLocationContentBySlug(slug);
  if (!content) return null;
  const verified = await findVerifiedCity(content.cityName, content.provinceName, content.countryCode);
  if (!verified) return null;
  return { content, verified };
});

export async function generateMetadata({ params }: LocationPageProps): Promise<Metadata> {
  const { slug } = await params;
  const result = await getVerifiedLocation(slug);
  if (!result) return {};

  const { content } = result;
  const title = `Profesionales en ${content.cityName} — MaestroYa`;
  const description = `Servicios para el hogar disponibles en ${content.cityName} (${content.provinceName}) a través de MaestroYa.`;
  const path = `/ubicaciones/${content.slug}`;

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title, description, url: path },
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

  const categories = await listVerifiedTopLevelServiceCategories();
  const servicesHere = JUSTIFIED_SERVICE_LOCATION_PAIRS.filter((pair) => pair.locationSlug === content.slug)
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
          { name: "Inicio", path: "/" },
          { name: "Ubicaciones", path: "/ubicaciones" },
          { name: content.cityName, path },
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
        / <span className="text-foreground">{content.cityName}</span>
      </nav>

      <div>
        <h1 className="text-2xl font-semibold">MaestroYa en {content.cityName}</h1>
        <p className="mt-1 text-sm text-foreground/60">
          {content.provinceName}, {content.countryName}
        </p>
        <p className="mt-2 text-sm text-foreground/80">{content.intro}</p>
      </div>

      {servicesHere.length > 0 && (
        <Section title={`Servicios disponibles en ${content.cityName}`} gap="sm">
          <ul className="grid gap-3 sm:grid-cols-2">
            {servicesHere.map(({ category }) => (
              <li key={category.id}>
                <Link
                  href={`/servicios/${category.slug}/${content.slug}`}
                  className="block rounded-md border border-border p-4 text-sm hover:border-primary/40 hover:bg-muted"
                >
                  <span className="font-medium text-foreground">
                    {category.name} en {content.cityName}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Cómo funciona en tu zona" gap="sm">
        <ol className="list-decimal pl-5 text-sm text-foreground/80">
          <li>Publicas una solicitud describiendo el trabajo y tu dirección en {content.cityName}.</li>
          <li>Los profesionales que cubren esa categoría y esta zona pueden revisarla y enviarte un presupuesto.</li>
          <li>Comparas los presupuestos recibidos y aceptas el que prefieras.</li>
        </ol>
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

      {relatedLocations.length > 0 && (
        <Section title="Otras localidades" gap="sm">
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
        <p className="text-sm text-foreground/70">
          ¿Listo para empezar? Publica una solicitud y los profesionales que cubran {content.cityName}{" "}
          podrán enviarte un presupuesto.
        </p>
        <Link
          href={{ pathname: "/search", query: { city: content.cityName } }}
          className="mt-3 inline-flex h-10 items-center justify-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
        >
          Ver profesionales en {content.cityName}
        </Link>
      </section>
    </PageContainer>
  );
}
