-- Same caveat as every prior migration in this repo: hand-authored to
-- mirror what `npx prisma migrate dev` would generate, not engine-verified
-- (no network access in this environment). Run the real command once you
-- have this locally.

ALTER TABLE "users" ADD COLUMN "timezone" TEXT;
ALTER TABLE "users" ADD COLUMN "notificationPreferences" JSONB;
