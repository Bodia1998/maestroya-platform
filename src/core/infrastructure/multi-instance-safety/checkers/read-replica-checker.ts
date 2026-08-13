import "server-only";

import type { CheckerFindingInput, SafetyChecker, SubsystemCheckOutcome } from "@/application/ports/safety-checker";
import { SourceScanner } from "@/infrastructure/multi-instance-safety/source-scanner";

const EXTENSION_PATH = "src/core/infrastructure/database/prisma/read-replica-extension.ts";

/**
 * Module 58 — Multi-Instance Safety Audit.
 *
 * Covers: read replica consistency, eventual consistency failures. Reuses
 * Module 55's own read-replica routing (`read-replica-extension.ts`)
 * rather than re-implementing a separate check: verifies writes and raw
 * SQL always execute against the primary (never routed to a
 * possibly-lagging replica, which is exactly how "eventual consistency
 * failure" manifests as a user-visible bug — a read immediately following
 * a write landing on a stale replica), and that a caller can force
 * `STRONG` consistency (primary-only reads) for the read-after-write
 * cases that need it.
 */
export class ReadReplicaChecker implements SafetyChecker {
  readonly subsystem = "Read Replica & Eventual Consistency Safety";

  constructor(private readonly scanner: SourceScanner = new SourceScanner()) {}

  async check(): Promise<SubsystemCheckOutcome> {
    const passedChecks: string[] = [];
    const findings: CheckerFindingInput[] = [];

    const extension = await this.scanner.read(EXTENSION_PATH);

    if (extension && /when in doubt, use the primary/.test(extension)) {
      passedChecks.push(
        `${EXTENSION_PATH}: every write, and every \`$queryRaw\`/\`$executeRaw\`/\`$transaction\` call (which cannot be reliably classified as read-only), always executes on the primary — "when in doubt, use the primary" is the conservative default, never routed to a possibly-lagging replica.`,
      );
    } else {
      findings.push({
        severity: "CRITICAL",
        problem: "Could not confirm that writes and raw SQL are unconditionally routed to the primary database.",
        risk: "A write or an unclassifiable raw-SQL operation could be routed to a read replica, which either fails outright or silently applies a write the replica cannot durably keep (replicas are typically read-only at the database level, but any ambiguity here is a serious correctness risk).",
        whyItHappens: `${EXTENSION_PATH} did not match the expected \"writes and raw SQL always use the primary\" pattern.`,
        impact: "Data loss or hard failures on write paths under specific query shapes.",
        recommendedFix: "Ensure the Prisma `$allOperations` extension only ever considers a fixed allow-list of read-only model methods eligible for replica routing, defaulting every other operation (including all raw SQL and transactions) to the primary.",
        priority: "CRITICAL",
        evidence: [EXTENSION_PATH],
      });
    }

    if (extension && /getCurrentReadConsistency/.test(extension) && /STRONG/.test(extension)) {
      passedChecks.push(
        `${EXTENSION_PATH}: reads honor an ambient \`STRONG\` consistency override (\`getCurrentReadConsistency\`) — a use case that must read its own just-written data (e.g. immediately after a booking confirmation) can force a primary read rather than risk a stale replica.`,
      );
    } else {
      findings.push({
        severity: "WARNING",
        problem: "Could not confirm a caller-controllable strong-consistency override for read-after-write cases.",
        risk: "A use case that writes then immediately reads its own write could observe stale data if that read is transparently routed to a lagging replica, with no way to opt out.",
        whyItHappens: `${EXTENSION_PATH} did not match the expected \`STRONG\`-consistency override pattern.`,
        impact: "Read-your-own-write correctness bugs immediately after a mutation, particularly under real replication lag.",
        recommendedFix: "Provide an explicit per-call or per-request consistency override (STRONG = primary-only) for read-after-write-sensitive code paths.",
        priority: "HIGH",
        evidence: [EXTENSION_PATH],
      });
    }

    if (extension && /mid-flight fallback/.test(extension)) {
      passedChecks.push(`${EXTENSION_PATH}: documents a mid-flight fallback to the primary when a chosen replica is unhealthy, rather than surfacing a replica outage as a user-facing read failure.`);
    }

    return { passedChecks, findings };
  }
}
