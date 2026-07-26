import "server-only";

import { env } from "@/infrastructure/config/env";

/**
 * Production-grade structured logging (Module 25 — Production
 * Infrastructure).
 *
 * Server-side only — never import from a Client Component. Emits one
 * JSON object per line to stdout/stderr, the shape a log aggregator
 * (Datadog, CloudWatch, Grafana Loki, a container platform's own log
 * collector, etc.) expects, rather than the free-form strings
 * `console.log` produces elsewhere in this codebase today.
 *
 * This intentionally does not replace every existing `console.log`/
 * `console.error` call across the codebase — that would be a large,
 * risky, unrelated-modules-touching change out of scope for Module 25.
 * Instead, this is the logger new production-infrastructure code (health
 * checks, request correlation, error handling) uses, and the natural
 * place other modules can adopt incrementally.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Keys whose values must never appear in a log line, even nested inside
 * a metadata object. Matched case-insensitively against object keys.
 * Deliberately broad — false positives (redacting a harmless field named
 * e.g. `tokenCount`) are an acceptable trade-off for never leaking a real
 * secret.
 */
const REDACTED_KEY_PATTERN =
  /password|passwd|secret|token|apikey|api_key|authorization|cookie|session|refresh|credential|ssn|creditcard|card_?number|cvv/i;

const REDACTED_VALUE = "[REDACTED]";

function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, seen));
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      // Stack traces can contain file paths; kept here (server-side log
      // only, never sent to a client — see errors.ts for the
      // client-facing boundary) because they're essential for debugging.
      stack: value.stack,
    };
  }

  if (typeof value === "object") {
    if (seen.has(value)) return "[CIRCULAR]";
    seen.add(value);

    const output: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      output[key] = REDACTED_KEY_PATTERN.test(key) ? REDACTED_VALUE : redact(val, seen);
    }
    return output;
  }

  return value;
}

export interface LogFields {
  requestId?: string;
  [key: string]: unknown;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  event: string;
  message?: string;
  requestId?: string;
  [key: string]: unknown;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[env.LOG_LEVEL];
}

function write(level: LogLevel, event: string, fields?: LogFields) {
  if (!shouldLog(level)) return;

  const { requestId, ...rest } = fields ?? {};

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...(requestId ? { requestId } : {}),
    ...(redact(rest) as Record<string, unknown>),
  };

  const line = JSON.stringify(entry);

  // This is the logging transport itself — the one place in the codebase
  // where writing to console.log/console.error directly is correct
  // rather than a shortcut around structured logging.
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const logger = {
  debug: (event: string, fields?: LogFields) => write("debug", event, fields),
  info: (event: string, fields?: LogFields) => write("info", event, fields),
  warn: (event: string, fields?: LogFields) => write("warn", event, fields),
  error: (event: string, fields?: LogFields) => write("error", event, fields),
};

/** Exposed for tests only. */
export const __testing = { redact, shouldLog };
