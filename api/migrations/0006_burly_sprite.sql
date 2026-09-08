CREATE TABLE "operator_action" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"target" text,
	"sweep_ids" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "role" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "operator_action" ADD CONSTRAINT "operator_action_actor_id_account_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;