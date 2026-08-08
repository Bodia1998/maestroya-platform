import "server-only";

import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-node";

import { logger } from "@/infrastructure/observability/logger";

/**
 * Module 51 — Distributed Tracing.
 *
 * The module's failure-behaviour requirement, implemented in one place:
 * **a broken exporter must never become a broken application.**
 *
 * OpenTelemetry's `BatchSpanProcessor` already swallows export errors
 * (they surface only through the `diag` logger) and already keeps the
 * request path off the export path — so an unreachable collector cannot
 * fail a request even without this wrapper. What it does *not* do is
 * stop trying: every batch, forever, re-attempts an HTTP POST to a
 * collector that has been refusing connections for an hour, and every
 * one of those attempts costs a socket, a timeout, and a log line.
 *
 * This decorator adds the missing circuit breaker:
 *
 *  1. Consecutive failures are counted; the *first* one is logged at
 *     `warn` with the reason (an operator needs to know immediately),
 *     subsequent ones are not (a broken collector must not become a log
 *     flood — the same reasoning `job-observability.ts` gives for not
 *     sending self-healing retries to Sentry).
 *  2. After `failureThreshold` consecutive failures the exporter
 *     disables itself: every later batch is dropped locally and reported
 *     as a *success* to the processor, so nothing queues up and no
 *     memory grows. One `error`-level line records the shutdown.
 *  3. A single success at any point resets the counter — a collector
 *     that comes back from a brief blip is used again with no restart.
 *
 * Dropping spans is the correct trade here and is stated explicitly
 * rather than hidden: traces are *diagnostic* data about work the
 * platform already did, the same "derived, degradable, never
 * load-bearing" category `/api/health/ready` puts the search index and
 * the analytics read model in. Losing them costs visibility; retrying
 * them forever costs the running system.
 */
export const DEFAULT_EXPORT_FAILURE_THRESHOLD = 5;

export interface ResilientSpanExporterOptions {
  /** Consecutive failures tolerated before the exporter turns itself off. */
  failureThreshold?: number;
}

export class ResilientSpanExporter implements SpanExporter {
  private consecutiveFailures = 0;
  private disabled = false;

  constructor(
    private readonly delegate: SpanExporter,
    private readonly name: string,
    options: ResilientSpanExporterOptions = {},
  ) {
    this.failureThreshold = Math.max(1, options.failureThreshold ?? DEFAULT_EXPORT_FAILURE_THRESHOLD);
  }

  private readonly failureThreshold: number;

  /** Whether this exporter has tripped its breaker and is dropping spans. */
  get isDisabled(): boolean {
    return this.disabled;
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    if (this.disabled) {
      // Reported as success on purpose: a `FAILED` result makes the
      // processor treat the batch as retryable and hold on to it.
      resultCallback({ code: ExportResultCode.SUCCESS });
      return;
    }

    try {
      this.delegate.export(spans, (result) => {
        if (result.code === ExportResultCode.SUCCESS) {
          this.onSuccess();
        } else {
          this.onFailure(result.error, spans.length);
        }
        resultCallback({ code: ExportResultCode.SUCCESS });
      });
    } catch (error) {
      // A synchronous throw from an exporter is a bug in that exporter;
      // the processor does not expect one and would let it escape into
      // whatever timer/flush called it.
      this.onFailure(error, spans.length);
      resultCallback({ code: ExportResultCode.SUCCESS });
    }
  }

  async shutdown(): Promise<void> {
    try {
      await this.delegate.shutdown();
    } catch (error) {
      logger.warn("tracing_exporter_shutdown_failed", { exporter: this.name, error });
    }
  }

  async forceFlush(): Promise<void> {
    if (this.disabled) return;
    try {
      await this.delegate.forceFlush?.();
    } catch (error) {
      logger.warn("tracing_exporter_flush_failed", { exporter: this.name, error });
    }
  }

  private onSuccess(): void {
    if (this.consecutiveFailures > 0) {
      logger.info("tracing_exporter_recovered", {
        exporter: this.name,
        afterConsecutiveFailures: this.consecutiveFailures,
      });
    }
    this.consecutiveFailures = 0;
  }

  private onFailure(error: unknown, droppedSpans: number): void {
    this.consecutiveFailures += 1;

    if (this.consecutiveFailures === 1) {
      logger.warn("tracing_export_failed", { exporter: this.name, droppedSpans, error });
    }

    if (this.consecutiveFailures >= this.failureThreshold && !this.disabled) {
      this.disabled = true;
      logger.error("tracing_exporter_disabled", {
        exporter: this.name,
        consecutiveFailures: this.consecutiveFailures,
        reason:
          "The span exporter failed repeatedly and has been disabled for the lifetime of this process. " +
          "Tracing context and correlation IDs keep working; spans are no longer exported.",
      });
    }
  }
}
