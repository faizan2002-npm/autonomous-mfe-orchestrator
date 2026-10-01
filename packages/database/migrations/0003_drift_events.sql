DO $$ BEGIN
 CREATE TYPE "public"."drift_type" AS ENUM('FIELD_RENAMED', 'FIELD_DELETED', 'FIELD_ADDED', 'TYPE_CHANGED', 'STRUCTURE_MUTATION', 'MULTI_FIELD_MUTATION');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."severity" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "drift_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"drift_type" "drift_type" NOT NULL,
	"severity" "severity" DEFAULT 'LOW' NOT NULL,
	"drift_coefficient" double precision NOT NULL,
	"observed_payload" jsonb NOT NULL,
	"diff_details" jsonb NOT NULL,
	"is_breaking" boolean NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "drift_events" ADD CONSTRAINT "drift_events_contract_id_api_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."api_contracts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "drift_events" ADD CONSTRAINT "drift_events_service_id_service_registries_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service_registries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
