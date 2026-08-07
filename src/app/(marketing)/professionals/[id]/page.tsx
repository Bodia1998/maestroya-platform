import { cache } from "react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { prisma } from "@/infrastructure/database/prisma/client";
import { NotFoundError } from "@/domain/errors/domain-error";
import { makeGetProfessionalPublicProfileUseCase } from "@/application/use-cases/discovery/compose";
import { PageContainer } from "@/components/layout/page-container";
import { Section } from "@/components/layout/section";
import { ResponsiveGrid } from "@/components/layout/responsive-grid";
import { JsonLd } from "@/components/seo/json-ld";
import { buildBreadcrumbJsonLd, buildProfessionalServiceJsonLd } from "@/shared/seo/structured-data";
import { VerificationBadge } from "../verification-badge";

type ProfessionalPageProps = { params: Promise<{ id: string }> };

/**
 * Module 43 — SEO Infrastructure: wrapped in React's `cache()` so
 * `generateMetadata` and the page component below share one fetch per
 * request instead of two — Next.js runs both independently and does not
 * dedupe arbitrary async function calls on its own (only `fetch()` gets
 * that for free), so without this the use case (and its underlying
 * Prisma query) would run twice per request.
 */
const getProfile = cache(async (id: string) => {
  try {
    return await makeGetProfessionalPublicProfileUseCase().execute(id);
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
});

export async function generateMetadata({ params }: ProfessionalPageProps): Promise<Metadata> {
  const { id } = await params;
  const profile = await getProfile(id);
  if (!profile) return {};

  const name = profile.businessName ?? profile.displayName;
  const location = [profile.city, profile.province].filter(Boolean).join(", ");
  const description =
    profile.headline ??
    (location
      ? `Profesional verificado en ${location}. Consulta su perfil y solicita presupuesto en MaestroYa.`
      : "Consulta el perfil de este profesional y solicita presupuesto en MaestroYa.");
  const path = `/professionals/${id}`;

  return {
    title: name,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "profile",
      title: name,
      description,
      url: path,
      ...(profile.profileImageUrl ? { images: [{ url: profile.profileImageUrl }] } : {}),
    },
    twitter: {
      title: name,
      description,
      ...(profile.profileImageUrl ? { images: [profile.profileImageUrl] } : {}),
    },
  };
}

/**
 * Public professional profile page — reachable from a Professional
 * Discovery search result. No authentication required to view: this is a
 * marketplace public profile, not the professional's own private
 * dashboard (see (dashboard)/dashboard/professional/page.tsx for that).
 *
 * Only ever renders the safe, public-facing fields
 * GetProfessionalPublicProfileUseCase returns — no contact details, tax
 * id, exact address, or internal moderation fields ever reach this page.
 * Reviews/ratings and booking are explicitly out of scope for this module.
 */
export default async function PublicProfessionalProfilePage({ params }: ProfessionalPageProps) {
  const { id } = await params;

  const profile = await getProfile(id);
  if (!profile) {
    notFound();
  }

  const categories = profile.categoryIds.length
    ? await prisma.serviceCategory.findMany({
        where: { id: { in: profile.categoryIds } },
        select: { id: true, name: true },
      })
    : [];

  const name = profile.businessName ?? profile.displayName;
  const path = `/professionals/${profile.id}`;

  return (
    <PageContainer padded>
      <JsonLd
        data={buildProfessionalServiceJsonLd({
          id: profile.id,
          name,
          description: profile.headline ?? profile.bio,
          image: profile.profileImageUrl,
          city: profile.city,
          province: profile.province,
          // ProfessionalPublicProfileRecord deliberately doesn't expose
          // rating aggregates (see its own doc comment) — omitted here
          // rather than faked; `buildProfessionalServiceJsonLd` already
          // skips the `aggregateRating` block when `averageRating` is null.
          averageRating: null,
          reviewCount: 0,
          path,
        })}
      />
      <JsonLd
        data={buildBreadcrumbJsonLd([
          { name: "Inicio", path: "/" },
          { name: "Profesionales", path: "/professionals" },
          { name, path },
        ])}
      />

      <Link href="/professionals" className="text-sm text-foreground/70 hover:underline">
        ← Back to search
      </Link>

      <div className="flex items-start gap-5">
        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full bg-black/5">
          {profile.profileImageUrl && (
            <Image
              src={profile.profileImageUrl}
              alt=""
              width={80}
              height={80}
              className="h-20 w-20 object-cover"
            />
          )}
        </div>

        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">
            {profile.businessName ?? profile.displayName}
          </h1>
          {profile.headline && <p className="text-foreground/70">{profile.headline}</p>}
          <VerificationBadge verificationStatus={profile.verificationStatus} />
        </div>
      </div>

      {profile.bio && (
        <Section title="About" gap="sm">
          <p className="whitespace-pre-line text-sm text-foreground/80">{profile.bio}</p>
        </Section>
      )}

      <ResponsiveGrid cols="2" gap="md" bordered>
        {profile.yearsExperience !== null && (
          <div>
            <p className="text-foreground/60">Experience</p>
            <p className="font-medium">{profile.yearsExperience} years</p>
          </div>
        )}
        {profile.serviceRadiusKm !== null && (
          <div>
            <p className="text-foreground/60">Service area</p>
            <p className="font-medium">Within {profile.serviceRadiusKm} km</p>
          </div>
        )}
        {(profile.city || profile.province) && (
          <div>
            <p className="text-foreground/60">Based near</p>
            <p className="font-medium">
              {[profile.city, profile.province].filter(Boolean).join(", ")}
            </p>
          </div>
        )}
      </ResponsiveGrid>

      {categories.length > 0 && (
        <Section title="Services" gap="sm">
          <div className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <span
                key={category.id}
                className="rounded-full bg-black/5 px-3 py-1 text-xs text-foreground/70"
              >
                {category.name}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/*
        The only legitimate next step from a public profile, per this
        marketplace's own domain model: there is no "message this
        professional directly" or "book this exact professional" concept
        (see OpenConversationUseCase's own doc comment — a conversation can
        only open once a Quote already exists between the two of them, and
        quotes only ever exist on a PUBLISHED ServiceRequest). So the
        correct, already-existing path is Service Request -> discovery ->
        Quote: this link goes to the same "New service request" form every
        request already goes through (`/requests/new`), prefilled with
        this professional's primary category and city (see
        ServiceRequestForm's own `prefill` doc comment) purely to save
        re-typing — the resulting request is a normal PUBLISHED request,
        discoverable by every eligible professional (this one included, if
        they're actually within category/radius/status — the same rule
        Available Requests already enforces), not a targeted request only
        this professional can see.
      */}
      <section className="rounded-md border border-border bg-black/5 p-4">
        <p className="text-sm text-foreground/70">
          Ready to get started? Post a service request and {profile.businessName ?? profile.displayName}{" "}
          — along with every other eligible professional nearby — will be able to review it and send you a
          quote.
        </p>
        <Link
          href={{
            pathname: "/requests/new",
            query: {
              ...(profile.categoryIds[0] ? { categoryId: profile.categoryIds[0] } : {}),
              ...(profile.city ? { city: profile.city } : {}),
            },
          }}
          className="mt-3 inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Request this service
        </Link>
      </section>
    </PageContainer>
  );
}
