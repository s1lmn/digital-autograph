CREATE TABLE "platform_pricing_default" (
	"singleton_id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"pricing_config_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_pricing_default_singleton" CHECK ("platform_pricing_default"."singleton_id" = 1)
);
--> statement-breakpoint
CREATE TABLE "pricing_config_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"algorithm_version" varchar(64) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"base_amount_minor" bigint NOT NULL,
	"minimum_amount_minor" bigint NOT NULL,
	"maximum_amount_minor" bigint NOT NULL,
	"dynamic_takeover_limit" integer NOT NULL,
	"takeover_step_size" integer NOT NULL,
	"step_amount_minor" bigint NOT NULL,
	"decay_interval_seconds" integer NOT NULL,
	"decay_amount_minor" bigint NOT NULL,
	"decay_floor_amount_minor" bigint NOT NULL,
	"guaranteed_visibility_seconds" integer NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_config_algorithm_v1" CHECK ("pricing_config_versions"."algorithm_version" = 'takeover_ladder_v1'),
	CONSTRAINT "pricing_config_currency_rub" CHECK ("pricing_config_versions"."currency" = 'RUB'),
	CONSTRAINT "pricing_config_amounts_valid" CHECK ("pricing_config_versions"."minimum_amount_minor" BETWEEN 1 AND 100000000000 AND "pricing_config_versions"."base_amount_minor" BETWEEN "pricing_config_versions"."minimum_amount_minor" AND "pricing_config_versions"."maximum_amount_minor" AND "pricing_config_versions"."maximum_amount_minor" <= 100000000000 AND "pricing_config_versions"."step_amount_minor" BETWEEN 0 AND 100000000000 AND "pricing_config_versions"."decay_amount_minor" BETWEEN 0 AND 100000000000 AND "pricing_config_versions"."decay_floor_amount_minor" BETWEEN "pricing_config_versions"."minimum_amount_minor" AND "pricing_config_versions"."maximum_amount_minor"),
	CONSTRAINT "pricing_config_steps_valid" CHECK ("pricing_config_versions"."dynamic_takeover_limit" BETWEEN 0 AND 1000000 AND "pricing_config_versions"."takeover_step_size" BETWEEN 1 AND 1000000),
	CONSTRAINT "pricing_config_time_valid" CHECK ("pricing_config_versions"."decay_interval_seconds" BETWEEN 1 AND 2592000 AND "pricing_config_versions"."guaranteed_visibility_seconds" BETWEEN 0 AND 2592000)
);
--> statement-breakpoint
CREATE TABLE "takeover_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wall_id" uuid NOT NULL,
	"slot_id" uuid NOT NULL,
	"target_placement_id" uuid NOT NULL,
	"pricing_config_id" uuid NOT NULL,
	"algorithm_version" varchar(64) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"wall_takeover_count" bigint NOT NULL,
	"last_takeover_at" timestamp with time zone,
	"step_index" bigint NOT NULL,
	"ladder_amount_minor" bigint NOT NULL,
	"decay_intervals_applied" bigint NOT NULL,
	"quoted_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "takeover_quotes_algorithm_v1" CHECK ("takeover_quotes"."algorithm_version" = 'takeover_ladder_v1'),
	CONSTRAINT "takeover_quotes_currency_rub" CHECK ("takeover_quotes"."currency" = 'RUB'),
	CONSTRAINT "takeover_quotes_amount_valid" CHECK ("takeover_quotes"."amount_minor" BETWEEN 1 AND 100000000000 AND "takeover_quotes"."ladder_amount_minor" BETWEEN "takeover_quotes"."amount_minor" AND 100000000000),
	CONSTRAINT "takeover_quotes_snapshot_valid" CHECK ("takeover_quotes"."wall_takeover_count" >= 0 AND "takeover_quotes"."step_index" >= 0 AND "takeover_quotes"."decay_intervals_applied" >= 0 AND (("takeover_quotes"."wall_takeover_count" = 0 AND "takeover_quotes"."last_takeover_at" IS NULL) OR ("takeover_quotes"."wall_takeover_count" > 0 AND "takeover_quotes"."last_takeover_at" IS NOT NULL))),
	CONSTRAINT "takeover_quotes_expiry_valid" CHECK ("takeover_quotes"."expires_at" > "takeover_quotes"."quoted_at")
);
--> statement-breakpoint
ALTER TABLE "walls" ADD COLUMN "pricing_config_id" uuid;--> statement-breakpoint
ALTER TABLE "platform_pricing_default" ADD CONSTRAINT "platform_pricing_default_pricing_config_id_pricing_config_versions_id_fk" FOREIGN KEY ("pricing_config_id") REFERENCES "public"."pricing_config_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_config_versions" ADD CONSTRAINT "pricing_config_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takeover_quotes" ADD CONSTRAINT "takeover_quotes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takeover_quotes" ADD CONSTRAINT "takeover_quotes_wall_id_walls_id_fk" FOREIGN KEY ("wall_id") REFERENCES "public"."walls"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takeover_quotes" ADD CONSTRAINT "takeover_quotes_slot_id_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."slots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takeover_quotes" ADD CONSTRAINT "takeover_quotes_target_placement_id_placements_id_fk" FOREIGN KEY ("target_placement_id") REFERENCES "public"."placements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takeover_quotes" ADD CONSTRAINT "takeover_quotes_pricing_config_id_pricing_config_versions_id_fk" FOREIGN KEY ("pricing_config_id") REFERENCES "public"."pricing_config_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pricing_config_versions_created_idx" ON "pricing_config_versions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "takeover_quotes_user_time_idx" ON "takeover_quotes" USING btree ("user_id","quoted_at");--> statement-breakpoint
CREATE INDEX "takeover_quotes_slot_time_idx" ON "takeover_quotes" USING btree ("slot_id","quoted_at");--> statement-breakpoint
CREATE INDEX "takeover_quotes_target_idx" ON "takeover_quotes" USING btree ("target_placement_id");--> statement-breakpoint
ALTER TABLE "walls" ADD CONSTRAINT "walls_pricing_config_id_pricing_config_versions_id_fk" FOREIGN KEY ("pricing_config_id") REFERENCES "public"."pricing_config_versions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION reject_pricing_evidence_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'pricing versions and quotes are append-only' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER pricing_config_versions_append_only BEFORE UPDATE OR DELETE ON pricing_config_versions
FOR EACH ROW EXECUTE FUNCTION reject_pricing_evidence_mutation();
--> statement-breakpoint
CREATE TRIGGER takeover_quotes_append_only BEFORE UPDATE OR DELETE ON takeover_quotes
FOR EACH ROW EXECUTE FUNCTION reject_pricing_evidence_mutation();
--> statement-breakpoint
CREATE FUNCTION guard_wall_pricing_pin() RETURNS trigger AS $$
BEGIN
  IF OLD.pricing_config_id IS NOT NULL
     AND NEW.pricing_config_id IS DISTINCT FROM OLD.pricing_config_id THEN
    RAISE EXCEPTION 'wall pricing version is pinned' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER walls_pricing_pin_guard BEFORE UPDATE OF pricing_config_id ON walls
FOR EACH ROW EXECUTE FUNCTION guard_wall_pricing_pin();
