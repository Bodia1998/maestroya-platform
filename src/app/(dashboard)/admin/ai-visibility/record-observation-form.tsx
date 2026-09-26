"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

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
  const t = useTranslations("admin.aiVisibility");
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
        setMessage({ kind: "success", text: t("form.success", { id: result.data.id }) });
      } else {
        setMessage({ kind: "error", text: result.error });
      }
    });
  }

  return (
    <section className="rounded-xl border border-border p-4">
      <h2 className="mb-3 text-sm font-medium">{t("form.title")}</h2>
      <p className="mb-4 text-xs text-muted-foreground">
        {t("form.intro")}
      </p>
      <form action={handleSubmit} className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          {t("form.query")}
          <select name="queryId" required className="rounded border border-border bg-background px-2 py-1">
            {activeQueries.map((q) => (
              <option key={q.id} value={q.id}>
                {q.id} — {q.text}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          {t("form.provider")}
          <select name="provider" className="rounded border border-border bg-background px-2 py-1">
            <option value="MANUAL">{t("provider.MANUAL")}</option>
            <option value="OPENAI_API">{t("provider.OPENAI_API")}</option>
            <option value="ANTHROPIC_API">{t("provider.ANTHROPIC_API")}</option>
            <option value="GOOGLE_API">{t("provider.GOOGLE_API")}</option>
            <option value="PERPLEXITY_API">{t("provider.PERPLEXITY_API")}</option>
            <option value="OTHER">{t("provider.OTHER")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          {t("form.providerModel")}
          <input name="providerModel" className="rounded border border-border bg-background px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1">
          {t("form.observedAt")}
          <input name="observedAt" type="datetime-local" required className="rounded border border-border bg-background px-2 py-1" />
        </label>
        <label className="flex items-center gap-2">
          <input name="mentioned" type="checkbox" /> {t("form.mentioned")}
        </label>
        <label className="flex flex-col gap-1">
          {t("form.recommendation")}
          <select name="recommendationClassification" className="rounded border border-border bg-background px-2 py-1">
            <option value="NOT_MENTIONED">{t("recommendation.NOT_MENTIONED")}</option>
            <option value="MENTIONED_ONLY">{t("recommendation.MENTIONED_ONLY")}</option>
            <option value="LISTED_AMONG_OPTIONS">{t("recommendation.LISTED_AMONG_OPTIONS")}</option>
            <option value="RECOMMENDED">{t("recommendation.RECOMMENDED")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          {t("form.identityAccuracy")}
          <select name="identityAccuracy" className="rounded border border-border bg-background px-2 py-1">
            <option value="NOT_APPLICABLE">{t("accuracy.NOT_APPLICABLE")}</option>
            <option value="CORRECT">{t("accuracy.CORRECT")}</option>
            <option value="INCORRECT">{t("accuracy.INCORRECT")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          {t("form.geographicAccuracy")}
          <select name="geographicAccuracy" className="rounded border border-border bg-background px-2 py-1">
            <option value="NOT_APPLICABLE">{t("accuracy.NOT_APPLICABLE")}</option>
            <option value="CORRECT">{t("accuracy.CORRECT")}</option>
            <option value="INCORRECT">{t("accuracy.INCORRECT")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          {t("form.serviceAccuracy")}
          <select name="serviceAccuracy" className="rounded border border-border bg-background px-2 py-1">
            <option value="NOT_APPLICABLE">{t("accuracy.NOT_APPLICABLE")}</option>
            <option value="CORRECT">{t("accuracy.CORRECT")}</option>
            <option value="INCORRECT">{t("accuracy.INCORRECT")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          {t("form.urlAccuracy")}
          <select name="urlAccuracy" className="rounded border border-border bg-background px-2 py-1">
            <option value="NOT_PROVIDED">{t("accuracy.NOT_PROVIDED")}</option>
            <option value="CORRECT">{t("accuracy.CORRECT")}</option>
            <option value="INCORRECT">{t("accuracy.INCORRECT")}</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input name="citationPresent" type="checkbox" /> {t("form.citationPresent")}
        </label>
        <label className="flex items-center gap-2">
          <input name="citationCorrect" type="checkbox" /> {t("form.citationCorrect")}
        </label>
        <label className="flex flex-col gap-1">
          {t("form.evidenceType")}
          <select name="evidenceType" className="rounded border border-border bg-background px-2 py-1">
            <option value="MANUAL_TRANSCRIPT_EXCERPT">{t("evidenceType.MANUAL_TRANSCRIPT_EXCERPT")}</option>
            <option value="MANUAL_SCREENSHOT_REFERENCE">{t("evidenceType.MANUAL_SCREENSHOT_REFERENCE")}</option>
            <option value="API_RESPONSE_REFERENCE">{t("evidenceType.API_RESPONSE_REFERENCE")}</option>
            <option value="EXTERNAL_ARTICLE_REFERENCE">{t("evidenceType.EXTERNAL_ARTICLE_REFERENCE")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          {t("form.evidenceReference")}
          <input name="evidenceReference" className="rounded border border-border bg-background px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          {t("form.detectedCompetitors")}
          <input name="detectedCompetitors" className="rounded border border-border bg-background px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          {t("form.factualIssues")}
          <input name="factualIssues" className="rounded border border-border bg-background px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          {t("form.evidenceExcerpt")}
          <textarea name="evidenceExcerpt" maxLength={1000} rows={3} className="rounded border border-border bg-background px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          {t("form.evaluatorNotes")}
          <textarea name="evaluatorNotes" maxLength={2000} rows={2} className="rounded border border-border bg-background px-2 py-1" />
        </label>
        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={isPending}
            className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {isPending ? t("form.submitting") : t("form.submit")}
          </button>
          {message ? (
            <p className={message.kind === "success" ? "mt-2 text-sm text-green-600" : "mt-2 text-sm text-destructive"}>{message.text}</p>
          ) : null}
        </div>
      </form>
    </section>
  );
}
