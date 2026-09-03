ALTER TABLE "sync_log" ADD COLUMN "competition_id" text;--> statement-breakpoint
CREATE INDEX "sync_log_competition_kind_ran_at_idx" ON "sync_log" USING btree ("competition_id","kind","ran_at");