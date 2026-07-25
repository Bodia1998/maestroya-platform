-- Hand-authored (same caveat as every prior migration in this repo: no
-- Postgres/engine access in this environment to run `prisma migrate dev` and
-- have it generate this file from a real diff). Mirrors what that command
-- would produce for the schema changes below. Run the real command once you
-- have a database locally to double-check.
--
-- Module 19 — Search & Ranking. This migration is index-only: it adds no
-- new tables, columns, or enums. Every filter Module 19 needs (category
-- join, verification status, rating threshold, review count, city/province)
-- already exists as a column on ProfessionalProfile / CompanyProfile /
-- Address from earlier modules; ranking itself is computed in the
-- application layer (see src/core/domain/services/ranking-engine.ts), not
-- pushed into SQL ORDER BY, so no new sortable/computed column is needed
-- either.
--
-- Purely additive and backward-compatible: CREATE INDEX never touches
-- existing data, and every index below is on a column that already exists.

-- ============================================================================
-- Addresses — city-based location matching
-- (ProfessionalDiscoveryRepository.searchCandidates)
-- ============================================================================
CREATE INDEX "addresses_city_idx" ON "addresses"("city");

-- ============================================================================
-- Professional profiles — minRating filtering
-- (ProfessionalDiscoveryRepository.searchCandidates)
-- ============================================================================
CREATE INDEX "professional_profiles_averageRating_idx" ON "professional_profiles"("averageRating");

-- ============================================================================
-- Company profiles — city/province location matching and minRating filtering
-- (CompanyDiscoveryRepository.searchCandidates)
-- ============================================================================
CREATE INDEX "company_profiles_city_idx" ON "company_profiles"("city");
CREATE INDEX "company_profiles_province_idx" ON "company_profiles"("province");
CREATE INDEX "company_profiles_averageRating_idx" ON "company_profiles"("averageRating");
