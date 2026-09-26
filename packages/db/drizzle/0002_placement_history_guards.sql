CREATE FUNCTION guard_placement_history() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'placements are retained as history' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'completed placements are immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.slot_id IS DISTINCT FROM OLD.slot_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.started_at IS DISTINCT FROM OLD.started_at
     OR NEW.ended_at IS NULL
     OR NEW.end_reason IS NULL THEN
    RAISE EXCEPTION 'active placement may only be completed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER placements_history_guard BEFORE UPDATE OR DELETE ON placements
FOR EACH ROW EXECUTE FUNCTION guard_placement_history();
