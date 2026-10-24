do $$ declare f record; begin
for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('my_business_id','require_staff','pin_taken','setup_business','unlock_with_pin','lock_session','save_staff','save_store','save_product','adjust_stock','_move_stock','checkout','review_invoice','layby_pay','cancel_layby','start_stock_take','count_stock','close_stock_take')
loop execute format('revoke execute on function %s from public, anon', f.sig); end loop; end $$;
revoke execute on function public._move_stock(uuid,int) from authenticated;
revoke execute on function public.require_staff(uuid,text[]) from authenticated;
grant execute on function public.my_business_id() to authenticated;