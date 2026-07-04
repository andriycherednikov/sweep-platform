ALTER TABLE "sweep" ADD COLUMN "wagering_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "sweep" SET "wagering_enabled" = true;