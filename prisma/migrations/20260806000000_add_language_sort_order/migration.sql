-- Add display-priority ordering to the Language reference table (platform/
-- interface language selection) so the language picker can show the
-- platform's highest-priority languages first, instead of relying on
-- alphabetical order.
ALTER TABLE "languages" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
