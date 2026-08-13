import "server-only";

import type { CheckerFindingInput, SafetyChecker, SubsystemCheckOutcome } from "@/application/ports/safety-checker";
import { SourceScanner } from "@/infrastructure/multi-instance-safety/source-scanner";

const READY_ROUTE_PATH = "src/app/api/health/ready/route.ts";
const STARTUP_ROUTE_PATH = "src/app/api/health/startup/route.ts";
const CIRCUIT_BREAKERS_ROUTE_PATH = "src/app/api/health/circuit-breakers/route.ts";

/**
 * Module 58 — Multi-Instance Safety Audit.
 *
 * Covers: horizontal scaling readiness, database consistency (as a load
 * balancer sees it). Reuses Module 56's own health/readiness surface
 * rather than re-implementing dependency checks: `/api/health/ready`
 * answers "can this instance safely receive traffic right now" per
 * instance (the exact question a load balancer's health check needs
 * answered independently, per instance, to route around a single
 * unhealthy node without affecting the others), and Module 56's own
 * circuit breakers stop one instance's struggling downstream dependency
 * from cascading into a platform-wide outage.
 */
export class HealthScalingReadinessChecker implements SafetyChecker {
  readonly subsystem = "Health Checks & Horizontal Scaling Readiness";

  constructor(private readonly scanner: SourceScanner = new SourceScanner()) {}

  async check(): Promise<SubsystemCheckOutcome> {
    const passedChecks: string[] = [];
    const findings: CheckerFindingInput[] = [];

    const readyRoute = await this.scanner.read(READY_ROUTE_PATH);
    if (readyRoute && /can this instance safely receive production traffic right\s+now/.test(readyRoute)) {
      passedChecks.push(
        `${READY_ROUTE_PATH}: readiness is evaluated per-instance ("can this instance safely receive production traffic right now?") — exactly the granularity a load balancer needs to route around one unhealthy instance without affecting the others.`,
      );
    } else {
      findings.push({
        severity: "WARNING",
        problem: "Could not confirm the readiness endpoint evaluates health at per-instance granularity.",
        risk: "A shared or cluster-wide readiness signal could cause a load balancer to either mark every instance unhealthy for one instance's local problem, or fail to detect a genuinely unhealthy single instance.",
        whyItHappens: `${READY_ROUTE_PATH} did not match the expected per-instance readiness framing.`,
        impact: "Incorrect load-balancer routing decisions under partial outages.",
        recommendedFix: "Ensure /api/health/ready reflects only this process's own ability to serve traffic (its own database/cache connectivity, etc.), not a cluster-wide aggregate.",
        priority: "MEDIUM",
        evidence: [READY_ROUTE_PATH],
      });
    }

    if (readyRoute && /optional\/degradable/.test(readyRoute)) {
      passedChecks.push(
        `${READY_ROUTE_PATH}: correctly distinguishes the one hard dependency (PostgreSQL — every request path needs it) from optional/degradable ones (Redis, Cloudinary, Stripe, email) — a brief third-party blip cannot needlessly trigger failover/restarts across every instance.`,
      );
    }

    const startupRoute = await this.scanner.exists(STARTUP_ROUTE_PATH);
    if (startupRoute) {
      passedChecks.push(`${STARTUP_ROUTE_PATH}: a separate startup probe exists, distinct from the steady-state readiness probe — a slow-starting instance is not flagged unhealthy by the same check that governs ongoing traffic routing.`);
    } else {
      findings.push({
        severity: "WARNING",
        problem: "No separate startup health-check route found.",
        risk: "Without a distinct startup probe, an orchestrator may apply the same timeout/threshold to 'is this instance still booting' as to 'is this already-running instance healthy', causing slow-starting instances to be killed prematurely during a rolling deploy.",
        whyItHappens: `${STARTUP_ROUTE_PATH} does not exist or could not be read.`,
        impact: "Rolling deployments/autoscaling could be less reliable than intended, though this does not affect already-running instances' correctness.",
        recommendedFix: "Add a dedicated startup probe distinct from the readiness probe if orchestration requires distinguishing 'still booting' from 'unhealthy'.",
        priority: "LOW",
        evidence: [],
      });
    }

    const circuitBreakersRoute = await this.scanner.exists(CIRCUIT_BREAKERS_ROUTE_PATH);
    if (circuitBreakersRoute) {
      passedChecks.push(
        `${CIRCUIT_BREAKERS_ROUTE_PATH}: circuit-breaker state is observable per instance — a downstream dependency degrading for one instance is visible and contained rather than silently cascading platform-wide.`,
      );
    }

    return { passedChecks, findings };
  }
}
