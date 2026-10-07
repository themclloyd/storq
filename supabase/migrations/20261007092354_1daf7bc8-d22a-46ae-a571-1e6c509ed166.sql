alter table public.sale_items add column if not exists cost numeric(12,2) not null default 0;
update public.sale_items i set cost = p.cost from public.products p where p.id = i.product_id and i.cost = 0;

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  amount numeric(12,2) not null,
  category text not null default 'Other',
  source text not null default 'till',
  note text,
  spent_on date not null default current_date,
  created_by uuid references public.staff(id) on delete set null,
  created_at timestamptz not null default now()
);
grant select on public.expenses to authenticated;
grant all on public.expenses to service_role;
alter table public.expenses enable row level security;
create policy "own expenses" on public.expenses for select to authenticated using (business_id = public.my_business_id());

create or replace function public.record_expense(p_token uuid, p_store uuid, p_amount numeric, p_category text, p_source text, p_note text, p_date date)
returns uuid language plpgsql security definer set search_path = public as $$
declare me public.staff; r uuid;
begin
  me := public.require_staff(p_token, array['admin','manager','cashier']);
  if not exists (select 1 from public.stores where id = p_store and business_id = me.business_id) then raise exception 'Unknown store'; end if;
  if me.role = 'cashier' and me.store_id is not null and me.store_id <> p_store then raise exception 'You are not assigned to this store'; end if;
  if coalesce(p_amount,0) <= 0 then raise exception 'Enter an amount'; end if;
  if p_source not in ('till','bank','mobile') then raise exception 'Invalid source'; end if;
  insert into public.expenses(business_id, store_id, amount, category, source, note, spent_on, created_by)
    values (me.business_id, p_store, p_amount, coalesce(nullif(trim(p_category),''),'Other'), p_source, p_note, coalesce(p_date, current_date), me.id)
    returning id into r;
  return r;
end $$;

create or replace function public.delete_expense(p_token uuid, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me public.staff;
begin
  me := public.require_staff(p_token, array['admin','manager']);
  delete from public.expenses where id = p_id and business_id = me.business_id;
end $$;

create or replace function public.checkout(p_token uuid, p_store uuid, p_kind text, p_items jsonb, p_payment numeric, p_method text, p_customer_name text, p_customer_phone text, p_note text)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare me public.staff; st public.stores; v_total numeric; v_sale uuid; v_status text; v_num int; v_pay numeric;
begin
  me := public.require_staff(p_token, array['admin','manager','cashier']);
  select * into st from public.stores where id = p_store and business_id = me.business_id;
  if st.id is null then raise exception 'Unknown store'; end if;
  if me.role = 'cashier' and me.store_id is not null and me.store_id <> p_store then raise exception 'You are not assigned to this store'; end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb)) = 0 then raise exception 'Cart is empty'; end if;
  if p_kind = 'layby' and coalesce(trim(p_customer_name),'') = '' then raise exception 'Layby needs a customer name'; end if;
  select sum(p.price * (x->>'qty')::numeric) into v_total
    from jsonb_array_elements(p_items) x join public.products p on p.id = (x->>'product_id')::uuid and p.business_id = me.business_id;
  if v_total is null then raise exception 'Invalid items'; end if;
  v_pay := least(greatest(coalesce(p_payment,0),0), v_total);
  if st.store_type = 'approval' then v_status := 'pending_approval';
  elsif p_kind = 'layby' then v_status := 'layby_open';
  else v_status := 'completed'; v_pay := v_total; end if;
  insert into public.sales(business_id, store_id, kind, status, total, paid, payment_method, customer_name, customer_phone, note, created_by)
    values (me.business_id, p_store, p_kind, v_status, v_total,
      case when v_status = 'pending_approval' then 0 else v_pay end, p_method, p_customer_name, p_customer_phone, p_note, me.id)
    returning id, number into v_sale, v_num;
  insert into public.sale_items(sale_id, product_id, name, qty, price, cost)
    select v_sale, p.id, p.name, (x->>'qty')::numeric, p.price, p.cost
      from jsonb_array_elements(p_items) x join public.products p on p.id = (x->>'product_id')::uuid and p.business_id = me.business_id;
  if v_status <> 'pending_approval' then
    perform public._move_stock(v_sale, -1);
    if v_pay > 0 then insert into public.payments(sale_id, amount, method, staff_id) values (v_sale, v_pay, coalesce(p_method,'cash'), me.id); end if;
    if p_kind = 'layby' and v_pay >= v_total then update public.sales set status = 'layby_completed' where id = v_sale; end if;
  else
    update public.sales set note = coalesce(p_note,'') where id = v_sale;
  end if;
  return json_build_object('id', v_sale, 'number', v_num, 'status', (select status from public.sales where id = v_sale), 'total', v_total);
end $function$;