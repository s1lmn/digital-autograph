-- Reset direct runtime ACLs too; PUBLIC-only revocation is insufficient.
DO $$
DECLARE item record; owner_name text; scope text; kind text;
BEGIN
 EXECUTE format('REVOKE ALL ON DATABASE %I FROM da_api, da_worker', current_database());
 EXECUTE format('REVOKE CREATE,TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
 FOR item IN SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_temp_%' AND nspname NOT LIKE 'pg_toast_temp_%' LOOP
  EXECUTE format('REVOKE ALL ON SCHEMA %I FROM da_api,da_worker',item.nspname);
 END LOOP;
 REVOKE CREATE ON SCHEMA public FROM PUBLIC;
 IF EXISTS (SELECT FROM pg_namespace WHERE nspname='drizzle') THEN REVOKE ALL ON SCHEMA drizzle FROM PUBLIC; END IF;
 FOR item IN SELECT p.oid::regprocedure AS name, p.prokind FROM pg_proc p WHERE p.proacl IS NOT NULL LOOP
  IF item.prokind IN ('f','p') THEN EXECUTE format('REVOKE ALL ON %s %s FROM da_api,da_worker',CASE WHEN item.prokind='p' THEN 'PROCEDURE' ELSE 'FUNCTION' END,item.name); END IF;
 END LOOP;
 REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM PUBLIC,da_api,da_worker;
 REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC,da_api,da_worker;
 REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC,da_api,da_worker;
 IF EXISTS (SELECT FROM pg_namespace WHERE nspname='drizzle') THEN
  REVOKE ALL ON ALL ROUTINES IN SCHEMA drizzle FROM PUBLIC,da_api,da_worker;
  REVOKE ALL ON ALL TABLES IN SCHEMA drizzle FROM PUBLIC,da_api,da_worker;
  REVOKE ALL ON ALL SEQUENCES IN SCHEMA drizzle FROM PUBLIC,da_api,da_worker;
 END IF;
 FOR item IN SELECT lanname FROM pg_language WHERE lanpltrusted LOOP
  EXECUTE format('REVOKE ALL ON LANGUAGE %I FROM da_api,da_worker',item.lanname);
 END LOOP;
 FOR item IN SELECT n.nspname,c.relname,a.attname FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','drizzle') AND a.attacl IS NOT NULL AND a.attnum>0 LOOP
  EXECUTE format('REVOKE ALL (%I) ON TABLE %I.%I FROM PUBLIC,da_api,da_worker', item.attname,item.nspname,item.relname);
 END LOOP;
 FOR owner_name IN SELECT rolname FROM pg_roles WHERE rolname IN (current_user,'da_migrator') LOOP
  FOREACH scope IN ARRAY ARRAY['',' IN SCHEMA public',' IN SCHEMA drizzle'] LOOP
   IF scope=' IN SCHEMA drizzle' AND NOT EXISTS (SELECT FROM pg_namespace WHERE nspname='drizzle') THEN CONTINUE; END IF;
   FOREACH kind IN ARRAY ARRAY['TABLES','SEQUENCES','FUNCTIONS','TYPES'] LOOP
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I%s REVOKE ALL ON %s FROM da_api,da_worker', owner_name,scope,kind);
   END LOOP;
   EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I%s REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',owner_name,scope);
  END LOOP;
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON SCHEMAS FROM da_api,da_worker',owner_name);
 END LOOP;
END $$;
