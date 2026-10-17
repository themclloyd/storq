-- The store_stock_bounds CHECK constraint (qty >= 0) was causing cryptic 400
-- errors on the POS because any race between the guard read and the write would
-- surface as "new row violates check constraint" which maskRpcError hides.
-- The guard is now enforced in SQL logic inside _move_stock (FOR UPDATE +
-- explicit RAISE EXCEPTION) and adjust_stock_reason (advisory lock + guard).
-- A SQL-level check on the final write is redundant and harmful; remove it.
ALTER TABLE public.store_stock DROP CONSTRAINT IF EXISTS store_stock_bounds;

-- Re-add only the upper bound (sanity cap); zero/negative is now caught
-- upstream with a user-readable message before the write ever happens.
ALTER TABLE public.store_stock ADD CONSTRAINT store_stock_upper_bound
  CHECK (qty <= 100000000);
