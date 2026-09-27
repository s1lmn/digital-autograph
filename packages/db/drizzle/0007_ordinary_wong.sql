CREATE TYPE "public"."autograph_processing_job_status" AS ENUM('queued', 'processing', 'succeeded', 'failed');--> statement-breakpoint
ALTER TYPE "public"."autograph_asset_role" ADD VALUE 'cleaned';--> statement-breakpoint
ALTER TYPE "public"."autograph_status" ADD VALUE 'processing';--> statement-breakpoint
ALTER TYPE "public"."autograph_status" ADD VALUE 'awaiting_approval';--> statement-breakpoint
ALTER TYPE "public"."autograph_status" ADD VALUE 'processing_failed';--> statement-breakpoint
