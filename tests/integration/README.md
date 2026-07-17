# Integration Tests

Tests that exercise a real Prisma-backed repository against a real (test)
Postgres database — verifying infrastructure implementations satisfy the
domain-layer repository interfaces they implement. Distinct from
`tests/unit`, which never touches a database.

Empty on purpose — no repository implementations exist yet.
