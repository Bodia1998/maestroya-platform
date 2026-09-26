"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormSection } from "@/components/forms/form-section";
import { RequiredBadge } from "@/components/forms/field-badges";
import { createSupportTicketAction } from "./actions";

const CATEGORIES = ["ACCOUNT", "VERIFICATION", "BUG", "LOGIN", "GENERAL", "OTHER"];

export function NewSupportTicketForm() {
  const router = useRouter();
  const t = useTranslations("customer.support");
  const [category, setCategory] = useState<string>(CATEGORIES[0] ?? "OTHER");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setIsSubmitting(true);
    setError(null);
    const result = await createSupportTicketAction({ category, subject, description });
    setIsSubmitting(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setSubject("");
    setDescription("");
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-border p-4 sm:p-6">
      <FormSection title={t("form.title")}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ticket-category">
            {t("form.category")} <RequiredBadge />
          </Label>
          <Select
            id="ticket-category"
            className="sm:max-w-xs"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`category.${c}` as never)}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ticket-subject">
            {t("form.subject")} <RequiredBadge />
          </Label>
          <Input id="ticket-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ticket-description">
            {t("form.description")} <RequiredBadge />
          </Label>
          <Textarea
            id="ticket-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
          />
        </div>

        {error && (
          <Alert variant="danger" role="alert">
            {error}
          </Alert>
        )}

        <Button type="button" disabled={isSubmitting} onClick={handleSubmit} className="w-full sm:w-auto">
          {isSubmitting ? t("form.submitting") : t("form.submit")}
        </Button>
      </FormSection>
    </div>
  );
}
