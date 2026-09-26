import { Check, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/shared/utils/cn";

/**
 * Shared lifecycle-progression stepper — used to visualize where a Quote or
 * Appointment currently sits in its happy-path lifecycle (Module 30.5:
 * Quotes & Booking UX). Deliberately domain-agnostic: it has no knowledge
 * of quote/appointment status enums or transition rules (those stay in
 * `domain/services/quote-state.ts` / `appointment-state.ts`) — the calling
 * page decides which steps exist and what state each one is in, this
 * component only renders that decision consistently.
 */
export type TimelineStepState = "complete" | "current" | "upcoming" | "danger";

export interface TimelineStep {
  key: string;
  /**
   * Module 120 — Multilingual Localization: optional explicit label. When
   * omitted, the step's `key` is treated as a status enum value and shown
   * via `enums.status.<key>` in the active locale (falling back to the raw
   * key) — which is what the quote/appointment step builders rely on.
   */
  label?: string;
  state: TimelineStepState;
}

export interface StatusTimelineProps {
  steps: readonly TimelineStep[];
  className?: string;
}

const MARKER_STYLES: Record<TimelineStepState, string> = {
  complete: "border-primary bg-primary text-primary-foreground",
  current: "border-primary bg-background text-primary",
  upcoming: "border-border bg-background text-foreground/40",
  danger: "border-danger bg-danger text-danger-foreground",
};

const LABEL_STYLES: Record<TimelineStepState, string> = {
  complete: "text-foreground",
  current: "font-medium text-foreground",
  upcoming: "text-foreground/50",
  danger: "font-medium text-danger",
};

function Marker({ state }: { state: TimelineStepState }) {
  if (state === "complete") return <Check className="h-3.5 w-3.5" aria-hidden />;
  if (state === "danger") return <X className="h-3.5 w-3.5" aria-hidden />;
  return <span className="h-2 w-2 rounded-full bg-current" aria-hidden />;
}

/** Horizontal on wider screens, wraps to a vertical list on mobile — see the `sm:` breakpoint on the connecting line. */
export function StatusTimeline({ steps, className }: StatusTimelineProps) {
  const t = useTranslations("enums.status");
  const labelFor = (step: TimelineStep): string =>
    step.label ?? (t.has(step.key as never) ? t(step.key as never) : step.key);
  return (
    <ol className={cn("flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-2", className)}>
      {steps.map((step, index) => (
        <li key={step.key} className="flex flex-1 items-center gap-3 sm:flex-col sm:items-stretch sm:gap-2">
          <div className="flex items-center gap-3 sm:flex-col sm:gap-2">
            <span
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2",
                MARKER_STYLES[step.state],
              )}
              aria-hidden
            >
              <Marker state={step.state} />
            </span>
            {index < steps.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  "h-6 w-0.5 sm:h-0.5 sm:w-full sm:flex-1",
                  step.state === "complete" || step.state === "danger" ? "bg-primary" : "bg-border",
                )}
              />
            )}
          </div>
          <span
            className={cn("text-sm sm:text-center", LABEL_STYLES[step.state])}
            aria-current={step.state === "current" ? "step" : undefined}
          >
            {labelFor(step)}
          </span>
        </li>
      ))}
    </ol>
  );
}
