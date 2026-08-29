"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { startReconciliationRunAction } from "../actions";

const SCOPES = ["FULL", "PAYMENT", "COMMISSION", "TAX", "INVOICE", "PAYOUT", "REFUND", "CREDIT_NOTE", "PROVIDER"] as const;

/**
 * Module 81 — Reconciliation Admin Dashboard & Operations: the manual
 * "run reconciliation now" control the admin overview page exposes.
 * Every requirement from the module spec's "Manual reconciliation
 * trigger" section is handled here rather than by re-implementing the
 * engine: the confirmation step, pending state, and duplicate-submission
 * guard all come from the shared `ConfirmDialog` (its own `isSubmitting`
 * state disables the confirm button while a submission is in flight, so
 * a second click can't start a second run), and the actual work is a
 * single call to `startReconciliationRunAction` — a thin Server Action
 * wrapper over Module 80's `StartReconciliationRunUseCase`. This
 * component never scans a Job, evaluates a check, or talks to Stripe.
 */
export function TriggerRunDialog() {
  const router = useRouter();
  const [scope, setScope] = React.useState<(typeof SCOPES)[number]>("FULL");
  const [limit, setLimit] = React.useState(500);
  const [since, setSince] = React.useState("");

  return (
    <ConfirmDialog
      triggerLabel="Run reconciliation now"
      triggerVariant="default"
      title="Start a reconciliation run"
      description="Scans recent jobs' financial records for discrepancies. This never changes any financial record — it only detects and records inconsistencies for review. A run can take a while for a large scope/limit; you can navigate away and check its status from the runs list."
      confirmLabel="Start run"
      pendingLabel="Starting…"
      onOpenChange={(open) => {
        if (!open) {
          setScope("FULL");
          setLimit(500);
          setSince("");
        }
      }}
      onConfirm={async () => {
        const result = await startReconciliationRunAction({
          scope,
          limit,
          since: since ? new Date(since).toISOString() : undefined,
        });
        if (result.success) {
          toast.success("Reconciliation run started", {
            description: `${result.data.discrepanciesCreated} new, ${result.data.discrepanciesReconfirmed} reconfirmed discrepancies so far.`,
          });
          router.refresh();
          return { success: true };
        }
        toast.error("Could not start the reconciliation run", { description: result.error });
        return { success: false, error: result.error };
      }}
    >
      <div className="flex flex-col gap-3 py-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="run-scope">Scope</Label>
          <Select
            id="run-scope"
            value={scope}
            onChange={(e) => setScope(e.target.value as (typeof SCOPES)[number])}
          >
            {SCOPES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="run-since">Only jobs with activity since (optional)</Label>
          <Input id="run-since" type="date" value={since} onChange={(e) => setSince(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="run-limit">Job limit (1–2000)</Label>
          <Input
            id="run-limit"
            type="number"
            min={1}
            max={2000}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value) || 500)}
          />
        </div>
      </div>
    </ConfirmDialog>
  );
}
