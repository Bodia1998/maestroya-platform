import type { Metadata } from "next";
import Link from "next/link";

import { PageContainer } from "@/components/layout/page-container";
import { Section } from "@/components/layout/section";
import { JsonLd } from "@/components/seo/json-ld";
import { buildBreadcrumbJsonLd } from "@/shared/seo/structured-data";
import { listVerifiedTopLevelServiceCategories } from "@/shared/content/verified-service-category";
import { getServiceContentBySlug } from "@/shared/content/services";

const TITLE = "Servicios para el hogar en MaestroYa";
const DESCRIPTION =
  "Consulta las categorías de servicio para el hogar disponibles en MaestroYa: fontanería, electricidad, aire acondicionado, pintura, reformas y montaje de muebles.";

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
 */
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/servicios" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/servicios" },
  twitter: { title: TITLE, description: DESCRIPTION },
};

export default async function ServicesIndexPage() {
  const categories = await listVerifiedTopLevelServiceCategories();
  const publishable = categories.filter((category) => getServiceContentBySlug(category.slug));

  return (
    <PageContainer maxWidth="3xl" padded>
      <JsonLd
        data={buildBreadcrumbJsonLd([
          { name: "Inicio", path: "/" },
          { name: "Servicios", path: "/servicios" },
        ])}
      />

      <div>
        <h1 className="text-2xl font-semibold">Servicios para el hogar</h1>
        <p className="mt-1 text-sm text-foreground/70">
          Estas son las categorías de servicio disponibles hoy en MaestroYa. Elige una para conocer qué
          puedes solicitar y cómo funciona el proceso de presupuesto.
        </p>
      </div>

      {publishable.length > 0 ? (
        <Section gap="sm">
          <ul className="grid gap-3 sm:grid-cols-2">
            {publishable.map((category) => (
              <li key={category.id}>
                <Link
                  href={`/servicios/${category.slug}`}
                  className="block rounded-md border border-border p-4 text-sm hover:border-primary/40 hover:bg-muted"
                >
                  <span className="font-medium text-foreground">{category.name}</span>
                  {category.description && (
                    <span className="mt-1 block text-foreground/70">{category.description}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : (
        <p className="text-sm text-foreground/70">
          No hay categorías de servicio publicadas en este momento.
        </p>
      )}

      <p className="text-sm text-foreground/70">
        ¿Buscas cobertura por zona?{" "}
        <Link href="/ubicaciones" className="underline">
          Consulta las localidades disponibles
        </Link>
        .
      </p>
    </PageContainer>
  );
}
