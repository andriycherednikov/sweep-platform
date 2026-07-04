CREATE TABLE IF NOT EXISTS "account_session" (
	"token" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "catalog_league" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_league_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"logo" text,
	"country" jsonb,
	"seasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"curated" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "login_token" (
	"token" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_session" ADD CONSTRAINT "account_session_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
