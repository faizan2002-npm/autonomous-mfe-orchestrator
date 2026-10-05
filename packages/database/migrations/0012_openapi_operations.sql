CREATE TABLE IF NOT EXISTS "service_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"http_method" varchar(16) NOT NULL,
	"path_template" varchar(512) NOT NULL,
	"operation_id" varchar(255),
	"summary" text,
	"response_status" varchar(8) NOT NULL,
	"schema_tokens" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "service_registries" ADD COLUMN "openapi" jsonb;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_operations" ADD CONSTRAINT "service_operations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_operations" ADD CONSTRAINT "service_operations_service_id_service_registries_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service_registries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "service_operations_service_method_path_idx" ON "service_operations" ("service_id","http_method","path_template");