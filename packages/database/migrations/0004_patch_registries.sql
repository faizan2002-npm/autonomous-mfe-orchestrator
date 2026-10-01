DO $$ BEGIN
 CREATE TYPE "public"."patch_status" AS ENUM('GENERATING', 'VALIDATED', 'CANARY', 'ACTIVE', 'FAILED', 'SUPERSEDED', 'ROLLED_BACK');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "patch_registries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"drift_event_id" uuid NOT NULL,
	"adapter_code" text NOT NULL,
	"adapter_signature" varchar(255) NOT NULL,
	"confidence_score" double precision NOT NULL,
	"status" "patch_status" DEFAULT 'GENERATING' NOT NULL,
	"canary_percent" integer DEFAULT 0 NOT NULL,
	"deployed_at" timestamp with time zone,
	"rolled_back_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "patch_registries" ADD CONSTRAINT "patch_registries_contract_id_api_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."api_contracts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "patch_registries" ADD CONSTRAINT "patch_registries_drift_event_id_drift_events_id_fk" FOREIGN KEY ("drift_event_id") REFERENCES "public"."drift_events"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
