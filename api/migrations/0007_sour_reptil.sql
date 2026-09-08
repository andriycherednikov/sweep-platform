ALTER TABLE "account" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "account_session" ADD COLUMN "via" text DEFAULT 'link' NOT NULL;