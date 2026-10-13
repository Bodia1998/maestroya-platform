import {
  LEAD_ROLLOUT_MODES,
  LEAD_ROLLOUT_UNAVAILABLE_CONFIG,
  LeadV1RolloutDisabledError,
  isLeadRolloutAreaOpen,
  type LeadRolloutArea,
  type LeadRolloutConfig,
} from "@/domain/services/lead-rollout";
import { logger } from "@/infrastructure/observability/logger";

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
function readSafely(readConfig: () => LeadRolloutConfig): { config: LeadRolloutConfig | null | undefined; readerFailed: boolean } {
  try {
    return { config: readConfig(), readerFailed: false };
  } catch {
    return { config: LEAD_ROLLOUT_UNAVAILABLE_CONFIG, readerFailed: true };
  }
}

/** Throws `LeadV1RolloutDisabledError` unless `area` is open. A throwing / malformed reader is treated as DISABLED. */
export function assertLeadRolloutAreaOpen(area: LeadRolloutArea, readConfig: () => LeadRolloutConfig): void {
  const { config, readerFailed } = readSafely(readConfig);
  if (config && isLeadRolloutAreaOpen(config.mode, area)) return;
  recordGuardBlocked(area, config, readerFailed);
  throw new LeadV1RolloutDisabledError();
}

/**
 * Module 160 — the one operational signal of a refusal: `lead_rollout.guard_blocked`.
 *
 * Fixed, low-cardinality fields ONLY: the area (ENTRY | PURCHASE), the effective mode, the config status and a reason enum. No user,
 * lead, request, purchase or professional identifier, no argument of the refused call, no raw configuration value (a mode or status
 * that is not one of the known literals is reported as "UNKNOWN"). One line per refused call: an expected AREA_CLOSED refusal is
 * `info`; a switch that could not be read or understood is `error`, because that is an unexpected enforcement failure (the call is
 * refused either way - fail closed).
 *
 * Observability is best-effort and never decides the outcome: a logger that throws is swallowed here, and the refusal that follows
 * is exactly the one M159 defined. The refusal itself is never altered, delayed or turned into a different error.
 */
function recordGuardBlocked(area: LeadRolloutArea, config: LeadRolloutConfig | null | undefined, readerFailed: boolean): void {
  try {
    const mode = typeof config?.mode === "string" && (LEAD_ROLLOUT_MODES as readonly string[]).includes(config.mode) ? config.mode : "UNKNOWN";
    const configStatus = config?.status === "DEFAULT" || config?.status === "CONFIGURED" || config?.status === "MISCONFIGURED" ? config.status : "UNKNOWN";
    const reason = readerFailed ? "CONFIG_READER_FAILED" : mode === "UNKNOWN" ? "CONFIG_MALFORMED" : "AREA_CLOSED";
    const fields = { area, mode, configStatus, reason };
    if (reason === "AREA_CLOSED") logger.info("lead_rollout.guard_blocked", fields);
    else logger.error("lead_rollout.guard_blocked", fields);
  } catch {
    // Logging must never decide the outcome.
  }
}
