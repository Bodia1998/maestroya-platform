-- Hand-authored (same caveat as every prior migration in this repo: no
-- Postgres/engine access in this environment to run `prisma migrate dev`
-- and have it generate this file from a real diff — see
-- docs/MODULE_16_ADMIN_PANEL.md, "Environment limitations", and
-- docs/MODULE_19_SEARCH_RANKING.md, "Validation Results", for the same
-- confirmed precedent). Mirrors what that command would produce for the
-- indexes below. Run the real command once you have a database locally to
-- double-check.
--
-- Module 20 — Maps & Geolocation. This migration is index-only: it adds no
-- new tables, columns, or enums. `Address.latitude`/`.longitude` (added in
-- Module 02 — see 20260718000000_add_geo_and_settings) and
-- `CompanyProfile.latitude`/`.longitude` (added in Module 18 — see
-- 20260730000000_add_company_professional_module) already exist; Module 20
-- only adds the composite indexes its own bounding-box radius pre-filter
-- (`computeBoundingBox`, pushed down by
-- PrismaProfessionalDiscoveryRepository.searchCandidates /
-- PrismaCompanyDiscoveryRepository.searchCandidates) needs to avoid a full
-- table scan when both filters in the composite range predicate are used
-- together.
--
-- Purely additive and backward-compatible: CREATE INDEX never touches
-- existing data, and every index below is on columns that already exist.

-- ============================================================================
-- Addresses — bounding-box radius pre-filter
-- (ProfessionalDiscoveryRepository.searchCandidates)
-- ============================================================================
CREATE INDEX "addresses_latitude_longitude_idx" ON "addresses"("latitude", "longitude");

-- ============================================================================
-- Company profiles — bounding-box radius pre-filter
-- (CompanyDiscoveryRepository.searchCandidates)
-- ============================================================================
CREATE INDEX "company_profiles_latitude_longitude_idx" ON "company_profiles"("latitude", "longitude");
