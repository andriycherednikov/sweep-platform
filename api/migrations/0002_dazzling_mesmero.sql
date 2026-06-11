ALTER TABLE "photo" DROP CONSTRAINT "photo_team_code_team_code_fk";
--> statement-breakpoint
ALTER TABLE "photo" DROP COLUMN IF EXISTS "team_code";