CREATE TABLE "original_upload_tombstones" (
	"storage_key" text PRIMARY KEY NOT NULL,
	"next_check_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "original_upload_tombstones_next_idx" ON "original_upload_tombstones" USING btree ("next_check_at");