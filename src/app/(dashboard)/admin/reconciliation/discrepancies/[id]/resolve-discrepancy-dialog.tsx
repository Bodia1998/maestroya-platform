"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { resolveDiscrepancyAction } from "../../actions";

/**
 * Module 81 — Reconciliation Admin Dashboard & Operations: the discrepancy
 * detail page's resolution control — the only UI path to
 * `ResolveDiscrepancyUseCase` (Module 80). This component never decides
 * *how* a discrepancy is resolved (there is no client-side resolution
 * algorithm here); it only collects the required reason, confirms the
 * admin really means to close this discrepancy (an irreversible action —
 * see `ResolveDiscrepancyUseCase`'s own doc comment: there is no
 * "un-resolve"), and forwards to the Server Action. `ConfirmDialog`'s own
 * `isSubmitting` guard prevents a duplicate submission from a second
 * click, and Module 80's own use case independently rejects resolving an
 * already-`RESOLVED` discrepancy (`ConflictError`) — this component
 * surfaces that as a normal error message rather than a client-side-only
 * guard, since the server is always the actual authority here.
 */
export function ResolveDiscrepancyDialog({ discrepancyId }: { discrepancyId: string }) {
  const router = useRouter();
  const [reason, setReason] = React.useState("");

  return (
    <ConfirmDialog
      triggerLabel="Resolve discrepancy"
      title="Resolve this discrepancy"
      destructive={false}
      description="Marks this discrepancy resolved, attributed to your admin account. This does not undo or change any financial record — it only closes the investigation. This cannot be undone from this screen."
      confirmLabel="Resolve"
      pendingLabel="Resolving…"
      onOpenChange={(open) => {
        if (!open) setReason("");
      }}
      onConfirm={async () => {
        if (reason.trim().length < 3) {
          return { success: false, error: "Please describe why this discrepancy is being resolved (at least 3 characters)." };
        }
        const result = await resolveDiscrepancyAction({ discrepancyId, reason: reason.trim() });
        if (result.success) {
          toast.success("Discrepancy resolved");
          router.refresh();
          return { success: true };
        }
        toast.error("Could not resolve this discrepancy", { description: result.error });
        return { success: false, error: result.error };
      }}
    >
      <div className="flex flex-col gap-1 py-2">
        <Label htmlFor="resolution-reason">Resolution reason</Label>
        <Textarea
          id="resolution-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="e.g. Verified against the Stripe dashboard — this was a timing difference, both amounts now match."
        />
      </div>
    </ConfirmDialog>
  );
}
