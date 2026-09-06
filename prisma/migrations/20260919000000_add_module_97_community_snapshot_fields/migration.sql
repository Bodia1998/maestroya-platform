-- Hand-authored (same caveat as every prior migration in this repo: no
-- Postgres/Prisma-engine access in this sandbox to run `prisma migrate dev`
-- and have it generate this file from a real diff).
--
-- Module 97 correction pass — "Correct Comunidad de Propietarios IVA
-- Treatment," Step 6 (tax snapshot completeness) and Step 11 (data model
-- inspection).
--
-- Purely additive: two new nullable columns on the existing `quotes`
-- table. No existing table is renamed or dropped, no existing column is
-- altered or removed, and no existing row's behavior changes — both
-- columns are null for every Quote that predates this migration, which is
-- simply true (no Module 97 snapshot was ever computed for those rows).
--
-- Why these two columns: the Module 97 report's Step 6 requires a
-- persisted tax snapshot that can reproduce WHY a rate was selected,
-- "at minimum: customer type ... materials amount/ratio if part of the
-- classification." The prior pass persisted operationType/
-- isResidentialProperty/taxableBase/vatRateBps/vatAmount/
-- grossTotalAmount/taxClassificationCode/taxRequiresLegalConfirmation but
-- not the customer type the classification actually ran against, nor the
-- materials amount that fed the materials-ratio test — both were
-- reachable only by re-deriving them (from CustomerProfile.customerType,
-- which can change after the Quote was created, and from quote_items,
-- which is more indirection than an audit trail should require).

ALTER TABLE "quotes" ADD COLUMN "customerTypeAtQuote" "CustomerType";
ALTER TABLE "quotes" ADD COLUMN "taxMaterialsAmount" DECIMAL(10,2);
