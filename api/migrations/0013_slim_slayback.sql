ALTER TABLE "bet" ADD COLUMN "market" text DEFAULT '1x2' NOT NULL;--> statement-breakpoint
ALTER TABLE "bet" ADD COLUMN "line" numeric;--> statement-breakpoint
ALTER TABLE "fixture" ADD COLUMN "markets" jsonb;--> statement-breakpoint
ALTER TABLE "fixture" ADD COLUMN "ht_score1" integer;--> statement-breakpoint
ALTER TABLE "fixture" ADD COLUMN "ht_score2" integer;