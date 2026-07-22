import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { prisma } from "@/infrastructure/database/prisma/client";
import { NotFoundError } from "@/domain/errors/domain-error";
import { makeGetProfessionalPublicProfileUseCase } from "@/application/use-cases/discovery/compose";
import { VerificationBadge } from "../verification-badge";

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
export default async function PublicProfessionalProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let profile;
  try {
    profile = await makeGetProfessionalPublicProfileUseCase().execute(id);
  } catch (error) {
    if (error instanceof NotFoundError) {
      notFound();
    }
    throw error;
  }

  const categories = profile.categoryIds.length
    ? await prisma.serviceCategory.findMany({
        where: { id: { in: profile.categoryIds } },
        select: { id: true, name: true },
      })
    : [];

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
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
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-medium">About</h2>
          <p className="whitespace-pre-line text-sm text-foreground/80">{profile.bio}</p>
        </section>
      )}

      <section className="grid grid-cols-2 gap-4 rounded-md border border-border p-4 text-sm">
        {profile.yearsExperience !== null && (
          <div>
            <p className="text-foreground/60">Experience</p>
            <p className="font-medium">{profile.yearsExperience} years</p>
          </div>
        )}
        {profile.hourlyRate !== null && (
          <div>
            <p className="text-foreground/60">Hourly rate</p>
            <p className="font-medium">€{profile.hourlyRate.toFixed(2)}</p>
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
      </section>

      {categories.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-medium">Services</h2>
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
        </section>
      )}
    </div>
  );
}
