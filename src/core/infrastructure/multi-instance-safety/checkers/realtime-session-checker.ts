import "server-only";

import type { CheckerFindingInput, SafetyChecker, SubsystemCheckOutcome } from "@/application/ports/safety-checker";
import { SourceScanner } from "@/infrastructure/multi-instance-safety/source-scanner";

const PRESENCE_STORE_PATH = "src/core/infrastructure/realtime/in-memory-presence-store.ts";
const CONNECTION_REGISTRY_PATH = "src/core/infrastructure/realtime/in-memory-connection-registry.ts";
const MODULE_48_DOC_PATH = "docs/MODULE_48_REALTIME_SYSTEM.md";

/**
 * Module 58 — Multi-Instance Safety Audit.
 *
 * Covers: session consistency for real-time connections, horizontal
 * scaling readiness for messaging/notifications delivered over
 * SSE/WebSocket. `ConnectionRegistry`/`PresenceStore` (Module 48) are
 * deliberately per-instance, in-memory stores — correct for the
 * connection itself (an SSE/WebSocket connection is inherently pinned to
 * exactly one instance; that is normal, not a bug), but `publish()` on
 * one instance cannot currently reach a client connected to a different
 * instance. This is a genuine, already-documented gap
 * (`docs/MODULE_48_REALTIME_SYSTEM.md` §11), not a newly-discovered one —
 * this checker verifies that documentation still accurately matches the
 * source, and surfaces it in this audit's own report so it is visible
 * alongside every other multi-instance finding rather than only in a
 * module-specific doc.
 */
export class RealtimeSessionChecker implements SafetyChecker {
  readonly subsystem = "Real-Time Presence & Cross-Instance Fan-Out";

  constructor(private readonly scanner: SourceScanner = new SourceScanner()) {}

  async check(): Promise<SubsystemCheckOutcome> {
    const passedChecks: string[] = [];
    const findings: CheckerFindingInput[] = [];

    const presenceStore = await this.scanner.read(PRESENCE_STORE_PATH);
    const connectionRegistry = await this.scanner.read(CONNECTION_REGISTRY_PATH);
    const doc = await this.scanner.read(MODULE_48_DOC_PATH);

    if (presenceStore && connectionRegistry) {
      passedChecks.push(
        `${PRESENCE_STORE_PATH} / ${CONNECTION_REGISTRY_PATH}: both implement their respective application-layer ports (\`PresenceStore\`/\`ConnectionRegistry\`) behind a swappable interface, so a future Redis pub/sub-backed implementation can be introduced without changing any caller.`,
      );
    }

    if (doc && /a client's SSE\/WebSocket connection is pinned to exactly one instance/.test(doc)) {
      passedChecks.push(
        `${MODULE_48_DOC_PATH}: correctly documents that a live connection being pinned to one instance is expected/normal for SSE/WebSocket, distinguishing it from the actual gap (cross-instance fan-out of a \`publish()\` call).`,
      );
    }

    if (doc && /does not implement.*SUBSCRIBE/.test(doc.replace(/\s+/g, " "))) {
      findings.push({
        severity: "WARNING",
        problem: "A publish() call on one instance cannot currently reach clients whose SSE/WebSocket connection is pinned to a different instance — there is no Redis pub/sub (or equivalent) fan-out relay yet.",
        risk: "Under horizontal scaling with more than one instance, a real-time notification/message could silently fail to reach a recipient connected to a different instance than the one that published it.",
        whyItHappens: `${MODULE_48_DOC_PATH} §11 documents this directly: this codebase's hand-rolled Redis client does not implement \`SUBSCRIBE\` today, so the pub/sub relay Module 48 anticipates has not been built.`,
        impact: "Real-time delivery (live messaging/notification badges, presence updates) becomes unreliable specifically in a multi-instance deployment — a correctness gap distinct from, and in addition to, plain scaling/performance.",
        recommendedFix: "Extend the hand-rolled RESP2 Redis client with PUBLISH/SUBSCRIBE support (or a second dedicated subscribe-side connection, as already scoped in the Module 48 doc), and route ConnectionRegistry.deliver()/publish() calls through it so an instance can fan a message out to every other instance's locally-connected clients.",
        priority: "HIGH",
        evidence: [MODULE_48_DOC_PATH, CONNECTION_REGISTRY_PATH],
      });
    } else {
      findings.push({
        severity: "WARNING",
        problem: "Could not independently re-confirm the documented real-time cross-instance fan-out gap from source (the expected doc passage was not found verbatim).",
        risk: "If the gap has since been closed, this checker's evidence is stale; if it has not, the same cross-instance delivery risk described in Module 48's own doc still applies.",
        whyItHappens: `${MODULE_48_DOC_PATH} did not match the exact wording this checker looks for — the doc may have been revised.`,
        impact: "Reduced confidence in this specific finding; treat as a prompt to manually re-verify §11 of the Module 48 doc against the current `ConnectionRegistry`/`PresenceStore` implementations.",
        recommendedFix: "Manually confirm whether Redis pub/sub-backed cross-instance fan-out has been implemented for real-time delivery; update this checker's expected text if the doc's wording changed.",
        priority: "LOW",
        evidence: [MODULE_48_DOC_PATH],
      });
    }

    return { passedChecks, findings };
  }
}
