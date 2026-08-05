"use client";

import { useRouter } from "next/navigation";
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
      <FormSection title="Open a new ticket">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ticket-category">
            Category <RequiredBadge />
          </Label>
          <Select
            id="ticket-category"
            className="sm:max-w-xs"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ticket-subject">
            Subject <RequiredBadge />
          </Label>
          <Input id="ticket-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ticket-description">
            Description <RequiredBadge />
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
          {isSubmitting ? "Submitting…" : "Submit ticket"}
        </Button>
      </FormSection>
    </div>
  );
}
