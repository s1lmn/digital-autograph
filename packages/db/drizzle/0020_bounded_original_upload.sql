ALTER TABLE "autograph_assets" ADD COLUMN "upload_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "autographs_created_idx" ON "autographs" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "autograph_assets" ADD CONSTRAINT "autograph_assets_attempts_check" CHECK ("autograph_assets"."upload_attempts" BETWEEN 0 AND 5);