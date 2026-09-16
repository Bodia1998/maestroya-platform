import type { Metadata } from "next";
import Link from "next/link";

import { PageContainer } from "@/components/layout/page-container";
import { Section } from "@/components/layout/section";
import { JsonLd } from "@/components/seo/json-ld";
import { buildBreadcrumbJsonLd } from "@/shared/seo/structured-data";
import { LOCATION_CONTENT } from "@/shared/content/locations";
import { findVerifiedCity } from "@/shared/content/verified-location";

const TITLE = "Ubicaciones — MaestroYa en España";
const DESCRIPTION =
  "MaestroYa es un marketplace de servicios para el hogar pensado para operar en toda España. Consulta el alcance de la plataforma y las localidades con cobertura confirmada.";

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
 */
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/ubicaciones" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/ubicaciones" },
  twitter: { title: TITLE, description: DESCRIPTION },
};

export default async function LocationsIndexPage() {
  const verifiedEntries = (
    await Promise.all(
      LOCATION_CONTENT.map(async (location) => {
        const verified = await findVerifiedCity(location.cityName, location.provinceName, location.countryCode);
        return verified ? location : null;
      }),
    )
  ).filter((location): location is NonNullable<typeof location> => Boolean(location));

  return (
    <PageContainer maxWidth="3xl" padded>
      <JsonLd
        data={buildBreadcrumbJsonLd([
          { name: "Inicio", path: "/" },
          { name: "Ubicaciones", path: "/ubicaciones" },
        ])}
      />

      <div>
        <h1 className="text-2xl font-semibold">Ubicaciones</h1>
        <p className="mt-1 text-sm text-foreground/70">
          MaestroYa es un marketplace de servicios para el hogar pensado para operar en toda España. La
          disponibilidad real de profesionales depende de cada zona.
        </p>
      </div>

      <Section title="Alcance de la plataforma" gap="sm">
        <Link
          href="/ubicaciones/espana"
          className="block rounded-md border border-border p-4 text-sm hover:border-primary/40 hover:bg-muted"
        >
          <span className="font-medium text-foreground">MaestroYa en España</span>
          <span className="mt-1 block text-foreground/70">
            Qué significa que MaestroYa sea un marketplace de alcance nacional y cómo funciona la
            disponibilidad local.
          </span>
        </Link>
      </Section>

      <Section title="Localidades con cobertura confirmada" gap="sm">
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
                    {location.provinceName}, {location.countryName}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-foreground/70">
            No hay localidades con cobertura confirmada publicadas en este momento.
          </p>
        )}
        <p className="text-xs text-foreground/60">
          Esta lista solo incluye localidades cuya cobertura está confirmada por los datos reales de la
          plataforma — no es la lista completa de zonas donde MaestroYa puede llegar a operar.
        </p>
      </Section>

      <p className="text-sm text-foreground/70">
        ¿Buscas por tipo de servicio?{" "}
        <Link href="/servicios" className="underline">
          Consulta las categorías disponibles
        </Link>
        .
      </p>
    </PageContainer>
  );
}
