SET statement_timeout = '30s';
SET default_transaction_read_only = on;
SELECT json_build_object('migrations', (SELECT json_agg(json_build_object('hash',hash,'created_at',created_at) ORDER BY created_at) FROM drizzle.__drizzle_migrations),
 'tables', (SELECT json_object_agg(table_name,row_count ORDER BY table_name) FROM
  (SELECT c.relname AS table_name, (xpath('/row/n/text()',query_to_xml(format('SELECT count(*) AS n FROM public.%I',c.relname),false,true,'')))[1]::text::bigint AS row_count
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r') counts));
