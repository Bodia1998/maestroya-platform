import "server-only";

import type { CheckerFindingInput, SafetyChecker, SubsystemCheckOutcome } from "@/application/ports/safety-checker";
import { SourceScanner } from "@/infrastructure/multi-instance-safety/source-scanner";

const AUTH_CONFIG_PATH = "src/core/infrastructure/auth/auth-config.ts";
const TOKENS_PATH = "src/core/infrastructure/auth/tokens.ts";

/**
 * Module 58 — Multi-Instance Safety Audit.
 *
 * Covers: JWT session compatibility across nodes, refresh-token safety,
 * session storage. Verifies `authConfig` (`auth-config.ts`) uses Auth.js's
 * `"jwt"` session strategy (a signed, stateless bearer token any instance
 * can verify with the shared `AUTH_SECRET` — no server-side session store
 * to keep consistent across instances) rather than `"database"` sessions
 * pinned to whichever instance wrote them, and that refresh/reset/
 * verification tokens (`tokens.ts`) are only ever persisted as a
 * SHA-256 hash in the database (`RefreshToken`/`PasswordResetToken`/
 * `EmailVerificationToken` — Prisma-backed, therefore shared across every
 * instance by construction) rather than in a process-local structure a
 * request landing on a different instance could never see.
 */
export class StatelessAuthSessionChecker implements SafetyChecker {
  readonly subsystem = "Authentication, Sessions & Refresh Tokens";

  constructor(private readonly scanner: SourceScanner = new SourceScanner()) {}

  async check(): Promise<SubsystemCheckOutcome> {
    const passedChecks: string[] = [];
    const findings: CheckerFindingInput[] = [];

    const authConfig = await this.scanner.read(AUTH_CONFIG_PATH);
    if (authConfig && /strategy:\s*["']jwt["']/.test(authConfig)) {
      passedChecks.push(
        `${AUTH_CONFIG_PATH}: session strategy is "jwt" — sessions are a signed, stateless token any instance can verify, not a server-side session pinned to the instance that created it.`,
      );
    } else {
      findings.push({
        severity: "CRITICAL",
        problem: 'Auth.js session strategy is not statically confirmed as "jwt".',
        risk: "A request whose session was established on one instance could be rejected or fail to resolve on another instance behind the load balancer.",
        whyItHappens: `${AUTH_CONFIG_PATH} could not be read, or no \`strategy: "jwt"\` was found in its \`session\` block.`,
        impact: "Users would experience intermittent forced logouts or authentication failures depending on which instance a request lands on.",
        recommendedFix: 'Set `session: { strategy: "jwt" }` in the Auth.js config, or add a shared (Redis/DB-backed) session store if "database" sessions are required.',
        priority: "CRITICAL",
        evidence: [AUTH_CONFIG_PATH],
      });
    }

    if (authConfig && /PrismaAdapter\(prisma\)/.test(authConfig)) {
      passedChecks.push(
        `${AUTH_CONFIG_PATH}: OAuth account linking is backed by \`PrismaAdapter\` (the shared database), not an in-process store — consistent across every instance.`,
      );
    }

    const tokens = await this.scanner.read(TOKENS_PATH);
    if (tokens && /hashToken/.test(tokens) && /createHash\("sha256"\)/.test(tokens)) {
      passedChecks.push(
        `${TOKENS_PATH}: refresh/reset/verification tokens are hashed and (per auth-config.ts's own doc comment) persisted only in the shared database — any instance can validate a token issued by any other instance.`,
      );
    } else {
      findings.push({
        severity: "WARNING",
        problem: "Could not statically confirm that refresh/reset tokens are hashed before persistence.",
        risk: "If a token were ever stored in-memory or in plaintext outside the shared database, validation would be instance-local, and a leaked database dump would hand out usable tokens.",
        whyItHappens: `${TOKENS_PATH} did not match the expected \`hashToken\`/SHA-256 pattern this audit checks for.`,
        impact: "Session/refresh-token validation could become inconsistent across instances, or tokens could be exposed if the file's hashing approach changed without this checker being updated.",
        recommendedFix: "Confirm token hashing (SHA-256 or stronger) still happens before any token value is persisted, and that the database (not an in-process Map) remains the source of truth.",
        priority: "MEDIUM",
        evidence: [TOKENS_PATH],
      });
    }

    return { passedChecks, findings };
  }
}
