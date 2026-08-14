/**
 * Module 62 — Professional Onboarding: integration tests reuse the exact
 * same in-memory fakes as the unit tests (one set of test doubles per
 * module, same convention `tests/integration/verification/` follows by
 * defining its own — here we simply re-export rather than duplicate, since
 * these fakes have no dependency on the unit-test directory beyond path).
 */
export * from "../../unit/core/application/use-cases/onboarding/fakes";
