-- 205: the columns that identify a row, for every table, so selectAll can page in a stable order.
-- selectAll paged with LIMIT/OFFSET and no ORDER BY; Postgres gives no order without one, so on a table being written
-- the pages overlapped: 13,626 international finals came back as 11,786 distinct rows (2026-10-21). selectAll now
-- orders by these columns when a read is longer than one page. Per table: the primary key, else the narrowest unique
-- index without a predicate or expression. Views have none; their key lives in src/db/client.ts (VIEW_KEYS).
-- Rollback: DROP FUNCTION relation_order_keys(); selectAll then pages unordered again (and logs it once per table).

CREATE OR REPLACE FUNCTION public.relation_order_keys() RETURNS jsonb
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT coalesce(jsonb_object_agg(relname, cols), '{}'::jsonb) FROM (
    SELECT DISTINCT ON (c.oid) c.relname,
      (SELECT jsonb_agg(a.attname ORDER BY k.ord) FROM unnest(i.indkey) WITH ORDINALITY k(attnum, ord)
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum) AS cols
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_index i ON i.indrelid = c.oid
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'm', 'p')
      AND (i.indisprimary OR (i.indisunique AND i.indpred IS NULL AND i.indexprs IS NULL))
    ORDER BY c.oid, i.indisprimary DESC, i.indnatts, i.indexrelid
  ) x
$$;
REVOKE ALL ON FUNCTION public.relation_order_keys() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.relation_order_keys() TO service_role;
