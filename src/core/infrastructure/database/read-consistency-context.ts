import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import type { ReadConsistencyPolicy } from "@/domain/services/read-consistency-policy";

/**
 * Module 55 — Read Replicas.
 *
 * Lets a specific call site require `STRONG` (or any other) read
 * consistency for the reads it makes, without changing a single
 * repository's method signature — the same non-invasive propagation
 * technique `TracingPort`'s active-span context already uses via
 * OpenTelemetry's own `AsyncLocalStorage`-backed context manager (see
 * `infrastructure/tracing/otel-tracer.ts`), applied here directly since
 * this module has no external SDK providing one.
 *
 * The motivating case is the classic replication-lag hazard: a request
 * that just wrote through a repository, then immediately reads its own
 * write back through a different repository call in the same request.
 * Wrapping that second call in `withReadConsistency({ level: "STRONG", ... })`
 * guarantees `read-replica-extension.ts`'s `$allOperations` hook routes
 * every read inside the callback to the primary, regardless of
 * `READ_REPLICA_DEFAULT_CONSISTENCY`.
 *
 * Not required for the common case — most reads are fine with the
 * module-wide default (`EVENTUAL`), which is why this is opt-in
 * middleware around a call, not a parameter every repository method
 * gained.
 */
const storage = new AsyncLocalStorage<ReadConsistencyPolicy>();

/** Runs `fn` with `policy` as the active read-consistency requirement for every read `fn` (transitively) triggers. */
export function withReadConsistency<T>(policy: ReadConsistencyPolicy, fn: () => T): T {
  return storage.run(policy, fn);
}

/** The active read-consistency requirement, or `null` outside of any `withReadConsistency` call. */
export function getCurrentReadConsistency(): ReadConsistencyPolicy | null {
  return storage.getStore() ?? null;
}
