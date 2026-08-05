"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FormActions } from "@/components/forms/form-actions";
import { FormFieldError } from "@/components/forms/form-field-description";
import { FormSection } from "@/components/forms/form-section";
import { OptionalBadge, RequiredBadge } from "@/components/forms/field-badges";
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
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-8" noValidate>
      {serverError && (
        <Alert variant="danger" role="alert">
          {serverError}
        </Alert>
      )}
      {successMessage && (
        <Alert variant="success" role="status">
          {successMessage}
        </Alert>
      )}

      <FormSection title="About your business">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="businessName">
            Business name <OptionalBadge />
          </Label>
          <Input id="businessName" aria-invalid={!!errors.businessName} {...register("businessName")} />
          <FormFieldError>{errors.businessName?.message}</FormFieldError>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="headline">
            Headline <RequiredBadge />
          </Label>
          <Input
            id="headline"
            placeholder="e.g. Licensed electrician, 10+ years"
            aria-invalid={!!errors.headline}
            {...register("headline")}
          />
          <FormFieldError>{errors.headline?.message}</FormFieldError>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bio">
            Description <RequiredBadge />
          </Label>
          <Textarea id="bio" rows={4} aria-invalid={!!errors.bio} {...register("bio")} />
          <FormFieldError>{errors.bio?.message}</FormFieldError>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="yearsExperience">
              Years of experience <OptionalBadge />
            </Label>
            <Input
              id="yearsExperience"
              type="number"
              min={0}
              aria-invalid={!!errors.yearsExperience}
              {...register("yearsExperience")}
            />
            <FormFieldError>{errors.yearsExperience?.message}</FormFieldError>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="serviceRadiusKm">
              Service radius (km) <OptionalBadge />
            </Label>
            <Input
              id="serviceRadiusKm"
              type="number"
              min={0}
              aria-invalid={!!errors.serviceRadiusKm}
              {...register("serviceRadiusKm")}
            />
            <FormFieldError>{errors.serviceRadiusKm?.message}</FormFieldError>
          </div>
        </div>
      </FormSection>

      <FormSection title="Contact information">
        <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <legend className="sr-only">Contact information</legend>
          <div className="flex flex-col gap-1.5">
            <Input placeholder="Contact email" aria-invalid={!!errors.contactEmail} {...register("contactEmail")} />
            <FormFieldError>{errors.contactEmail?.message}</FormFieldError>
          </div>
          <div className="flex flex-col gap-1.5">
            <Input placeholder="Contact phone" aria-invalid={!!errors.contactPhone} {...register("contactPhone")} />
            <FormFieldError>{errors.contactPhone?.message}</FormFieldError>
          </div>
          <div className="flex flex-col gap-1.5">
            <Input placeholder="Website URL" aria-invalid={!!errors.websiteUrl} {...register("websiteUrl")} />
            <FormFieldError>{errors.websiteUrl?.message}</FormFieldError>
          </div>
          <div className="flex flex-col gap-1.5">
            <Input placeholder="Tax ID (NIF/CIF, optional)" aria-invalid={!!errors.taxId} {...register("taxId")} />
            <FormFieldError>{errors.taxId?.message}</FormFieldError>
          </div>
        </fieldset>
      </FormSection>

      {isEditing && (
        <FormSection title="Availability">
          <label className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-border px-4 py-2">
            <span className="text-sm font-medium text-foreground">Currently accepting new requests</span>
            <Switch {...register("isAcceptingRequests")} />
          </label>
        </FormSection>
      )}

      <FormActions stickyOnMobile>
        <Button type="submit" disabled={isSubmitting} className="sm:min-w-48">
          {isSubmitting ? "Saving…" : isEditing ? "Save changes" : "Create professional profile"}
        </Button>
      </FormActions>
    </form>
  );
}
