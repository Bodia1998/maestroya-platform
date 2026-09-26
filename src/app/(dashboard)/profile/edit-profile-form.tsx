"use client";

import { MapPin } from "lucide-react";
import { useTranslations } from "next-intl";
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
import { useLocalizedZodResolver } from "@/hooks/use-localized-errors";
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
  const t = useTranslations("profile.form");
  const tCommon = useTranslations("common");
  const resolver = useLocalizedZodResolver(updateProfileSchema);
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
    resolver,
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

    setSuccessMessage(t("updated"));
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

      <FormSection title={t("basics")}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">{t("displayName")}</Label>
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
            {t("phone")} <OptionalBadge />
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
            <Label htmlFor="timezone">{t("timezone")}</Label>
            <Select id="timezone" {...register("timezone")}>
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="preferredLanguageId">{t("preferredLanguage")}</Label>
            <Select id="preferredLanguageId" {...register("preferredLanguageId")}>
              <option value="">{t("noPreference")}</option>
              {languages.map((lang) => (
                <option key={lang.id} value={lang.id}>
                  {lang.nativeName}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </FormSection>

      <FormSection title={t("address")}>
        <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <legend className="flex items-center gap-1.5 px-1 text-sm font-medium text-foreground">
            <MapPin aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
            {t("address")}
          </legend>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="address.line1" className="sr-only">
              {t("street")}
            </Label>
            <Input
              id="address.line1"
              placeholder={t("street")}
              aria-invalid={!!errors.address?.line1}
              aria-describedby={errors.address?.line1 ? "address.line1-error" : undefined}
              {...register("address.line1")}
            />
            <FormFieldError id="address.line1-error">{errors.address?.line1?.message}</FormFieldError>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="address.line2" className="sr-only">
              {t("line2")}
            </Label>
            <Input id="address.line2" placeholder={t("line2")} {...register("address.line2")} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="address.city" className="sr-only">
                {t("city")}
              </Label>
              <Input
                id="address.city"
                placeholder={t("city")}
                aria-invalid={!!errors.address?.city}
                {...register("address.city")}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="address.postalCode" className="sr-only">
                {t("postalCode")}
              </Label>
              <Input id="address.postalCode" placeholder={t("postalCode")} {...register("address.postalCode")} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="address.province" className="sr-only">
                {t("province")}
              </Label>
              <Input id="address.province" placeholder={t("province")} {...register("address.province")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="address.country" className="sr-only">
                {t("country")}
              </Label>
              <Input id="address.country" placeholder={t("country")} {...register("address.country")} />
            </div>
          </div>
        </fieldset>
      </FormSection>

      <FormSection title={t("notifications")}>
        <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-4">
          <legend className="sr-only">{t("notifications")}</legend>
          <label className="flex min-h-11 items-center gap-2 text-sm text-foreground">
            <Checkbox {...register("notificationPreferences.emailMarketing")} />
            {t("emailMarketing")}
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm text-foreground">
            <Checkbox {...register("notificationPreferences.emailServiceUpdates")} />
            {t("emailServiceUpdates")}
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm text-foreground">
            <Checkbox {...register("notificationPreferences.smsAppointmentReminders")} />
            {t("smsAppointmentReminders")}
          </label>
        </fieldset>
      </FormSection>

      <FormActions stickyOnMobile>
        <Button type="submit" disabled={isSubmitting} className="sm:min-w-40">
          {isSubmitting ? tCommon("states.saving") : t("save")}
        </Button>
      </FormActions>
    </form>
  );
}
