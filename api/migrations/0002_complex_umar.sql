CREATE TABLE IF NOT EXISTS "billing_event" (
	"id" serial PRIMARY KEY NOT NULL,
	"stripe_event_id" text NOT NULL,
	"type" text NOT NULL,
	"account_id" text,
	"summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_event_stripe_event_id_unique" UNIQUE("stripe_event_id")
);
--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "stripe_subscription_item_id" text;--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "subscription_status" text;--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "trial_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "trial_reminder_sent_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "account" SET "trial_ends_at" = now() + interval '14 days'
WHERE "trial_ends_at" IS NULL AND "subscription_status" IS NULL
  AND EXISTS (SELECT 1 FROM "sweep" s WHERE s."account_id" = "account"."id" AND s."archived_at" IS NULL);