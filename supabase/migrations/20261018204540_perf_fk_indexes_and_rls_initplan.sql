-- Covering indexes on unindexed foreign keys (Supabase perf advisor: 25 findings).
-- FK columns on the child side are JOINed/CASCADEd constantly (sales, payments,
-- refunds, stock ledger, approval queues) yet had no leading index, forcing seq
-- scans as tenants grow. Plain btree per column; IF NOT EXISTS keeps it idempotent.
CREATE INDEX IF NOT EXISTS cash_movements_staff_id_idx ON public.cash_movements (staff_id);
CREATE INDEX IF NOT EXISTS cash_shifts_business_id_idx ON public.cash_shifts (business_id);
CREATE INDEX IF NOT EXISTS cash_shifts_closed_by_idx ON public.cash_shifts (closed_by);
CREATE INDEX IF NOT EXISTS cash_shifts_opened_by_idx ON public.cash_shifts (opened_by);
CREATE INDEX IF NOT EXISTS expenses_created_by_idx ON public.expenses (created_by);
CREATE INDEX IF NOT EXISTS payments_staff_id_idx ON public.payments (staff_id);
CREATE INDEX IF NOT EXISTS refund_items_product_id_idx ON public.refund_items (product_id);
CREATE INDEX IF NOT EXISTS refund_items_sale_item_id_idx ON public.refund_items (sale_item_id);
CREATE INDEX IF NOT EXISTS refunds_shift_id_idx ON public.refunds (shift_id);
CREATE INDEX IF NOT EXISTS refunds_staff_id_idx ON public.refunds (staff_id);
CREATE INDEX IF NOT EXISTS sales_approved_by_idx ON public.sales (approved_by);
CREATE INDEX IF NOT EXISTS sales_created_by_idx ON public.sales (created_by);
CREATE INDEX IF NOT EXISTS staff_store_id_idx ON public.staff (store_id);
CREATE INDEX IF NOT EXISTS staff_sessions_staff_id_idx ON public.staff_sessions (staff_id);
CREATE INDEX IF NOT EXISTS stock_movements_product_id_idx ON public.stock_movements (product_id);
CREATE INDEX IF NOT EXISTS stock_movements_staff_id_idx ON public.stock_movements (staff_id);
CREATE INDEX IF NOT EXISTS stock_take_lines_counted_by_idx ON public.stock_take_lines (counted_by);
CREATE INDEX IF NOT EXISTS stock_take_lines_product_id_idx ON public.stock_take_lines (product_id);
CREATE INDEX IF NOT EXISTS stock_takes_business_id_idx ON public.stock_takes (business_id);
CREATE INDEX IF NOT EXISTS stock_takes_closed_by_idx ON public.stock_takes (closed_by);
CREATE INDEX IF NOT EXISTS stock_takes_started_by_idx ON public.stock_takes (started_by);
CREATE INDEX IF NOT EXISTS stock_transfer_lines_product_id_idx ON public.stock_transfer_lines (product_id);
CREATE INDEX IF NOT EXISTS stock_transfers_created_by_idx ON public.stock_transfers (created_by);
CREATE INDEX IF NOT EXISTS stock_transfers_received_by_idx ON public.stock_transfers (received_by);
CREATE INDEX IF NOT EXISTS subscription_payments_created_by_idx ON public.subscription_payments (created_by);

-- RLS initplan (perf advisor WARN): auth.uid() was re-evaluated per row on the
-- hottest read policy. Wrapping it in a scalar subquery makes Postgres evaluate
-- it once per statement. Same predicate, same security, just an initplan.
DROP POLICY IF EXISTS "own business" ON public.businesses;
CREATE POLICY "own business" ON public.businesses FOR SELECT TO authenticated USING (owner_id = (select auth.uid()));
