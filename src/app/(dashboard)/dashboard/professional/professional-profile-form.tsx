"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import {
  createProfessionalSchema,
  updateProfessionalSchema,
  type CreateProfessionalInput,
  type UpdateProfessionalInput,
} from "@/application/dto/professional.dto";
import { createProfessionalAction, updateProfessionalAction } from "./actions";

interface ProfessionalLike {
  businessName: string | null;
  bio: string | null;
  headline: string | null;
  yearsExperience: number | null;
  serviceRadiusKm: number | null;
  contactEmail: string | null;
  contactPhone: string | null;
  websiteUrl: string | null;
  taxId: string | null;
  isAcceptingRequests: boolean;
}

/**
 * Handles both "create my professional profile" (no existing profile yet)
 * and "edit my professional profile" (one already exists) with the same
 * field set, mirroring how EditProfileForm in the Profile module is one
 * form component rather than two near-duplicates. `status` and
 * `verificationStatus` are never part of this form — see professional.dto.ts.
 */
export function ProfessionalProfileForm({ professional }: { professional: ProfessionalLike | null }) {
  const isEditing = professional !== null;
  const { update } = useSession();
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const schema = isEditing ? updateProfessionalSchema : createProfessionalSchema;

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateProfessionalInput | UpdateProfessionalInput>({
    resolver: zodResolver(schema),
    defaultValues: {
      businessName: professional?.businessName ?? "",
      headline: professional?.headline ?? "",
      bio: professional?.bio ?? "",
      yearsExperience: professional?.yearsExperience ?? undefined,
      serviceRadiusKm: professional?.serviceRadiusKm ?? undefined,
      contactEmail: professional?.contactEmail ?? "",
      contactPhone: professional?.contactPhone ?? "",
      websiteUrl: professional?.websiteUrl ?? "",
      taxId: professional?.taxId ?? "",
      ...(isEditing ? { isAcceptingRequests: professional.isAcceptingRequests } : {}),
    },
  });

  async function onSubmit(data: CreateProfessionalInput | UpdateProfessionalInput) {
    setServerError(null);
    setSuccessMessage(null);

    const result = isEditing
      ? await updateProfessionalAction(data)
      : await createProfessionalAction(data);

    if (!result.success) {
      setServerError(result.error);
      if (result.fieldErrors) {
        for (const [field, messages] of Object.entries(result.fieldErrors)) {
          if (messages?.[0]) {
            setError(field as keyof (CreateProfessionalInput | UpdateProfessionalInput), {
              message: messages[0],
            });
          }
        }
      }
      return;
    }

    // First-time creation is the activation event (see
    // PrismaProfessionalRepository.create) — the PROVIDER role was just
    // assigned server-side, but this browser's existing session/JWT was
    // minted before that happened. `update()` is Auth.js's own documented
    // mechanism for this: it re-invokes the `jwt` callback with
    // `trigger === "update"`, which already re-reads `token.roles` from the
    // database (see auth-config.ts) — no new session-refresh mechanism
    // needed. Not called on the edit path: editing an existing profile
    // never changes roles.
    if (!isEditing) {
      await update();
      // Standard Next.js router refresh (not a custom session mechanism) —
      // re-fetches the current route's Server Components (the (dashboard)
      // layout's sidebar and this page) so they reflect the just-updated
      // session on this same render, without a logout/login round-trip.
      router.refresh();
    }

    setSuccessMessage(isEditing ? "Professional profile updated." : "Professional profile created.");
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
      {serverError && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {serverError}
        </p>
      )}
      {successMessage && (
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
          {successMessage}
        </p>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="businessName" className="text-sm font-medium">
          Business name (optional)
        </label>
        <input
          id="businessName"
          className="h-10 rounded-md border border-border px-3 text-sm"
          {...register("businessName")}
        />
        {errors.businessName && (
          <p className="text-xs text-red-600">{errors.businessName.message}</p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="headline" className="text-sm font-medium">
          Headline
        </label>
        <input
          id="headline"
          placeholder="e.g. Licensed electrician, 10+ years"
          className="h-10 rounded-md border border-border px-3 text-sm"
          {...register("headline")}
        />
        {errors.headline && <p className="text-xs text-red-600">{errors.headline.message}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="bio" className="text-sm font-medium">
          Description
        </label>
        <textarea
          id="bio"
          rows={4}
          className="rounded-md border border-border px-3 py-2 text-sm"
          {...register("bio")}
        />
        {errors.bio && <p className="text-xs text-red-600">{errors.bio.message}</p>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="yearsExperience" className="text-sm font-medium">
            Years of experience
          </label>
          <input
            id="yearsExperience"
            type="number"
            min={0}
            className="h-10 rounded-md border border-border px-3 text-sm"
            {...register("yearsExperience")}
          />
          {errors.yearsExperience && (
            <p className="text-xs text-red-600">{errors.yearsExperience.message}</p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="serviceRadiusKm" className="text-sm font-medium">
            Service radius (km)
          </label>
          <input
            id="serviceRadiusKm"
            type="number"
            min={0}
            className="h-10 rounded-md border border-border px-3 text-sm"
            {...register("serviceRadiusKm")}
          />
          {errors.serviceRadiusKm && (
            <p className="text-xs text-red-600">{errors.serviceRadiusKm.message}</p>
          )}
        </div>
      </div>

      <fieldset className="flex flex-col gap-3 rounded-md border border-border p-4">
        <legend className="px-1 text-sm font-medium">Contact information</legend>
        <input
          className="h-10 rounded-md border border-border px-3 text-sm"
          placeholder="Contact email"
          {...register("contactEmail")}
        />
        {errors.contactEmail && (
          <p className="text-xs text-red-600">{errors.contactEmail.message}</p>
        )}
        <input
          className="h-10 rounded-md border border-border px-3 text-sm"
          placeholder="Contact phone"
          {...register("contactPhone")}
        />
        {errors.contactPhone && (
          <p className="text-xs text-red-600">{errors.contactPhone.message}</p>
        )}
        <input
          className="h-10 rounded-md border border-border px-3 text-sm"
          placeholder="Website URL"
          {...register("websiteUrl")}
        />
        {errors.websiteUrl && (
          <p className="text-xs text-red-600">{errors.websiteUrl.message}</p>
        )}
        <input
          className="h-10 rounded-md border border-border px-3 text-sm"
          placeholder="Tax ID (NIF/CIF, optional)"
          {...register("taxId")}
        />
        {errors.taxId && <p className="text-xs text-red-600">{errors.taxId.message}</p>}
      </fieldset>

      {isEditing && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" {...register("isAcceptingRequests")} />
          Currently accepting new requests
        </label>
      )}

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving…" : isEditing ? "Save changes" : "Create professional profile"}
      </Button>
    </form>
  );
}
