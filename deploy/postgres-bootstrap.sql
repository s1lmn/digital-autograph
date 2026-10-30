-- Only a reviewed operator/bootstrap connection runs this, with all writers stopped.
-- destka.*_scram settings contain SCRAM verifiers, never plaintext passwords.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $$
DECLARE item record; role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['da_api','da_worker','da_migrator'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name AND
        (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls))
       OR EXISTS (SELECT 1 FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba WHERE r.rolname=role_name)
       OR EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member OR r.oid=m.roleid WHERE r.rolname=role_name)
    THEN RAISE EXCEPTION 'Unsafe pre-existing deployment role'; END IF;
    IF role_name IN ('da_api','da_worker') AND (EXISTS (SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE r.rolname=role_name) OR EXISTS (SELECT 1 FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner WHERE r.rolname=role_name)) THEN RAISE EXCEPTION 'Runtime role must not own objects'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT',role_name);
    END IF;
  END LOOP;
  FOREACH role_name IN ARRAY ARRAY['api','worker','migrator'] LOOP
    IF current_setting('destka.'||role_name||'_scram') NOT LIKE 'SCRAM-SHA-256$%' THEN
      RAISE EXCEPTION 'SCRAM verifier required';
    END IF;
    EXECUTE format('ALTER ROLE %I NOINHERIT LOGIN PASSWORD %L','da_'||role_name,current_setting('destka.'||role_name||'_scram'));
  END LOOP;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO da_api, da_worker, da_migrator',current_database());
  EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC',current_database());
  EXECUTE format('GRANT CREATE ON DATABASE %I TO da_migrator',current_database());
  -- This is a dedicated application DB. Never run against a shared DB.
  FOR item IN SELECT n.nspname,c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','drizzle') AND c.relkind IN ('r','S') ORDER BY (c.relkind='S') LOOP
    EXECUTE format('ALTER %s %I.%I OWNER TO da_migrator',CASE WHEN item.relkind='S' THEN 'SEQUENCE' ELSE 'TABLE' END,item.nspname,item.relname);
  END LOOP;
  FOR item IN SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype='e' LOOP
    EXECUTE format('ALTER TYPE public.%I OWNER TO da_migrator',item.typname);
  END LOOP;
  FOR item IN SELECT p.oid::regprocedure AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.prorettype='trigger'::regtype LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO da_migrator',item.name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='drizzle') THEN ALTER SCHEMA drizzle OWNER TO da_migrator; END IF;
END $$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO da_migrator;
ALTER DEFAULT PRIVILEGES FOR ROLE da_migrator REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
COMMIT;
