"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
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
        <label htmlFor="name" className="text-sm font-medium">
          Display name
        </label>
        <input
          id="name"
          className="h-10 rounded-md border border-border px-3 text-sm"
          {...register("name")}
        />
        {errors.name && <p className="text-xs text-red-600">{errors.name.message}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="phone" className="text-sm font-medium">
          Phone
        </label>
        <input
          id="phone"
          type="tel"
          className="h-10 rounded-md border border-border px-3 text-sm"
          {...register("phone")}
        />
        {errors.phone && <p className="text-xs text-red-600">{errors.phone.message}</p>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="timezone" className="text-sm font-medium">
            Timezone
          </label>
          <select
            id="timezone"
            className="h-10 rounded-md border border-border px-3 text-sm"
            {...register("timezone")}
          >
            {timezones.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="preferredLanguageId" className="text-sm font-medium">
            Preferred language
          </label>
          <select
            id="preferredLanguageId"
            className="h-10 rounded-md border border-border px-3 text-sm"
            {...register("preferredLanguageId")}
          >
            <option value="">No preference</option>
            {languages.map((lang) => (
              <option key={lang.id} value={lang.id}>
                {lang.nativeName}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className="flex flex-col gap-3 rounded-md border border-border p-4">
        <legend className="px-1 text-sm font-medium">Address</legend>
        <input
          className="h-10 rounded-md border border-border px-3 text-sm"
          placeholder="Street address"
          {...register("address.line1")}
        />
        {errors.address?.line1 && (
          <p className="text-xs text-red-600">{errors.address.line1.message}</p>
        )}
        <input
          className="h-10 rounded-md border border-border px-3 text-sm"
          placeholder="Apartment, floor, etc. (optional)"
          {...register("address.line2")}
        />
        <div className="grid grid-cols-2 gap-3">
          <input
            className="h-10 rounded-md border border-border px-3 text-sm"
            placeholder="City"
            {...register("address.city")}
          />
          <input
            className="h-10 rounded-md border border-border px-3 text-sm"
            placeholder="Postal code"
            {...register("address.postalCode")}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <input
            className="h-10 rounded-md border border-border px-3 text-sm"
            placeholder="Province"
            {...register("address.province")}
          />
          <input
            className="h-10 rounded-md border border-border px-3 text-sm"
            placeholder="Country"
            {...register("address.country")}
          />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2 rounded-md border border-border p-4">
        <legend className="px-1 text-sm font-medium">Notifications</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" {...register("notificationPreferences.emailMarketing")} />
          Marketing emails
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            {...register("notificationPreferences.emailServiceUpdates")}
          />
          Service update emails
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            {...register("notificationPreferences.smsAppointmentReminders")}
          />
          SMS appointment reminders
        </label>
      </fieldset>

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
