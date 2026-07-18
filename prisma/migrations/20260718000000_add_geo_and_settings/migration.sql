-- Same caveat as the init migration: hand-authored to mirror what
-- `npx prisma migrate dev` would generate, not engine-verified (no network
-- access in this environment). Replace with a real `prisma migrate dev`
-- run once you have this locally — see the init migration's header for
-- the full explanation.

-- ============================================================================
-- CreateTable
-- ============================================================================
CREATE TABLE "countries" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "countries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "provinces" (
    "id" UUID NOT NULL,
    "countryId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "provinces_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cities" (
    "id" UUID NOT NULL,
    "provinceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "platform_settings" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- CreateIndex
-- ============================================================================
CREATE UNIQUE INDEX "countries_code_key" ON "countries"("code");

CREATE UNIQUE INDEX "provinces_countryId_name_key" ON "provinces"("countryId", "name");
CREATE INDEX "provinces_countryId_idx" ON "provinces"("countryId");

CREATE UNIQUE INDEX "cities_provinceId_name_key" ON "cities"("provinceId", "name");
CREATE INDEX "cities_provinceId_idx" ON "cities"("provinceId");

CREATE UNIQUE INDEX "platform_settings_key_key" ON "platform_settings"("key");

-- ============================================================================
-- AddForeignKey
-- ============================================================================
ALTER TABLE "provinces" ADD CONSTRAINT "provinces_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "countries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cities" ADD CONSTRAINT "cities_provinceId_fkey" FOREIGN KEY ("provinceId") REFERENCES "provinces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
