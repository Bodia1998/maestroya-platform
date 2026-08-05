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
import { createDisputeAction } from "../actions";

const REASONS = [
  "SERVICE_NOT_COMPLETED",
  "SERVICE_QUALITY",
  "PROPERTY_DAMAGE",
  "PROFESSIONAL_NO_SHOW",
  "CUSTOMER_NO_SHOW",
  "PRICE_DISAGREEMENT",
  "SCOPE_OF_WORK",
  "COMMUNICATION_ISSUE",
  "OTHER",
];

export function NewDisputeForm({ initialJobId }: { initialJobId: string }) {
  const router = useRouter();
  const [jobId, setJobId] = useState(initialJobId);
  const [reason, setReason] = useState<string>(REASONS[0] ?? "OTHER");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setIsSubmitting(true);
    setError(null);
    const result = await createDisputeAction({ jobId, reason, title, description });
    setIsSubmitting(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    router.push(`/disputes/${result.data.id}`);
  }

  return (
    <FormSection title="Open a dispute" description="Give as much detail as possible — this helps us resolve it faster.">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="dispute-jobId">
          Job ID <RequiredBadge />
        </Label>
        <Input id="dispute-jobId" value={jobId} onChange={(e) => setJobId(e.target.value)} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="dispute-reason">
          Reason <RequiredBadge />
        </Label>
        <Select id="dispute-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
          {REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="dispute-title">
          Title <RequiredBadge />
        </Label>
        <Input id="dispute-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="dispute-description">
          Description <RequiredBadge />
        </Label>
        <Textarea
          id="dispute-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
        />
      </div>

      {error && (
        <Alert variant="danger" role="alert">
          {error}
        </Alert>
      )}

      <Button type="button" disabled={isSubmitting} onClick={handleSubmit} className="w-full sm:w-auto">
        {isSubmitting ? "Submitting…" : "Open dispute"}
      </Button>
    </FormSection>
  );
}
