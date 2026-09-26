"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Section } from "@/components/layout/section";
import { changeSupportTicketStatusAction, closeSupportTicketAction, resolveSupportTicketAction } from "../actions";

const NEXT_STATUSES: Record<string, string[]> = {
  OPEN: ["IN_PROGRESS"],
  IN_PROGRESS: ["WAITING_FOR_USER"],
  WAITING_FOR_USER: ["IN_PROGRESS"],
};

export function AdminSupportTicketActions({ ticketId, status }: { ticketId: string; status: string }) {
  const router = useRouter();
  const t = useTranslations("admin");
  const enumLabel = (group: string, value: string) =>
    t.has(`${group}.${value}` as never) ? t(`${group}.${value}` as never) : value;
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function run(action: () => Promise<{ success: boolean; error?: string }>) {
    setIsSubmitting(true);
    setError(null);
    const result = await action();
    setIsSubmitting(false);
    if (!result.success) {
      setError(result.error ?? t("common.genericError"));
      return;
    }
    router.refresh();
  }

  const nextStatuses = NEXT_STATUSES[status] ?? [];
  const canResolve = status !== "CLOSED" && status !== "RESOLVED";
  const canClose = status === "RESOLVED";

  return (
    <Section title={t("supportTicketsPage.actions.title")} bordered aria-busy={isSubmitting}>
      {nextStatuses.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {nextStatuses.map((s) => (
            <Button key={s} type="button" variant="ghost" disabled={isSubmitting} onClick={() => run(() => changeSupportTicketStatusAction(ticketId, s))}>
              {t("supportTicketsPage.actions.moveTo", { status: enumLabel("supportTicketsPage.statuses", s) })}
            </Button>
          ))}
        </div>
      )}
      {canResolve && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="support-ticket-resolution-note">{t("supportTicketsPage.actions.resolutionNote")}</Label>
          <Textarea
            id="support-ticket-resolution-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder={t("supportTicketsPage.actions.resolutionNote")}
          />
          <Button
            type="button"
            className="w-fit"
            disabled={isSubmitting || note.trim().length === 0}
            onClick={() => run(() => resolveSupportTicketAction(ticketId, note))}
          >
            {t("supportTicketsPage.actions.resolve")}
          </Button>
        </div>
      )}
      {canClose && (
        <Button type="button" className="w-fit" disabled={isSubmitting} onClick={() => run(() => closeSupportTicketAction(ticketId))}>
          {t("supportTicketsPage.actions.close")}
        </Button>
      )}
      <div role="alert" aria-live="assertive">
        {error && <p className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>
    </Section>
  );
}
