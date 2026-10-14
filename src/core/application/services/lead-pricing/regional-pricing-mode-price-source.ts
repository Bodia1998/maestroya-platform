import type { LeadPublicationPriceSource } from "@/application/ports/lead-publication-price-source";
import type { LeadPublicationPriceOutcome } from "@/domain/services/lead-publication";
import type { LeadRegionalPricingMode } from "@/domain/services/lead-regional-pricing-mode";

/**
 * Module 164 — selects, PER CALL, which pricing pipeline decides (see domain/services/lead-regional-pricing-mode.ts).
 *
 *   OFF      -> `legacy` (Module 132 / 163) decides; `calibrated` is not touched.
 *   SHADOW   -> `legacy` decides; `calibrated` also runs, best-effort, and only its decision LABEL is reported to `observe`.
 *               Nothing it returns can reach the caller, and any failure of it is swallowed.
 *   ENFORCE  -> `calibrated` decides. There is no fallback to `legacy`.
 *
 * `readMode` is invoked on every call, so a long-lived instance never acts on a stale switch. A thrown / malformed mode reads as
 * OFF. The wrapper has no pricing logic.
 */
export interface RegionalPricingShadowObservation {
  leadId: string;
  /** The calibrated outcome kind (and, when resolved, the result status) — labels only, never prices or provenance. */
  calibrated: string;
  legacy: string;
}

export class RegionalPricingModePriceSource implements LeadPublicationPriceSource {
  constructor(
    private readonly legacy: LeadPublicationPriceSource,
    private readonly calibrated: LeadPublicationPriceSource,
    private readonly readMode: () => LeadRegionalPricingMode,
    private readonly observe?: (observation: RegionalPricingShadowObservation) => void,
  ) {}

  async priceForLead(leadId: string): Promise<LeadPublicationPriceOutcome> {
    let mode: LeadRegionalPricingMode = "OFF";
    try {
      const read = this.readMode();
      if (read === "OFF" || read === "SHADOW" || read === "ENFORCE") mode = read;
    } catch {
      mode = "OFF";
    }

    if (mode === "ENFORCE") return this.calibrated.priceForLead(leadId);

    const legacy = await this.legacy.priceForLead(leadId);
    if (mode === "SHADOW" && this.observe) {
      try {
        const calibrated = await this.calibrated.priceForLead(leadId);
        this.observe({ leadId, legacy: label(legacy), calibrated: label(calibrated) });
      } catch {
        // Shadow mode can never affect a publication.
      }
    }
    return legacy;
  }
}

function label(outcome: LeadPublicationPriceOutcome): string {
  return outcome.kind === "RESOLVED" ? `RESOLVED:${outcome.result.status}` : outcome.kind;
}
