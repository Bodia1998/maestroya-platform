import {
  LEAD_ROLLOUT_UNAVAILABLE_CONFIG,
  LeadV1RolloutDisabledError,
  isLeadRolloutAreaOpen,
  type LeadRolloutArea,
  type LeadRolloutConfig,
} from "@/domain/services/lead-rollout";

/**
 * Module 159 — the rollout guard: a decorator that refuses to start ONE area of new LEAD_V1 activity while the rollout switch has
 * that area closed.
 *
 * It sits OUTERMOST around a use case (see `lead-rollout/compose.ts`), so a refused call performs no read of the wrapped use case's
 * collaborators and no write at all: no service request, no lead, no consent evidence, no purchase, no payment attempt, no M156
 * rate-limit budget is spent. The switch is read on EVERY call (`readConfig` is a function, never a captured value), and a failure
 * to read it is a refusal: the guard fails closed.
 *
 * It is NOT authorization and grants nothing: when the area is open the call is passed on with the very same arguments, and every
 * ownership / eligibility / consent / pricing / abuse gate of the wrapped use case still runs. Its result and its errors are
 * returned unchanged.
 */
export class LeadRolloutGuarded<A extends unknown[], R> {
  constructor(
    private readonly inner: { execute(...args: A): Promise<R> },
    private readonly area: LeadRolloutArea,
    private readonly readConfig: () => LeadRolloutConfig,
  ) {}

  async execute(...args: A): Promise<R> {
    assertLeadRolloutAreaOpen(this.area, this.readConfig);
    return this.inner.execute(...args);
  }
}

/** Reads the switch; a throwing reader is the same fail-safe outcome as a missing one (DISABLED). */
function readSafely(readConfig: () => LeadRolloutConfig): LeadRolloutConfig | null | undefined {
  try {
    return readConfig();
  } catch {
    return LEAD_ROLLOUT_UNAVAILABLE_CONFIG;
  }
}

/** Throws `LeadV1RolloutDisabledError` unless `area` is open. A throwing / malformed reader is treated as DISABLED. */
export function assertLeadRolloutAreaOpen(area: LeadRolloutArea, readConfig: () => LeadRolloutConfig): void {
  const config = readSafely(readConfig);
  if (!config || !isLeadRolloutAreaOpen(config.mode, area)) throw new LeadV1RolloutDisabledError();
}
