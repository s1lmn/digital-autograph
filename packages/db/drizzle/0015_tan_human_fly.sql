CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"state" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_delivery_state" CHECK ("notification_deliveries"."channel" IN ('web','telegram') AND "notification_deliveries"."state" IN ('queued','sending','sent','retry','uncertain','failed','suppressed') AND "notification_deliveries"."attempts" BETWEEN 0 AND 5)
);
--> statement-breakpoint
CREATE TABLE "notification_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"wall_id" uuid NOT NULL,
	"slot_id" uuid,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"web" boolean DEFAULT true NOT NULL,
	"telegram" boolean DEFAULT false NOT NULL,
	"muted_kinds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"chat_id" text,
	"consent_at" timestamp with time zone,
	"link_hash" text,
	"link_expires_at" timestamp with time zone,
	"linked_at" timestamp with time zone,
	CONSTRAINT "notification_telegram_consent" CHECK (NOT "notification_preferences"."telegram" OR ("notification_preferences"."chat_id" IS NOT NULL AND "notification_preferences"."consent_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "notification_subscriptions" (
	"user_id" uuid NOT NULL,
	"wall_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_subscriptions_user_id_wall_id_pk" PRIMARY KEY("user_id","wall_id")
);
--> statement-breakpoint
CREATE TABLE "share_interactions" (
	"share_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "share_interactions_share_id_kind_dedupe_key_pk" PRIMARY KEY("share_id","kind","dedupe_key"),
	CONSTRAINT "share_interaction_kind" CHECK ("share_interactions"."kind" IN ('share_clicked','referral_arrived'))
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wall_id" uuid NOT NULL,
	"slot_id" uuid,
	"placement_id" uuid,
	"public_alias" varchar(40),
	"event" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_event_id_notification_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."notification_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_wall_id_walls_id_fk" FOREIGN KEY ("wall_id") REFERENCES "public"."walls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_slot_id_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_subscriptions" ADD CONSTRAINT "notification_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_subscriptions" ADD CONSTRAINT "notification_subscriptions_wall_id_walls_id_fk" FOREIGN KEY ("wall_id") REFERENCES "public"."walls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_interactions" ADD CONSTRAINT "share_interactions_share_id_share_links_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."share_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_wall_id_walls_id_fk" FOREIGN KEY ("wall_id") REFERENCES "public"."walls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_slot_id_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_placement_id_placements_id_fk" FOREIGN KEY ("placement_id") REFERENCES "public"."placements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_delivery_identity" ON "notification_deliveries" USING btree ("event_id","channel");--> statement-breakpoint
CREATE INDEX "notification_delivery_queue" ON "notification_deliveries" USING btree ("state","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_event_source_uidx" ON "notification_events" USING btree ("source_key");--> statement-breakpoint
CREATE INDEX "notification_event_pending_idx" ON "notification_events" USING btree ("processed_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_chat_uidx" ON "notification_preferences" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "share_links_user_time_idx" ON "share_links" USING btree ("user_id","created_at");