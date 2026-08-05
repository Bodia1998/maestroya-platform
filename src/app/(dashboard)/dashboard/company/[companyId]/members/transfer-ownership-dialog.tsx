"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { transferCompanyOwnershipAction } from "./actions";

export interface TransferOwnershipCandidate {
  id: string;
  label: string;
}

/**
 * Module 18 — Company Professional: ownership transfer previously submitted
 * as a plain `<form action={transferCompanyOwnershipFormAction}>` with no
 * confirmation step, despite being one of the most consequential actions on
 * this page (the current owner immediately loses that role). Built on the
 * shared `ConfirmDialog` (Module 30.5) — the new-owner select and
 * confirmation-text input live in this component (as `ConfirmDialog`'s
 * `children`) rather than inside `ConfirmDialog` itself, since their values
 * need to be read at confirm time; `canInitiateOwnershipTransfer` and the
 * `TRANSFER` confirmation text are still fully re-validated server-side by
 * `transferCompanyOwnershipAction` regardless of this UI.
 */
export function TransferOwnershipDialog({
  companyId,
  candidates,
}: {
  companyId: string;
  candidates: readonly TransferOwnershipCandidate[];
}) {
  const router = useRouter();
  const [newOwnerMemberId, setNewOwnerMemberId] = useState(candidates[0]?.id ?? "");
  const [confirmationText, setConfirmationText] = useState("");
  const selectId = useId();
  const confirmationId = useId();

  return (
    <ConfirmDialog
      triggerLabel="Transfer ownership"
      title="Transfer ownership?"
      description="Only the current owner can transfer ownership. This action is irreversible without the new owner transferring it back."
      confirmLabel="Yes, transfer ownership"
      pendingLabel="Transferring…"
      destructive
      onConfirm={async () => {
        const result = await transferCompanyOwnershipAction(companyId, newOwnerMemberId, confirmationText);
        if (result.success) router.refresh();
        return result;
      }}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={selectId}>New owner</Label>
          <Select
            id={selectId}
            value={newOwnerMemberId}
            onChange={(e) => setNewOwnerMemberId(e.target.value)}
          >
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={confirmationId}>Type TRANSFER to confirm</Label>
          <Input
            id={confirmationId}
            value={confirmationText}
            onChange={(e) => setConfirmationText(e.target.value)}
          />
        </div>
      </div>
    </ConfirmDialog>
  );
}
