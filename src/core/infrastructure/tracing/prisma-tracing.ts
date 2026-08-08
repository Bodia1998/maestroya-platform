import type { PrismaClient } from "@prisma/client";

import { getTracer } from "@/infrastructure/tracing/compose";

/**
 * Module 51 — Distributed Tracing — the database.
 *
 * Traces **every** Prisma query in the platform from a single place, by
 * extending the client at the one point where it is constructed
 * (`infrastructure/database/prisma/client.ts`).
 *
 * ## Why `$extends`, and why not a repository decorator
 * There are 40+ `Prisma*Repository` classes in
 * `infrastructure/database/prisma/repositories/`. Instrumenting them
 * individually would mean 40+ decorators to write and to keep in sync
 * with every future repository — and would still miss `$queryRaw`
 * (`/api/health/ready`), `$transaction`, and the Auth.js Prisma adapter,
 * none of which go through a repository at all. `$extends`'s
 * `$allOperations` hook sits underneath all of them: one function, total
 * coverage, and **not one repository file is touched** — which is the
 * explicit constraint this module was built under.
 *
 * ## Why not `@prisma/instrumentation`
 * Prisma ships its own OpenTelemetry instrumentation, but it requires
 * enabling the `tracing` preview feature in `schema.prisma` and
 * regenerating the client — a change to the schema and to the generated
 * artifact that every developer and CI job would then have to carry,
 * for spans this hook produces anyway. The one thing the official
 * package adds that this does not is *engine-internal* timing
 * (connection acquisition, serialization, the query the engine actually
 * sent). That is real, and it is a documented, additive upgrade path
 * rather than a prerequisite — see
 * docs/MODULE_51_DISTRIBUTED_TRACING.md §5.
 *
 * ## Attributes
 * Only the operation and the model are recorded — never `args`. Query
 * arguments routinely contain emails, phone numbers, dispute text and
 * password-reset tokens, and a span exported to a third-party collector
 * is exactly as sensitive a destination as a log line, where `logger.ts`
 * already redacts precisely this class of value. Cardinality is bounded
 * by construction: model and operation names are a small closed set.
 */
export function withPrismaTracing<TClient extends PrismaClient>(client: TClient): TClient {
  const tracer = getTracer();
  // Disabled: the client is returned exactly as constructed — no
  // extension, no proxy, no per-query closure. This is the single most
  // performance-sensitive "off" path in the module.
  if (!tracer.enabled) return client;

  const extended = client.$extends({
    name: "maestroya-tracing",
    query: {
      $allOperations({ model, operation, args, query }) {
        return tracer.withSpan(
          // `prisma.User.findMany` / `prisma.$raw.$queryRaw` — the model
          // is absent for raw and `$transaction`-level operations.
          `prisma.${model ?? "$raw"}.${operation}`,
          () => query(args),
          {
            kind: "client",
            attributes: {
              "db.system": "postgresql",
              "db.operation.name": operation,
              "db.collection.name": model ?? undefined,
              "external.system": "postgresql",
            },
          },
        );
      },
    },
  });

  // `$extends` returns a structurally-different (branded) client type
  // that carries the extension in its type parameters. Every member the
  // rest of this codebase uses — the model delegates, `$queryRaw`,
  // `$transaction`, `$disconnect` — is present and identical, but TypeScript
  // cannot see that the two types are interchangeable. Casting back keeps
  // the exported `prisma` symbol's public type exactly what all 40+
  // repositories, the Auth.js adapter and the health route already
  // compile against, so enabling tracing cannot change a single type
  // anywhere else in the codebase. This is the one deliberate cast in the
  // module, and it is confined to this line.
  return extended as unknown as TClient;
}
