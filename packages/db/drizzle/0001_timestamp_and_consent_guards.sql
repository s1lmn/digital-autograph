CREATE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER creators_updated_at BEFORE UPDATE ON creators
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER creator_profiles_updated_at BEFORE UPDATE ON creator_profiles
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER walls_updated_at BEFORE UPDATE ON walls
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
CREATE FUNCTION reject_consent_record_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'consent records are append-only' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER consent_records_append_only BEFORE UPDATE OR DELETE ON consent_records
FOR EACH ROW EXECUTE FUNCTION reject_consent_record_mutation();
