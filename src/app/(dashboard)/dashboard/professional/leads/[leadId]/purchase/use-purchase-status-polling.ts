"use client";

import { useEffect, useRef } from "react";

import type { LeadPurchaseCheckoutDTO } from "@/application/dto/lead-purchase-checkout.dto";
import { LEAD_PURCHASE_POLL_INTERVALS_MS } from "./checkout-view";
import { getLeadPurchaseCheckoutAction } from "./actions";

interface Options {
  /** Polling runs only while true (the payment was submitted / is processing). */
  active: boolean;
  /** Change to start a fresh bounded cycle (manual "check again"). */
  runKey: number;
  leadId: string;
  intervalsMs?: readonly number[];
  /** Called ONCE with the authoritative purchase as soon as it is no longer PENDING_PAYMENT (null = nothing readable). */
  onSettled: (purchase: LeadPurchaseCheckoutDTO | null) => void;
  /** Called ONCE when the bounded schedule is used up while the purchase is still PENDING_PAYMENT. */
  onExhausted: () => void;
}

/**
 * Module 144 — bounded re-fetch of the AUTHORITATIVE purchase state through the existing
 * session-bound read action, while Module 141's verified webhook confirms the payment. It
 * never infers confirmation from anything the browser knows (card UI, Elements, URL, storage):
 * the only way out of "waiting" is the server saying the status changed.
 *
 * Bounded (fixed schedule, never infinite), stops at the first non-PENDING_PAYMENT answer,
 * tolerates transient failures (they consume an attempt), and cleans up its timer and ignores
 * late answers on unmount / navigation / dependency change.
 */
export function usePurchaseStatusPolling({ active, runKey, leadId, intervalsMs = LEAD_PURCHASE_POLL_INTERVALS_MS, onSettled, onExhausted }: Options): void {
  const callbacks = useRef({ onSettled, onExhausted });
  callbacks.current = { onSettled, onExhausted };

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const schedule = () => {
      if (attempt >= intervalsMs.length) {
        callbacks.current.onExhausted();
        return;
      }
      timer = setTimeout(run, intervalsMs[attempt]);
    };

    const run = async () => {
      attempt += 1;
      let answer: { purchase: LeadPurchaseCheckoutDTO | null } | null = null;
      try {
        const result = await getLeadPurchaseCheckoutAction(leadId);
        answer = result.success ? { purchase: result.purchase } : null;
      } catch {
        answer = null; // transient failure: try again within the bound
      }
      if (cancelled) return;
      if (answer && answer.purchase?.status !== "PENDING_PAYMENT") {
        callbacks.current.onSettled(answer.purchase);
        return;
      }
      schedule();
    };

    schedule();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [active, runKey, leadId, intervalsMs]);
}
