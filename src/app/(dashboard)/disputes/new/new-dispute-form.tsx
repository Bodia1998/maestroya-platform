"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
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
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Job ID
        <input
          value={jobId}
          onChange={(e) => setJobId(e.target.value)}
          className="rounded-md border border-border px-3 py-2 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Reason
        <select value={reason} onChange={(e) => setReason(e.target.value)} className="rounded-md border border-border px-3 py-2 text-sm">
          {REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Title
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="rounded-md border border-border px-3 py-2 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Description
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
          className="rounded-md border border-border px-3 py-2 text-sm"
        />
      </label>
      {error && (
        <p role="alert" className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <Button type="button" disabled={isSubmitting} onClick={handleSubmit}>
        {isSubmitting ? "Submitting…" : "Open dispute"}
      </Button>
    </div>
  );
}
