ALTER TABLE "notification_deliveries" ADD COLUMN "attempt_at" timestamp with time zone;
--> statement-breakpoint
-- Facts are recorded inside the authoritative transaction; no network, preference
-- lookup or external work is performed by these triggers. No historical backfill.
CREATE FUNCTION notification_placement_fact() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE wall uuid;
BEGIN
  SELECT wall_id INTO wall FROM slots WHERE id=NEW.slot_id;
  IF TG_OP='INSERT' AND NEW.ended_at IS NULL THEN
    INSERT INTO notification_events (source_key,user_id,kind,wall_id,slot_id,created_at)
      VALUES ('claim:'||NEW.id,NEW.user_id,'slot_claimed',wall,NEW.slot_id,clock_timestamp()) ON CONFLICT DO NOTHING;
  ELSIF TG_OP='UPDATE' AND OLD.ended_at IS NULL AND NEW.ended_at IS NOT NULL AND NEW.end_reason='takeover' THEN
    INSERT INTO notification_events (source_key,user_id,kind,wall_id,slot_id,created_at)
      VALUES ('displaced:'||NEW.id,NEW.user_id,'user_displaced',wall,NEW.slot_id,clock_timestamp()) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER notification_placement_outbox AFTER INSERT OR UPDATE ON placements
  FOR EACH ROW EXECUTE FUNCTION notification_placement_fact();
--> statement-breakpoint
CREATE FUNCTION notification_payment_fact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status) AND NEW.status IN ('fulfilled','canceled','paid_but_not_fulfilled') THEN
    INSERT INTO notification_events (source_key,user_id,kind,wall_id,slot_id,detail,created_at)
      VALUES ('payment:'||NEW.id||':'||NEW.status,NEW.user_id,'payment_status',NEW.wall_id,NEW.slot_id,NEW.status::text,clock_timestamp())
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER notification_payment_outbox AFTER INSERT OR UPDATE ON payment_orders
  FOR EACH ROW EXECUTE FUNCTION notification_payment_fact();
