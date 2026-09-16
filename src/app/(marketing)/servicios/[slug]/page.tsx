import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageContainer } from "@/components/layout/page-container";
import { Section } from "@/components/layout/section";
import { JsonLd } from "@/components/seo/json-ld";
import { buildBreadcrumbJsonLd, buildFaqJsonLd, buildServiceJsonLd } from "@/shared/seo/structured-data";
import {
  findVerifiedTopLevelServiceCategory,
  listVerifiedTopLevelServiceCategories,
} from "@/shared/content/verified-service-category";
import { getServiceContentBySlug } from "@/shared/content/services";
import { LOCATION_CONTENT } from "@/shared/content/locations";
import { JUSTIFIED_SERVICE_LOCATION_PAIRS } from "@/shared/content/service-location-pairs";

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

  const { category } = verified;
  const title = `${category.name} — MaestroYa`;
  const description =
    category.description ??
    `Solicita un profesional de ${category.name.toLowerCase()} a través de MaestroYa y compara presupuestos.`;
  const path = `/servicios/${category.slug}`;

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title, description, url: path },
    twitter: { title, description },
  };
}

export default async function ServiceCategoryPage({ params }: ServicePageProps) {
  const { slug } = await params;
  const verified = await getVerifiedService(slug);
  if (!verified) {
    notFound();
  }

  const { category, content } = verified;
  const path = `/servicios/${category.slug}`;

  const relatedServices = content.relatedServiceSlugs
    .map((relatedSlug) => getServiceContentBySlug(relatedSlug))
    .filter((related): related is NonNullable<typeof related> => Boolean(related));

  const allCategories = await listVerifiedTopLevelServiceCategories();
  const nameBySlug = Object.fromEntries(allCategories.map((c) => [c.slug, c.name]));

  const availableLocations = JUSTIFIED_SERVICE_LOCATION_PAIRS.filter(
    (pair) => pair.serviceSlug === category.slug,
  )
    .map((pair) => LOCATION_CONTENT.find((location) => location.slug === pair.locationSlug))
    .filter((location): location is NonNullable<typeof location> => Boolean(location));

  return (
    <PageContainer maxWidth="3xl" padded>
      <JsonLd
        data={buildServiceJsonLd({
          name: category.name,
          path,
          description: category.description,
        })}
      />
      <JsonLd
        data={buildBreadcrumbJsonLd([
          { name: "Inicio", path: "/" },
          { name: "Servicios", path: "/servicios" },
          { name: category.name, path },
        ])}
      />
      <JsonLd data={buildFaqJsonLd(content.faqs)} />

      <nav className="text-sm text-foreground/60">
        <Link href="/" className="hover:underline">
          Inicio
        </Link>{" "}
        /{" "}
        <Link href="/servicios" className="hover:underline">
          Servicios
        </Link>{" "}
        / <span className="text-foreground">{category.name}</span>
      </nav>

      <div>
        <h1 className="text-2xl font-semibold">{category.name}</h1>
        <p className="mt-2 text-sm text-foreground/80">{content.intro}</p>
      </div>

      <Section title="Qué puedes solicitar" gap="sm">
        <ul className="list-disc pl-5 text-sm text-foreground/80">
          {content.commonJobTypes.map((jobType) => (
            <li key={jobType}>{jobType}</li>
          ))}
        </ul>
      </Section>

      <Section title="Qué suele aportar el profesional" gap="sm">
        <ul className="list-disc pl-5 text-sm text-foreground/80">
          {content.whatProfessionalsTypicallyProvide.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </Section>

      <Section title="Cómo funciona en MaestroYa" gap="sm">
        <ol className="list-decimal pl-5 text-sm text-foreground/80">
          <li>Publicas una solicitud describiendo el trabajo de {category.name.toLowerCase()}.</li>
          <li>Los profesionales que cubren esta categoría y tu zona pueden revisarla y enviarte un presupuesto.</li>
          <li>Comparas los presupuestos recibidos y aceptas el que prefieras.</li>
          <li>El trabajo se agenda y se realiza según lo acordado en el presupuesto aceptado.</li>
        </ol>
      </Section>

      {availableLocations.length > 0 && (
        <Section title="Zonas con este servicio" gap="sm">
          <ul className="flex flex-wrap gap-2">
            {availableLocations.map((location) => (
              <li key={location.slug}>
                <Link
                  href={`/servicios/${category.slug}/${location.slug}`}
                  className="rounded-full border border-border px-3 py-1 text-xs hover:border-primary/40 hover:bg-muted"
                >
                  {category.name} en {location.cityName}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Antes de solicitar" gap="sm">
        <ul className="list-disc pl-5 text-sm text-foreground/80">
          {content.considerations.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
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

      {relatedServices.length > 0 && (
        <Section title="Servicios relacionados" gap="sm">
          <ul className="flex flex-wrap gap-2">
            {relatedServices.map((related) => (
              <li key={related.slug}>
                <Link
                  href={`/servicios/${related.slug}`}
                  className="rounded-full border border-border px-3 py-1 text-xs hover:border-primary/40 hover:bg-muted"
                >
                  {nameBySlug[related.slug] ?? related.slug}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <section className="rounded-md border border-border bg-black/5 p-4">
        <p className="text-sm text-foreground/70">
          ¿Listo para empezar? Publica una solicitud de {category.name.toLowerCase()} y los profesionales
          que la cubran podrán enviarte un presupuesto.
        </p>
        <Link
          href={{ pathname: "/requests/new", query: { categoryId: category.id } }}
          className="mt-3 inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Solicitar este servicio
        </Link>
      </section>
    </PageContainer>
  );
}
