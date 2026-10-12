"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import {
  decideLeadClaimAction,
  imposeLeadAbuseBlockAction,
  liftLeadAbuseDecisionAction,
  revokeLeadPurchaseAction,
  startLeadClaimReviewAction,
  type LeadAdminActionResult,
} from "../actions";

/**
 * Module 157 — the console's mutation controls. PRESENTATION ONLY: each control collects the operator's reason, asks for
 * confirmation and forwards to a Server Action. None of them decides whether an action is allowed — the Server Action
 * (`requireRole`) and the M154/M155/M156 use case behind it are the only authority, and they re-check everything (state, ownership,
 * separation of duties). Whether a control is rendered is a convenience, never an authorization mechanism.
 *
 * Every control sends only ids and the typed reason: no actor, no role, no status. A stale view is therefore safe — the use case
 * judges the CURRENT persisted state and answers "invalid state" if the row has moved.
 */

function useSubmit() {
  const router = useRouter();
  return React.useCallback(
    async (run: () => Promise<LeadAdminActionResult>, ok: string, failed: string) => {
      const result = await run();
      if (result.success) {
        toast.success(ok);
        router.refresh();
        return { success: true as const };
      }
      toast.error(failed, { description: result.error });
      return { success: false as const, error: result.error };
    },
    [router],
  );
}

export function StartClaimReviewButton({ claimId }: { claimId: string }) {
  const t = useTranslations("admin.leadOps.actions.startReview");
  const submit = useSubmit();
  const [pending, setPending] = React.useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await submit(() => startLeadClaimReviewAction(claimId), t("success"), t("failed"));
        setPending(false);
      }}
    >
      {pending ? t("pending") : t("trigger")}
    </Button>
  );
}

export function DecideClaimDialog({ claimId, decision }: { claimId: string; decision: "APPROVED" | "REJECTED" }) {
  const t = useTranslations("admin.leadOps.actions.decideClaim");
  const submit = useSubmit();
  const [explanation, setExplanation] = React.useState("");
  const id = `claim-explanation-${claimId}-${decision}`;
  return (
    <ConfirmDialog
      triggerLabel={t(decision === "APPROVED" ? "approve" : "reject")}
      triggerVariant="outline"
      title={t(decision === "APPROVED" ? "approveTitle" : "rejectTitle")}
      description={t("description")}
      destructive={decision === "REJECTED"}
      confirmLabel={t("confirm")}
      pendingLabel={t("pending")}
      onOpenChange={(open) => {
        if (!open) setExplanation("");
      }}
      onConfirm={async () => {
        if (explanation.trim().length < 1) return { success: false, error: t("explanationRequired") };
        return submit(() => decideLeadClaimAction({ claimId, decision, explanation }), t("success"), t("failed"));
      }}
    >
      <div className="flex flex-col gap-1 py-2">
        <Label htmlFor={id}>{t("explanationLabel")}</Label>
        <Textarea id={id} value={explanation} maxLength={1000} onChange={(e) => setExplanation(e.target.value)} />
      </div>
    </ConfirmDialog>
  );
}

export function RevokePurchaseDialog({ leadPurchaseId }: { leadPurchaseId: string }) {
  const t = useTranslations("admin.leadOps.actions.revoke");
  const submit = useSubmit();
  const [explanation, setExplanation] = React.useState("");
  const [evidence, setEvidence] = React.useState("");
  return (
    <ConfirmDialog
      triggerLabel={t("trigger")}
      triggerVariant="outline"
      title={t("title")}
      description={t("description")}
      destructive
      confirmLabel={t("confirm")}
      pendingLabel={t("pending")}
      onOpenChange={(open) => {
        if (!open) {
          setExplanation("");
          setEvidence("");
        }
      }}
      onConfirm={async () => {
        if (explanation.trim().length < 1 || evidence.trim().length < 1) return { success: false, error: t("fieldsRequired") };
        return submit(() => revokeLeadPurchaseAction({ leadPurchaseId, explanation, evidenceReference: evidence }), t("success"), t("failed"));
      }}
    >
      <div className="flex flex-col gap-3 py-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`revoke-explanation-${leadPurchaseId}`}>{t("explanationLabel")}</Label>
          <Textarea id={`revoke-explanation-${leadPurchaseId}`} value={explanation} maxLength={1000} onChange={(e) => setExplanation(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`revoke-evidence-${leadPurchaseId}`}>{t("evidenceLabel")}</Label>
          <Input id={`revoke-evidence-${leadPurchaseId}`} value={evidence} maxLength={200} onChange={(e) => setEvidence(e.target.value)} />
        </div>
      </div>
    </ConfirmDialog>
  );
}

export function ImposeBlockDialog({ subjectUserId }: { subjectUserId: string }) {
  const t = useTranslations("admin.leadOps.actions.block");
  const submit = useSubmit();
  const [restrictedAction, setRestrictedAction] = React.useState("LEAD_PURCHASE_INITIATION");
  const [minutes, setMinutes] = React.useState("60");
  const [explanation, setExplanation] = React.useState("");
  return (
    <ConfirmDialog
      triggerLabel={t("trigger")}
      triggerVariant="outline"
      title={t("title")}
      description={t("description")}
      destructive
      confirmLabel={t("confirm")}
      pendingLabel={t("pending")}
      onOpenChange={(open) => {
        if (!open) {
          setRestrictedAction("LEAD_PURCHASE_INITIATION");
          setMinutes("60");
          setExplanation("");
        }
      }}
      onConfirm={async () => {
        const durationMinutes = Number(minutes);
        if (!Number.isInteger(durationMinutes) || explanation.trim().length < 1) return { success: false, error: t("fieldsRequired") };
        return submit(() => imposeLeadAbuseBlockAction({ subjectUserId, restrictedAction, durationMinutes, explanation }), t("success"), t("failed"));
      }}
    >
      <div className="flex flex-col gap-3 py-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="block-action">{t("actionLabel")}</Label>
          <Select id="block-action" value={restrictedAction} onChange={(e) => setRestrictedAction(e.target.value)}>
            <option value="LEAD_PUBLICATION">{t("actions.LEAD_PUBLICATION")}</option>
            <option value="LEAD_PURCHASE_INITIATION">{t("actions.LEAD_PURCHASE_INITIATION")}</option>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="block-minutes">{t("minutesLabel")}</Label>
          <Input id="block-minutes" type="number" min={30} max={43200} step={1} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="block-explanation">{t("explanationLabel")}</Label>
          <Textarea id="block-explanation" value={explanation} maxLength={500} onChange={(e) => setExplanation(e.target.value)} />
        </div>
      </div>
    </ConfirmDialog>
  );
}

export function LiftDecisionDialog({ decisionId, isFlag }: { decisionId: string; isFlag: boolean }) {
  const t = useTranslations("admin.leadOps.actions.lift");
  const submit = useSubmit();
  const [note, setNote] = React.useState("");
  return (
    <ConfirmDialog
      triggerLabel={t(isFlag ? "resolveTrigger" : "liftTrigger")}
      triggerVariant="outline"
      title={t(isFlag ? "resolveTitle" : "liftTitle")}
      description={t("description")}
      confirmLabel={t("confirm")}
      pendingLabel={t("pending")}
      onOpenChange={(open) => {
        if (!open) setNote("");
      }}
      onConfirm={async () => {
        if (note.trim().length < 1) return { success: false, error: t("noteRequired") };
        return submit(() => liftLeadAbuseDecisionAction({ decisionId, note }), t("success"), t("failed"));
      }}
    >
      <div className="flex flex-col gap-1 py-2">
        <Label htmlFor={`lift-note-${decisionId}`}>{t("noteLabel")}</Label>
        <Textarea id={`lift-note-${decisionId}`} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      </div>
    </ConfirmDialog>
  );
}
