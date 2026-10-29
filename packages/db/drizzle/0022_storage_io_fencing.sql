CREATE TABLE "autograph_processing_artifacts" (
	"lease_token" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"next_check_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	"adopted_at" timestamp with time zone,
	CONSTRAINT "autograph_processing_artifacts_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "autograph_processing_artifacts_state" CHECK ("autograph_processing_artifacts"."retired_at" IS NULL OR "autograph_processing_artifacts"."adopted_at" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "autograph_storage_leases" (
	"slot" integer PRIMARY KEY NOT NULL,
	"operation_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"kind" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "autograph_storage_leases_operation_id_unique" UNIQUE("operation_id"),
	CONSTRAINT "autograph_storage_leases_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "autograph_storage_leases_slot" CHECK (("autograph_storage_leases"."kind" IN ('upload', 'complete') AND "autograph_storage_leases"."slot" BETWEEN 1 AND 4) OR ("autograph_storage_leases"."kind" = 'cleanup' AND "autograph_storage_leases"."slot" = 5)),
	CONSTRAINT "autograph_storage_leases_key" CHECK (length(btrim("autograph_storage_leases"."storage_key")) > 0)
);
--> statement-breakpoint
ALTER TABLE "autograph_assets" ADD COLUMN "retired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "autograph_assets" ADD COLUMN "last_io_token" uuid;--> statement-breakpoint
ALTER TABLE "autograph_processing_artifacts" ADD CONSTRAINT "autograph_processing_artifacts_job_id_autograph_processing_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."autograph_processing_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "autograph_processing_artifacts_due_idx" ON "autograph_processing_artifacts" USING btree ("next_check_at");
--> statement-breakpoint
-- Preserve legacy deterministic output keys before writers are drained/upgraded.
-- A successful DELETE never removes this evidence: old remote PUTs can finish late.
INSERT INTO autograph_processing_artifacts
  (lease_token, job_id, storage_key, lease_expires_at, next_check_at, retired_at, adopted_at)
SELECT coalesce(j.lease_token, gen_random_uuid()), j.id,
  'autographs/' || j.autograph_id::text || '/cleaned/' || j.id::text || '.png',
  clock_timestamp() + interval '15 minutes', clock_timestamp() + interval '15 minutes',
  CASE WHEN aa.id IS NULL THEN clock_timestamp() ELSE NULL END,
  CASE WHEN aa.id IS NOT NULL THEN clock_timestamp() ELSE NULL END
FROM autograph_processing_jobs j LEFT JOIN autograph_assets aa
  ON aa.storage_key = 'autographs/' || j.autograph_id::text || '/cleaned/' || j.id::text || '.png';
