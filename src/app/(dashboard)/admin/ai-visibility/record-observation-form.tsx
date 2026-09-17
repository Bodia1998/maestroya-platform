"use client";

import { useState, useTransition } from "react";

import { AI_VISIBILITY_QUERIES } from "@/shared/content/ai-visibility-queries";
import { recordAiVisibilityObservationAction } from "./actions";

/**
 * Module 119 — AI Recommendation Monitoring: minimal manual-capture form.
 * Deliberately plain, uncontrolled-by-a-form-library inputs — this is an
 * internal, low-traffic admin tool (an evaluator captures a handful of
 * observations at a time), not a high-volume consumer form, so a small
 * hand-rolled `useState` form matches Phase 14's "no overbuild" instruction
 * rather than pulling in a form library for six-ish fields.
 *
 * Submits via the `recordAiVisibilityObservationAction` Server Action
 * (see `actions.ts`) — every field the evaluator provides here is
 * re-validated server-side (Zod) and re-checked against the query catalog
 * before anything is persisted; this component trusts none of its own
 * client-side state as the source of truth.
 */
export function RecordObservationForm() {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const activeQueries = AI_VISIBILITY_QUERIES.filter((q) => q.active);

  function handleSubmit(formData: FormData) {
    setMessage(null);
    const mentioned = formData.get("mentioned") === "on";
    const citationPresent = formData.get("citationPresent") === "on";
    const competitors = String(formData.get("detectedCompetitors") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const issues = String(formData.get("factualIssues") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const input = {
      queryId: String(formData.get("queryId") ?? ""),
      provider: String(formData.get("provider") ?? "MANUAL"),
      providerModel: String(formData.get("providerModel") ?? "").trim() || null,
      observedAt: String(formData.get("observedAt") ?? new Date().toISOString()),
      mentioned,
      identityAccuracy: String(formData.get("identityAccuracy") ?? "NOT_APPLICABLE"),
      geographicAccuracy: String(formData.get("geographicAccuracy") ?? "NOT_APPLICABLE"),
      serviceAccuracy: String(formData.get("serviceAccuracy") ?? "NOT_APPLICABLE"),
      urlAccuracy: String(formData.get("urlAccuracy") ?? "NOT_PROVIDED"),
      citationPresent,
      citationCorrect: citationPresent ? formData.get("citationCorrect") === "on" : null,
      recommendationClassification: String(formData.get("recommendationClassification") ?? (mentioned ? "MENTIONED_ONLY" : "NOT_MENTIONED")),
      detectedCompetitors: competitors,
      factualIssues: issues,
      evaluatorNotes: String(formData.get("evaluatorNotes") ?? "").trim() || null,
      evidenceType: String(formData.get("evidenceType") ?? "MANUAL_TRANSCRIPT_EXCERPT"),
      evidenceReference: String(formData.get("evidenceReference") ?? "").trim() || null,
      evidenceExcerpt: String(formData.get("evidenceExcerpt") ?? "").trim() || null,
    };

    startTransition(async () => {
      const result = await recordAiVisibilityObservationAction(input);
      if (result.success) {
        setMessage({ kind: "success", text: `Observation recorded (${result.data.id}).` });
      } else {
        setMessage({ kind: "error", text: result.error });
      }
    });
  }

  return (
    <section className="rounded-xl border border-border p-4">
      <h2 className="mb-3 text-sm font-medium">Record a manual observation</h2>
      <p className="mb-4 text-xs text-muted-foreground">
        Capture a response from an AI system outside this application (per the query text below), then record what you objectively observed. This
        never contacts any AI system on your behalf.
      </p>
      <form action={handleSubmit} className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          Query
          <select name="queryId" required className="rounded border border-border bg-background px-2 py-1">
            {activeQueries.map((q) => (
              <option key={q.id} value={q.id}>
                {q.id} — {q.text}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Provider
          <select name="provider" className="rounded border border-border bg-background px-2 py-1">
            <option value="MANUAL">Manual capture</option>
            <option value="OPENAI_API">OpenAI (official API)</option>
            <option value="ANTHROPIC_API">Anthropic (official API)</option>
            <option value="GOOGLE_API">Google (official API)</option>
            <option value="PERPLEXITY_API">Perplexity (official API)</option>
            <option value="OTHER">Other (name in notes)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Provider model/version (optional)
          <input name="providerModel" className="rounded border border-border bg-background px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1">
          Observed at
          <input name="observedAt" type="datetime-local" required className="rounded border border-border bg-background px-2 py-1" />
        </label>
        <label className="flex items-center gap-2">
          <input name="mentioned" type="checkbox" /> MaestroYa mentioned
        </label>
        <label className="flex flex-col gap-1">
          Recommendation classification
          <select name="recommendationClassification" className="rounded border border-border bg-background px-2 py-1">
            <option value="NOT_MENTIONED">Not mentioned</option>
            <option value="MENTIONED_ONLY">Mentioned only</option>
            <option value="LISTED_AMONG_OPTIONS">Listed among options</option>
            <option value="RECOMMENDED">Recommended</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Identity accuracy
          <select name="identityAccuracy" className="rounded border border-border bg-background px-2 py-1">
            <option value="NOT_APPLICABLE">Not applicable</option>
            <option value="CORRECT">Correct</option>
            <option value="INCORRECT">Incorrect</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Geographic accuracy
          <select name="geographicAccuracy" className="rounded border border-border bg-background px-2 py-1">
            <option value="NOT_APPLICABLE">Not applicable</option>
            <option value="CORRECT">Correct</option>
            <option value="INCORRECT">Incorrect</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Service accuracy
          <select name="serviceAccuracy" className="rounded border border-border bg-background px-2 py-1">
            <option value="NOT_APPLICABLE">Not applicable</option>
            <option value="CORRECT">Correct</option>
            <option value="INCORRECT">Incorrect</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          URL accuracy
          <select name="urlAccuracy" className="rounded border border-border bg-background px-2 py-1">
            <option value="NOT_PROVIDED">Not provided</option>
            <option value="CORRECT">Correct</option>
            <option value="INCORRECT">Incorrect</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input name="citationPresent" type="checkbox" /> Citation present
        </label>
        <label className="flex items-center gap-2">
          <input name="citationCorrect" type="checkbox" /> Citation correct (only if present)
        </label>
        <label className="flex flex-col gap-1">
          Evidence type
          <select name="evidenceType" className="rounded border border-border bg-background px-2 py-1">
            <option value="MANUAL_TRANSCRIPT_EXCERPT">Manual transcript excerpt</option>
            <option value="MANUAL_SCREENSHOT_REFERENCE">Manual screenshot reference</option>
            <option value="API_RESPONSE_REFERENCE">API response reference</option>
            <option value="EXTERNAL_ARTICLE_REFERENCE">External article reference</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Evidence reference (URL/filename)
          <input name="evidenceReference" className="rounded border border-border bg-background px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          Detected competitors (comma-separated)
          <input name="detectedCompetitors" className="rounded border border-border bg-background px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          Factual issues observed (comma-separated)
          <input name="factualIssues" className="rounded border border-border bg-background px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          Evidence excerpt (short, optional — never a full transcript)
          <textarea name="evidenceExcerpt" maxLength={1000} rows={3} className="rounded border border-border bg-background px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          Evaluator notes (optional)
          <textarea name="evaluatorNotes" maxLength={2000} rows={2} className="rounded border border-border bg-background px-2 py-1" />
        </label>
        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={isPending}
            className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {isPending ? "Recording…" : "Record observation"}
          </button>
          {message ? (
            <p className={message.kind === "success" ? "mt-2 text-sm text-green-600" : "mt-2 text-sm text-destructive"}>{message.text}</p>
          ) : null}
        </div>
      </form>
    </section>
  );
}
