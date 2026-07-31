-- Product correction: the Language reference table is for platform/
-- interface language selection (see Language model's own doc comment),
-- not "languages a professional speaks with customers" — there is no such
-- marketplace feature in this domain model. Drops the
-- ProfessionalProfile<->Language join table (added in the original
-- 20260717000000_init_domain_model migration, wired up briefly during this
-- stabilization pass, and never used by any shipped UI). No data loss of
-- consequence: this table only ever held join rows for a feature that was
-- never actually exposed to a real user.
DROP TABLE IF EXISTS "_ProfessionalLanguages";
