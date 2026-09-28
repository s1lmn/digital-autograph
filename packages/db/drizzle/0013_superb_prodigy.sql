CREATE TYPE "public"."takeover_reservation_status" AS ENUM('active', 'expired', 'cancelled');--> statement-breakpoint
CREATE TABLE "takeover_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"wall_id" uuid NOT NULL,
	"slot_id" uuid NOT NULL,
	"target_placement_id" uuid NOT NULL,
	"pricing_config_id" uuid NOT NULL,
	"currency" varchar(3) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"idempotency_key_hash" varchar(64) NOT NULL,
	"status" "takeover_reservation_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	CONSTRAINT "takeover_reservations_currency_rub" CHECK ("takeover_reservations"."currency" = 'RUB'),
	CONSTRAINT "takeover_reservations_amount_valid" CHECK ("takeover_reservations"."amount_minor" BETWEEN 1 AND 100000000000),
	CONSTRAINT "takeover_reservations_hash_valid" CHECK ("takeover_reservations"."idempotency_key_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "takeover_reservations_expiry_valid" CHECK ("takeover_reservations"."expires_at" > "takeover_reservations"."created_at"),
	CONSTRAINT "takeover_reservations_state_valid" CHECK (("takeover_reservations"."status" = 'active' AND "takeover_reservations"."cancelled_at" IS NULL AND "takeover_reservations"."expired_at" IS NULL) OR ("takeover_reservations"."status" = 'cancelled' AND "takeover_reservations"."cancelled_at" IS NOT NULL AND "takeover_reservations"."expired_at" IS NULL AND "takeover_reservations"."cancelled_at" >= "takeover_reservations"."created_at") OR ("takeover_reservations"."status" = 'expired' AND "takeover_reservations"."expired_at" IS NOT NULL AND "takeover_reservations"."cancelled_at" IS NULL AND "takeover_reservations"."expired_at" >= "takeover_reservations"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "takeover_reservations" ADD CONSTRAINT "takeover_reservations_quote_id_takeover_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."takeover_quotes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takeover_reservations" ADD CONSTRAINT "takeover_reservations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takeover_reservations" ADD CONSTRAINT "takeover_reservations_wall_id_walls_id_fk" FOREIGN KEY ("wall_id") REFERENCES "public"."walls"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takeover_reservations" ADD CONSTRAINT "takeover_reservations_slot_id_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."slots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takeover_reservations" ADD CONSTRAINT "takeover_reservations_target_placement_id_placements_id_fk" FOREIGN KEY ("target_placement_id") REFERENCES "public"."placements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takeover_reservations" ADD CONSTRAINT "takeover_reservations_pricing_config_id_pricing_config_versions_id_fk" FOREIGN KEY ("pricing_config_id") REFERENCES "public"."pricing_config_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "takeover_reservations_quote_uidx" ON "takeover_reservations" USING btree ("quote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "takeover_reservations_user_key_uidx" ON "takeover_reservations" USING btree ("user_id","idempotency_key_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "takeover_reservations_one_active_slot_uidx" ON "takeover_reservations" USING btree ("slot_id") WHERE "takeover_reservations"."status" = 'active';--> statement-breakpoint
CREATE INDEX "takeover_reservations_user_created_idx" ON "takeover_reservations" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE FUNCTION guard_takeover_reservation_mutation() RETURNS trigger AS $$
DECLARE quoted takeover_quotes%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'reservation history cannot be deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO quoted FROM takeover_quotes WHERE id = NEW.quote_id;
    IF NOT FOUND OR NEW.status <> 'active'
       OR (NEW.user_id, NEW.wall_id, NEW.slot_id, NEW.target_placement_id,
           NEW.pricing_config_id, NEW.currency, NEW.amount_minor)
          IS DISTINCT FROM
          (quoted.user_id, quoted.wall_id, quoted.slot_id,
           quoted.target_placement_id, quoted.pricing_config_id,
           quoted.currency, quoted.amount_minor) THEN
      RAISE EXCEPTION 'reservation snapshot must match quote' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.quote_id, NEW.user_id, NEW.wall_id, NEW.slot_id,
      NEW.target_placement_id, NEW.pricing_config_id, NEW.currency,
      NEW.amount_minor, NEW.idempotency_key_hash, NEW.created_at, NEW.expires_at)
     IS DISTINCT FROM
     (OLD.id, OLD.quote_id, OLD.user_id, OLD.wall_id, OLD.slot_id,
      OLD.target_placement_id, OLD.pricing_config_id, OLD.currency,
      OLD.amount_minor, OLD.idempotency_key_hash, OLD.created_at, OLD.expires_at)
     OR OLD.status <> 'active'
     OR NEW.status NOT IN ('expired', 'cancelled') THEN
    RAISE EXCEPTION 'reservation snapshot or lifecycle is immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER takeover_reservations_guard
BEFORE INSERT OR UPDATE OR DELETE ON takeover_reservations
FOR EACH ROW EXECUTE FUNCTION guard_takeover_reservation_mutation();
