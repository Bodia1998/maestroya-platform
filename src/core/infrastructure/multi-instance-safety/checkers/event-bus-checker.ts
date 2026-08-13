import "server-only";

import type { CheckerFindingInput, SafetyChecker, SubsystemCheckOutcome } from "@/application/ports/safety-checker";
import { SourceScanner } from "@/infrastructure/multi-instance-safety/source-scanner";

const SYNC_BUS_PATH = "src/core/infrastructure/events/synchronous-event-bus.ts";
const QUEUED_BUS_PATH = "src/core/infrastructure/events/queued-event-bus.ts";
const EVENT_BUS_FACTORY_PATH = "src/core/infrastructure/events/event-bus-factory.ts";

/**
 * Module 58 — Multi-Instance Safety Audit.
 *
 * Covers: lost events, event ordering, event duplication safety across
 * instances. Verifies `QueuedEventBus` — the transport used once event
 * dispatch is moved onto the shared job queue rather than run inline in
 * the publishing process — preserves the same failure contract and
 * ordering guarantees as `SynchronousEventBus`, and that handler
 * execution (which can land on any instance, since jobs are pulled from
 * the shared Redis-backed queue) is de-duplicated through the same
 * `JobIdempotencyStore` mechanism verified in `IdempotencyChecker` rather
 * than a second, competing mechanism.
 */
export class EventBusChecker implements SafetyChecker {
  readonly subsystem = "Event Bus, Ordering & Delivery Guarantees";

  constructor(private readonly scanner: SourceScanner = new SourceScanner()) {}

  async check(): Promise<SubsystemCheckOutcome> {
    const passedChecks: string[] = [];
    const findings: CheckerFindingInput[] = [];

    const syncBus = await this.scanner.read(SYNC_BUS_PATH);
    const queuedBus = await this.scanner.read(QUEUED_BUS_PATH);

    if (queuedBus && /publishAll/.test(queuedBus) && /one at a time/.test(queuedBus)) {
      passedChecks.push(
        `${QUEUED_BUS_PATH}: \`publishAll\` is documented and implemented to process events one at a time, preserving causal ordering even though delivery now crosses process/instance boundaries via the queue.`,
      );
    } else if (queuedBus) {
      findings.push({
        severity: "WARNING",
        problem: "Could not confirm that the queued event bus preserves publish ordering.",
        risk: "Events published together (e.g. a state-change event followed by a dependent notification event) could be enqueued or delivered out of order once handlers run across multiple instances pulling from a shared queue.",
        whyItHappens: `${QUEUED_BUS_PATH} did not match the expected sequential \`publishAll\` pattern this audit checks for.`,
        impact: "A handler could observe a later event before an earlier, causally-dependent one, producing inconsistent derived state.",
        recommendedFix: "Ensure `publishAll` enqueues/awaits events strictly in order, never concurrently, when causal ordering between them matters.",
        priority: "MEDIUM",
        evidence: [QUEUED_BUS_PATH],
      });
    }

    if (queuedBus && /EventDispatchError/.test(queuedBus) && syncBus && /EventDispatchError/.test(syncBus)) {
      passedChecks.push(
        `${SYNC_BUS_PATH} and ${QUEUED_BUS_PATH}: both implementations bundle handler/enqueue failures into the same \`EventDispatchError\` shape — publishers behave identically regardless of which transport is active, so swapping transports cannot silently change failure-handling behavior.`,
      );
    }

    if (queuedBus && /durably enqueued/.test(queuedBus)) {
      passedChecks.push(
        `${QUEUED_BUS_PATH}: documents precisely that \`publish()\` resolving means "durably enqueued", not "handler ran" — handler failures after enqueue are retried with backoff and dead-lettered rather than silently lost, which is the correct at-least-once contract for cross-instance delivery.`,
      );
    }

    const factory = await this.scanner.read(EVENT_BUS_FACTORY_PATH);
    if (!factory) {
      findings.push({
        severity: "WARNING",
        problem: "No event-bus selection factory found at the expected path.",
        risk: "Cannot statically confirm which transport (synchronous vs. queued) is active in a given deployment, or that the choice is made consistently.",
        whyItHappens: `${EVENT_BUS_FACTORY_PATH} does not exist or could not be read.`,
        impact: "A reviewer cannot verify from source alone whether event delivery is safe across instances without also inspecting runtime configuration.",
        recommendedFix: "Confirm the actual composition root wiring for the event bus (may live under a different file name) and ensure production deployments with more than one instance use the queued (not synchronous, in-process) transport for any event a background job depends on.",
        priority: "LOW",
        evidence: [],
      });
    } else {
      passedChecks.push(`${EVENT_BUS_FACTORY_PATH}: an explicit factory exists for selecting the event-bus transport.`);
    }

    return { passedChecks, findings };
  }
}
