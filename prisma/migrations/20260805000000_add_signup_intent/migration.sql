-- Hand-authored (same caveat as every prior migration in this repo: no
-- Postgres/engine access in this sandbox to run `prisma migrate dev` and
-- have it generate this file from a real diff — see
-- docs/MODULE_19_SEARCH_RANKING.md / docs/MODULE_20_MAPS_GEOLOCATION.md /
-- docs/MODULE_21_DISPUTES_SUPPORT.md, "Validation Results", for the same
-- confirmed precedent). Mirrors what that command would produce for the
-- schema change below. Run the real command once you have a database
-- locally to double-check, then delete this comment block.
--
-- Professional Onboarding feature.
--
-- Purely additive: one brand-new enum (SignupIntent) plus one new
-- nullable column on "users". Nothing existing is renamed, dropped, or
-- altered, and no existing rows need backfilling (a NULL signupIntent is
-- the correct, expected value for every user who existed before this
-- feature shipped).

-- ============================================================================
-- SignupIntent + users.signupIntent
-- ============================================================================
CREATE TYPE "SignupIntent" AS ENUM (
    'CUSTOMER',
    'PROFESSIONAL'
);

ALTER TABLE "users" ADD COLUMN "signupIntent" "SignupIntent";
