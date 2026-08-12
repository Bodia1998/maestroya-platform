import "server-only";

import type { CircuitBreakerConfig } from "@/domain/entities/circuit-breaker";
import { getCircuitBreakerRegistry } from "@/infrastructure/health/compose";

/**
 * Module 56 — Health Checks & Circuit Breakers.
 *
 * The extension point for wrapping a *real* external call — not just a
 * health check — through the same named breaker its health contributor
 * uses. Deliberately not wired into any existing call site in this
 * change (that would be a business-logic change, out of this module's
 * scope), but this is the one line a future caller adds to protect e.g.
 * a live Stripe API call: `withCircuitBreaker("stripe", () =>
 * stripe.balance.retrieve())`. Sharing the same breaker name as the
 * corresponding health contributor in `compose.ts` means a dependency's
 * real traffic and its health check report the exact same state and
 * metrics — there is only one breaker per dependency, never two
 * diverging views of it.
 */
export async function withCircuitBreaker<T>(
  name: string,
  fn: () => Promise<T>,
  config?: Partial<CircuitBreakerConfig>,
): Promise<T> {
  const breaker = getCircuitBreakerRegistry().getOrCreate(name, config);
  return breaker.execute(fn);
}
