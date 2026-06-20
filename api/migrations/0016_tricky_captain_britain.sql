ALTER TABLE "fixture" ADD COLUMN "reg_score1" integer;--> statement-breakpoint
ALTER TABLE "fixture" ADD COLUMN "reg_score2" integer;
--> statement-breakpoint
UPDATE "fixture" SET "reg_score1" = "score1", "reg_score2" = "score2" WHERE "reg_score1" IS NULL;