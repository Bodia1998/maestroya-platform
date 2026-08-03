-- Repair migration
-- Previous migration 20260807000000_remove_professional_languages
-- is marked as applied in _prisma_migrations, but the join table still
-- exists in the target database. This migration reconciles the physical
-- schema with the recorded migration history.

DROP TABLE IF EXISTS "_ProfessionalLanguages";