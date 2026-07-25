"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
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
    <div className="flex flex-col gap-3 rounded-md border border-border p-4">
      <h2 className="text-sm font-semibold">Open a new ticket</h2>
      <label className="flex flex-col gap-1 text-sm">
        Category
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-md border border-border px-3 py-2 text-sm">
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Subject
        <input value={subject} onChange={(e) => setSubject(e.target.value)} className="rounded-md border border-border px-3 py-2 text-sm" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Description
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          className="rounded-md border border-border px-3 py-2 text-sm"
        />
      </label>
      {error && (
        <p role="alert" className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <Button type="button" disabled={isSubmitting} onClick={handleSubmit}>
        {isSubmitting ? "Submitting…" : "Submit ticket"}
      </Button>
    </div>
  );
}
