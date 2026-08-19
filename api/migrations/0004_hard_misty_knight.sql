ALTER TABLE "account" ADD COLUMN "cancel_at_period_end" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "current_period_end" timestamp with time zone;