"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MapPin } from "lucide-react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FormActions } from "@/components/forms/form-actions";
import { FormFieldError } from "@/components/forms/form-field-description";
import { FormSection } from "@/components/forms/form-section";
import { OptionalBadge } from "@/components/forms/field-badges";
import { updateProfileSchema, type UpdateProfileInput } from "@/application/dto/profile.dto";
import { updateProfileAction } from "./actions";

interface Language {
  id: string;
  name: string;
  nativeName: string;
}

interface AddressLike {
  line1: string;
  line2: string | null;
  city: string;
  province: string | null;
  postalCode: string;
  country: string;
}

interface ProfileLike {
  name: string | null;
  phone: string | null;
  timezone: string | null;
  preferredLanguageId: string | null;
  notificationPreferences: Record<string, unknown> | null;
}

export function EditProfileForm({
  profile,
  address,
  languages,
}: {
  profile: ProfileLike;
  address: AddressLike | null;
  languages: Language[];
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const timezones = useMemo(() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return ["UTC", "Europe/Madrid"];
    }
  }, []);

  const notificationPrefs = profile.notificationPreferences as
    | { emailMarketing?: boolean; emailServiceUpdates?: boolean; smsAppointmentReminders?: boolean }
    | null;

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: {
      name: profile.name ?? "",
      phone: profile.phone ?? "",
      timezone: profile.timezone ?? "Europe/Madrid",
      preferredLanguageId: profile.preferredLanguageId ?? "",
      address: address
        ? {
            line1: address.line1,
            line2: address.line2 ?? "",
            city: address.city,
            province: address.province ?? "",
            postalCode: address.postalCode,
            country: address.country,
          }
        : { line1: "", city: "", postalCode: "", country: "ES" },
      notificationPreferences: {
        emailMarketing: notificationPrefs?.emailMarketing ?? true,
        emailServiceUpdates: notificationPrefs?.emailServiceUpdates ?? true,
        smsAppointmentReminders: notificationPrefs?.smsAppointmentReminders ?? true,
      },
    },
  });

  async function onSubmit(data: UpdateProfileInput) {
    setServerError(null);
    setSuccessMessage(null);
    const result = await updateProfileAction(data);

    if (!result.success) {
      setServerError(result.error);
      if (result.fieldErrors) {
        for (const [field, messages] of Object.entries(result.fieldErrors)) {
          if (messages?.[0]) {
            setError(field as keyof UpdateProfileInput, { message: messages[0] });
          }
        }
      }
      return;
    }

    setSuccessMessage("Profile updated.");
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

      <FormSection title="Basics">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Display name</Label>
          <Input
            id="name"
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? "name-error" : undefined}
            {...register("name")}
          />
          <FormFieldError id="name-error">{errors.name?.message}</FormFieldError>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="phone">
            Phone <OptionalBadge />
          </Label>
          <Input
            id="phone"
            type="tel"
            aria-invalid={!!errors.phone}
            aria-describedby={errors.phone ? "phone-error" : undefined}
            {...register("phone")}
          />
          <FormFieldError id="phone-error">{errors.phone?.message}</FormFieldError>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="timezone">Timezone</Label>
            <Select id="timezone" {...register("timezone")}>
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="preferredLanguageId">Preferred language</Label>
            <Select id="preferredLanguageId" {...register("preferredLanguageId")}>
              <option value="">No preference</option>
              {languages.map((lang) => (
                <option key={lang.id} value={lang.id}>
                  {lang.nativeName}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </FormSection>

      <FormSection title="Address">
        <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <legend className="flex items-center gap-1.5 px-1 text-sm font-medium text-foreground">
            <MapPin aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
            Address
          </legend>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="address.line1" className="sr-only">
              Street address
            </Label>
            <Input
              id="address.line1"
              placeholder="Street address"
              aria-invalid={!!errors.address?.line1}
              aria-describedby={errors.address?.line1 ? "address.line1-error" : undefined}
              {...register("address.line1")}
            />
            <FormFieldError id="address.line1-error">{errors.address?.line1?.message}</FormFieldError>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="address.line2" className="sr-only">
              Apartment, floor, etc. (optional)
            </Label>
            <Input id="address.line2" placeholder="Apartment, floor, etc. (optional)" {...register("address.line2")} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="address.city" className="sr-only">
                City
              </Label>
              <Input
                id="address.city"
                placeholder="City"
                aria-invalid={!!errors.address?.city}
                {...register("address.city")}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="address.postalCode" className="sr-only">
                Postal code
              </Label>
              <Input id="address.postalCode" placeholder="Postal code" {...register("address.postalCode")} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="address.province" className="sr-only">
                Province
              </Label>
              <Input id="address.province" placeholder="Province" {...register("address.province")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="address.country" className="sr-only">
                Country
              </Label>
              <Input id="address.country" placeholder="Country" {...register("address.country")} />
            </div>
          </div>
        </fieldset>
      </FormSection>

      <FormSection title="Notifications">
        <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-4">
          <legend className="sr-only">Notifications</legend>
          <label className="flex min-h-11 items-center gap-2 text-sm text-foreground">
            <Checkbox {...register("notificationPreferences.emailMarketing")} />
            Marketing emails
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm text-foreground">
            <Checkbox {...register("notificationPreferences.emailServiceUpdates")} />
            Service update emails
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm text-foreground">
            <Checkbox {...register("notificationPreferences.smsAppointmentReminders")} />
            SMS appointment reminders
          </label>
        </fieldset>
      </FormSection>

      <FormActions stickyOnMobile>
        <Button type="submit" disabled={isSubmitting} className="sm:min-w-40">
          {isSubmitting ? "Saving…" : "Save changes"}
        </Button>
      </FormActions>
    </form>
  );
}
