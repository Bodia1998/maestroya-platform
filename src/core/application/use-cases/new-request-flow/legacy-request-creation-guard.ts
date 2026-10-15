import { LegacyRequestCreationRedirectedError } from "@/domain/services/new-request-flow";
import type { NewRequestFlowSelector } from "@/application/use-cases/new-request-flow/new-request-flow-selector";

/**
 * Module 165 - decorator around the LEGACY service-request creation use case.
 *
 * When LEAD_V1 is the default for the requested category, the legacy path must not create a new request: it is refused BEFORE the
 * wrapped use case runs (no category read, no customer profile, no geocoding, no row), so a stale form or a hand-crafted call
 * cannot create a LEGACY_QUOTE_PAYMENT request for a category that has moved to LEAD_V1. When LEAD_V1 is not the default (area
 * closed, category not eligible, configuration invalid) the call is passed on unchanged, with the same arguments, and its result and
 * errors are returned untouched - the legacy behaviour is exactly the pre-M165 one.
 *
 * It does not choose LEAD_V1 for the caller and creates nothing itself: the LEAD_V1 entry stays the M142 submission pipeline, with
 * its own consent, scope, pricing and M159 gates.
 */
export class LegacyRequestCreationGuarded<A extends [string, { categoryId: string }, ...unknown[]], R> {
  constructor(
    private readonly inner: { execute(...args: A): Promise<R> },
    private readonly selector: Pick<NewRequestFlowSelector, "forCategory">,
  ) {}

  async execute(...args: A): Promise<R> {
    const decision = await this.selector.forCategory(args[1].categoryId);
    if (decision.flow !== "LEGACY_QUOTE_PAYMENT") throw new LegacyRequestCreationRedirectedError();
    return this.inner.execute(...args);
  }
}
