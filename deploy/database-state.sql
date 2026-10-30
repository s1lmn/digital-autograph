SET statement_timeout = '30s';
SET default_transaction_read_only = on;
SET TIME ZONE 'UTC';
SET extra_float_digits = 3;
SELECT json_build_object('migrations', (SELECT json_agg(json_build_object('hash',hash,'created_at',created_at) ORDER BY created_at) FROM drizzle.__drizzle_migrations),
 'tables', (SELECT json_object_agg(table_name,row_count ORDER BY table_name) FROM
  (SELECT c.relname AS table_name, (xpath('/row/n/text()',query_to_xml(format('SELECT count(*) AS n FROM public.%I',c.relname),false,true,'')))[1]::text::bigint AS row_count
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r') counts),
 'sequences', (SELECT json_object_agg(sequence_name,sequence_hash ORDER BY sequence_name) FROM
  (SELECT c.relname AS sequence_name, (xpath('/row/h/text()',query_to_xml(format($sequence$SELECT encode(sha256(convert_to(last_value::text || ':' || is_called::text,'UTF8')),'hex') AS h FROM public.%I$sequence$,c.relname),false,true,'')))[1]::text AS sequence_hash
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='S') sequences),
 'contents', (SELECT json_object_agg(table_name,content_hash ORDER BY table_name) FROM
  (SELECT c.relname AS table_name, (xpath('/row/h/text()',query_to_xml(format($rows$SELECT encode(sha256(convert_to(coalesce(string_agg(h,'' ORDER BY h),''),'UTF8')),'hex') AS h FROM (SELECT encode(sha256(convert_to(row_to_json(t)::text,'UTF8')),'hex') AS h FROM public.%I t) hashed_rows$rows$,c.relname),false,true,'')))[1]::text AS content_hash
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r') hashes));
