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
DO $$ BEGIN
 ALTER TABLE "api_contracts" ADD CONSTRAINT "api_contracts_service_id_service_registries_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service_registries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contract_service_endpoint_method_ver_idx" ON "api_contracts" ("service_id","endpoint_path","http_method","version");
