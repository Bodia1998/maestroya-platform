import "server-only";

import { readdir } from "node:fs/promises";
import path from "node:path";

import type { CheckerFindingInput, SafetyChecker, SubsystemCheckOutcome } from "@/application/ports/safety-checker";
import { SourceScanner } from "@/infrastructure/multi-instance-safety/source-scanner";

const REPOSITORIES_DIR = "src/core/infrastructure/database/prisma/repositories";
const QUOTE_ACCEPTANCE_REPO_PATH = `${REPOSITORIES_DIR}/prisma-quote-acceptance-repository.ts`;

/**
 * Module 58 — Multi-Instance Safety Audit.
 *
 * Covers: lost update detection, optimistic concurrency, pessimistic
 * locking, Prisma transaction safety, database consistency, broken
 * transactions.
 *
 * This codebase's actual optimistic-concurrency pattern — verified
 * directly, not assumed — is not a dedicated `version` column, it is a
 * **conditional atomic `updateMany` (matching the expected prior state)
 * followed by a `count === 0` check**, run inside a Prisma `$transaction`.
 * `PrismaQuoteAcceptanceRepository.acceptQuote` is the clearest worked
 * example: a second instance racing to accept the same quote (or a
 * customer racing to cancel the underlying request) always loses the
 * `updateMany`'s `count`-check and rolls back with a `ConflictError`,
 * rather than silently overwriting the first acceptance — this is a
 * correct, well-understood lost-update guard (the same shape as a
 * `WHERE version = :expected` optimistic-lock update), just keyed on a
 * domain status column instead of a synthetic version counter, which
 * this checker treats as equivalent, not inferior.
 *
 * This checker verifies that exact pattern in the one place it matters
 * most for money/booking correctness (`acceptQuote`, a genuine two-writer
 * race: two professionals' quotes, or an accept racing a cancel), and
 * separately measures how widely the same guarded-`updateMany` shape is
 * reused elsewhere in the repository layer.
 */
export class TransactionConcurrencyChecker implements SafetyChecker {
  readonly subsystem = "Transactions, Optimistic Concurrency & Lost Updates";

  constructor(private readonly scanner: SourceScanner = new SourceScanner()) {}

  async check(): Promise<SubsystemCheckOutcome> {
    const passedChecks: string[] = [];
    const findings: CheckerFindingInput[] = [];

    const acceptance = await this.scanner.read(QUOTE_ACCEPTANCE_REPO_PATH);
    const hasTransaction = acceptance ? /\$transaction/.test(acceptance) : false;
    const hasGuardedUpdate = acceptance ? /updateMany[\s\S]{0,400}status:\s*\{\s*in:/.test(acceptance) : false;
    const hasCountCheck = acceptance ? /\.count\s*===\s*0/.test(acceptance) : false;

    if (hasTransaction && hasGuardedUpdate && hasCountCheck) {
      passedChecks.push(
        `${QUOTE_ACCEPTANCE_REPO_PATH}: quote acceptance runs inside a single \`$transaction\`, guards its state transition with a conditional \`updateMany\` (matching id + expected prior status) and rolls back with \`ConflictError\` on \`count === 0\` — a correct lost-update guard against two concurrent accept attempts landing on different instances.`,
      );
    } else {
      findings.push({
        severity: "CRITICAL",
        problem: "The quote-acceptance write path does not clearly combine a database transaction with a conditional, count-checked update.",
        risk: "Two instances racing to accept competing quotes for the same service request (or an accept racing a cancellation) could both succeed, double-booking a customer or leaving inconsistent quote/request state.",
        whyItHappens: `${QUOTE_ACCEPTANCE_REPO_PATH} did not match the expected \`$transaction\` + guarded \`updateMany\` + \`count === 0\` rollback pattern this audit checks for.`,
        impact: "A classic lost-update race: the second writer silently overwrites the first, rather than being rejected.",
        recommendedFix: "Guard every state-transition write with a conditional `updateMany` matching the expected prior state, check `count === 0` to detect a lost race, and run the whole operation inside a single `$transaction`.",
        priority: "CRITICAL",
        evidence: [QUOTE_ACCEPTANCE_REPO_PATH],
      });
    }

    const repoDir = path.join(process.cwd(), REPOSITORIES_DIR);
    let guardedUpdateFileCount = 0;
    let totalRepoFiles = 0;
    try {
      const entries = await readdir(repoDir);
      totalRepoFiles = entries.filter((e) => e.endsWith(".ts")).length;
      for (const entry of entries) {
        if (!entry.endsWith(".ts")) continue;
        const content = await this.scanner.read(`${REPOSITORIES_DIR}/${entry}`);
        if (content && /count\s*===\s*0/.test(content)) guardedUpdateFileCount += 1;
      }
    } catch {
      // repository directory unreadable in this environment — handled by the finding below
    }

    if (totalRepoFiles > 0) {
      passedChecks.push(
        `${REPOSITORIES_DIR}: ${guardedUpdateFileCount} of ${totalRepoFiles} repository files use the guarded-update-plus-count-check pattern for detecting a lost concurrent write.`,
      );
      if (guardedUpdateFileCount < 3) {
        findings.push({
          severity: "WARNING",
          problem: `Only ${guardedUpdateFileCount} repository file(s) in ${REPOSITORIES_DIR} use a count-checked conditional update.`,
          risk: "Other multi-step, state-transitioning write paths (bookings, payments, verification workflows) may be vulnerable to the same lost-update race that `acceptQuote` explicitly guards against.",
          whyItHappens: "The guarded-update pattern is applied per call site, not enforced by a shared abstraction — a new or existing write path can easily omit it.",
          impact: "Silent lost updates under concurrent writes from two application instances, most likely under real production traffic rather than in any single-instance test.",
          recommendedFix: "Audit every multi-step state-transition write (not just quote acceptance) for the same conditional-updateMany-plus-count-check guard, and consider extracting a small shared helper so the pattern is easy to apply consistently.",
          priority: "MEDIUM",
          evidence: [REPOSITORIES_DIR],
        });
      }
    } else {
      findings.push({
        severity: "WARNING",
        problem: "Could not enumerate the Prisma repository directory to measure how widely the lost-update guard pattern is applied.",
        risk: "Coverage of this pattern across the repository layer could not be statically measured in this environment.",
        whyItHappens: `${REPOSITORIES_DIR} could not be read (unexpected in a normal checkout).`,
        impact: "Reduced audit confidence for this subsystem beyond the single verified `acceptQuote` case.",
        recommendedFix: "Re-run this audit from a full repository checkout with read access to src/core/infrastructure/database/prisma/repositories.",
        priority: "LOW",
        evidence: [REPOSITORIES_DIR],
      });
    }

    return { passedChecks, findings };
  }
}
