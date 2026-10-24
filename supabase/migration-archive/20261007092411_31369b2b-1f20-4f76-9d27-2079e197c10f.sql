revoke execute on function public.record_expense(uuid,uuid,numeric,text,text,text,date) from public, anon;
revoke execute on function public.delete_expense(uuid,uuid) from public, anon;
grant execute on function public.record_expense(uuid,uuid,numeric,text,text,text,date) to authenticated;
grant execute on function public.delete_expense(uuid,uuid) to authenticated;