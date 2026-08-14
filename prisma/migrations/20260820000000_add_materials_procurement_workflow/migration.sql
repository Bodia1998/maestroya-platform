-- Hand-authored (same caveat as every prior migration in this repo: no
-- Postgres/Prisma-engine access in this sandbox to run `prisma migrate dev`
-- and have it generate this file from a real diff — see
-- prisma/migrations/20260819000000_add_professional_onboarding_module/
-- migration.sql for the same confirmed precedent). Mirrors what that
-- command would produce for the schema changes below. Run the real command
-- once you have a database locally to double-check, then delete this
-- comment block.
--
-- Module 63 — Materials Procurement Workflow.
--
-- Purely additive: one new enum, one new table, three new nullable/
-- defaulted columns on the existing `quotes` table, and one new
-- NotificationType enum value. No existing table is renamed or dropped,
-- and no existing column is altered or removed.

-- 1. Materials Procurement Workflow enum — who sources the materials a
--    Quote's work requires. Defaults to PROFESSIONAL_SUPPLIED (see below)
--    so every pre-Module-63 quote keeps behaving exactly as before.
CREATE TYPE "MaterialsStrategy" AS ENUM ('PROFESSIONAL_SUPPLIED', 'CUSTOMER_PURCHASED');

-- 2. New columns on the existing `quotes` table. `materialsStrategy` is
--    NOT NULL with a default so this backfills every existing row as
--    PROFESSIONAL_SUPPLIED without a separate UPDATE statement.
--    `materialsConfirmedAt`/`materialsConfirmedByUserId` stay nullable —
--    both are null for every PROFESSIONAL_SUPPLIED quote, and null for a
--    CUSTOMER_PURCHASED quote until the customer confirms (see
--    ConfirmMaterialsPurchasedUseCase).
ALTER TABLE "quotes" ADD COLUMN "materialsStrategy" "MaterialsStrategy" NOT NULL DEFAULT 'PROFESSIONAL_SUPPLIED';
ALTER TABLE "quotes" ADD COLUMN "materialsConfirmedAt" TIMESTAMP(3);
ALTER TABLE "quotes" ADD COLUMN "materialsConfirmedByUserId" UUID;

-- 3. Required-materials checklist a professional attaches to a Quote when
--    materialsStrategy is CUSTOMER_PURCHASED — e.g. "Bosch Condens 2300iW
--    boiler", qty 1. No price/amount column, unlike `quote_items` — this
--    list only ever tells the customer what to buy, never prices anything.
CREATE TABLE "quote_materials" (
    "id" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "quantity" DECIMAL(10,2) NOT NULL,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "quote_materials_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "quote_materials_quoteId_idx" ON "quote_materials"("quoteId");

ALTER TABLE "quote_materials"
  ADD CONSTRAINT "quote_materials_quoteId_fkey"
  FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Row Level Security: every table gets RLS enabled with zero policies
--    (default-deny for the non-owner `anon`/`authenticated` Supabase
--    roles) per the checklist in
--    prisma/migrations/20260811000000_enable_row_level_security/
--    migration.sql ("If a future migration adds a new model, its
--    migration must add a matching ALTER TABLE ... ENABLE ROW LEVEL
--    SECURITY line"). The app's own `postgres`-owned Prisma connection is
--    unaffected (table owners bypass RLS by default).
ALTER TABLE "public"."quote_materials" ENABLE ROW LEVEL SECURITY;

-- 5. NotificationType.MATERIALS_PURCHASE_CONFIRMED — sent to the Quote's
--    submitting professional when the customer confirms (via
--    ConfirmMaterialsPurchasedUseCase) that every required material has
--    been purchased. Postgres requires adding an enum value outside any
--    transaction the migration runner wraps around it, hence the
--    standalone ALTER TYPE statement below (same shape every other
--    enum-value-only migration in this repo already uses — see
--    prisma/migrations/20260813000000_add_review_response_notification_and_index/
--    migration.sql).
ALTER TYPE "NotificationType" ADD VALUE 'MATERIALS_PURCHASE_CONFIRMED';
