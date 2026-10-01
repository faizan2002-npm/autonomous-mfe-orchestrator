DO $$ BEGIN
 CREATE TYPE "public"."service_status" AS ENUM('HEALTHY', 'DEGRADED', 'DRIFTING', 'FAILING');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
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
DO $$ BEGIN
 CREATE TYPE "public"."patch_status" AS ENUM('GENERATING', 'VALIDATED', 'CANARY', 'ACTIVE', 'FAILED', 'SUPERSEDED', 'ROLLED_BACK');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."governance_status" AS ENUM('AUTO_APPROVED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'ESCALATED');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_registries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_name" varchar(255) NOT NULL,
	"service_type" varchar(64) NOT NULL,
	"endpoint_url" varchar(512) NOT NULL,
	"mfe_consumer" varchar(255) NOT NULL,
	"status" "service_status" DEFAULT 'HEALTHY' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_registries_service_name_unique" UNIQUE("service_name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"endpoint_path" varchar(512) NOT NULL,
	"http_method" varchar(16) NOT NULL,
	"schema_snapshot" jsonb NOT NULL,
	"field_count" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
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
CREATE TABLE IF NOT EXISTS "canary_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patch_id" uuid NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"baseline_requests" integer NOT NULL,
	"baseline_errors" integer NOT NULL,
	"canary_requests" integer NOT NULL,
	"canary_errors" integer NOT NULL,
	"avg_latency_ms" double precision NOT NULL,
	"promoted" boolean DEFAULT false NOT NULL,
	"evaluation_notes" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "governance_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"drift_event_id" uuid NOT NULL,
	"patch_id" uuid,
	"status" "governance_status" DEFAULT 'PENDING_REVIEW' NOT NULL,
	"reviewer" varchar(255),
	"review_notes" text,
	"reasoning_trace" text NOT NULL,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "api_contracts" ADD CONSTRAINT "api_contracts_service_id_service_registries_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service_registries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
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
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "canary_metrics" ADD CONSTRAINT "canary_metrics_patch_id_patch_registries_id_fk" FOREIGN KEY ("patch_id") REFERENCES "public"."patch_registries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "governance_audits" ADD CONSTRAINT "governance_audits_drift_event_id_drift_events_id_fk" FOREIGN KEY ("drift_event_id") REFERENCES "public"."drift_events"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "governance_audits" ADD CONSTRAINT "governance_audits_patch_id_patch_registries_id_fk" FOREIGN KEY ("patch_id") REFERENCES "public"."patch_registries"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contract_service_endpoint_method_ver_idx" ON "api_contracts" ("service_id","endpoint_path","http_method","version");