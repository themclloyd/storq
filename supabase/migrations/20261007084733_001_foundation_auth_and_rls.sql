-- ============================================================================
-- 001 - Foundation: tenants, auth, RLS and the security hardening pass
--
-- Squashed baseline. This file is the ordered, verbatim concatenation of the
-- migrations listed below. Replaying it on an empty database produces the same
-- schema those files produced one at a time, in this exact order. Every
-- original is kept unedited in supabase/migration-archive/ for provenance.
--
--   20261007084733  2ed95314-f75e-4843-977b-23f9e6359a48
--   20261007084754  5d0a930d-b659-4a08-882c-317f7898dbc7
--   20261007092354  1daf7bc8-d22a-46ae-a571-1e6c509ed166
--   20261007092411  31369b2b-1f20-4f76-9d27-2079e197c10f
--   20261007094440  7f9e1944-d2b6-4ff8-922f-9a15d298e414
--   20261007100137  bfc24679-0e49-446b-b715-df35c6e8c994
--   20261007100154  8732619d-7649-41d2-8a27-f70876506db1
--   20261007101232  afb8cd47-dc5e-4816-83f7-1b530d9194b9
--   20261007101247  9e99c53e-cc56-4e02-b439-ace84c09bacf
--   20261007101503  838baf20-162a-45c9-97a2-a1928381f341
--   20261007102244  c10153f5-18b7-409c-8196-3337d3f296c4
--   20261007102303  4260d56f-8e50-4ca0-add6-16990ca353ab
--   20261007115041  3e857134-c53a-47c9-a33f-3db16cc13962
--   20261007115238  6662954d-34a5-4c8e-b71e-7f98b51895af
--   20261007182146  48413f83-16ba-421f-b269-777201b5e8b1
--   20261007183338  b2173994-433e-4727-8c60-bf0d6a8a7aca
--   20261008204357  security_hardening
--   20261009192705  c04f3a80-e05e-498f-ab87-694d79f3fe3f
--   20261009193153  97dc4c9b-c64d-4f55-9cfe-e17b97fb71ec
-- ============================================================================

-- --- from 20261007084733_2ed95314-f75e-4843-977b-23f9e6359a48.sql ---------------
create extension if not exists pgcrypto with schema extensions;

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null,
  currency text not null default 'R',
  created_at timestamptz not null default now()
);
create table public.stores (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  store_type text not null default 'direct' check (store_type in ('direct','approval')),
  created_at timestamptz not null default now()
);
create table public.staff (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  store_id uuid references public.stores(id) on delete set null,
  name text not null,
  role text not null check (role in ('admin','manager','cashier')),
  pin_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.staff_sessions (
  token uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '14 days'
);
create table public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  sku text,
  category text,
  price numeric(12,2) not null default 0,
  cost numeric(12,2) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.store_stock (
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  qty numeric(12,2) not null default 0,
  primary key (store_id, product_id)
);
create table public.sales (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  number serial,
  kind text not null check (kind in ('sale','layby')),
  status text not null check (status in ('completed','pending_approval','rejected','layby_open','layby_completed','layby_cancelled')),
  total numeric(12,2) not null default 0,
  paid numeric(12,2) not null default 0,
  payment_method text,
  customer_name text,
  customer_phone text,
  note text,
  created_by uuid references public.staff(id) on delete set null,
  approved_by uuid references public.staff(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  name text not null,
  qty numeric(12,2) not null,
  price numeric(12,2) not null
);
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  amount numeric(12,2) not null,
  method text not null default 'cash',
  staff_id uuid references public.staff(id) on delete set null,
  created_at timestamptz not null default now()
);
create table public.stock_takes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  status text not null default 'open' check (status in ('open','closed')),
  started_by uuid references public.staff(id) on delete set null,
  closed_by uuid references public.staff(id) on delete set null,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create table public.stock_take_lines (
  stock_take_id uuid not null references public.stock_takes(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  expected numeric(12,2) not null default 0,
  counted numeric(12,2),
  counted_by uuid references public.staff(id) on delete set null,
  primary key (stock_take_id, product_id)
);

grant select on public.businesses, public.stores, public.products, public.store_stock, public.sales, public.sale_items, public.payments, public.stock_takes, public.stock_take_lines to authenticated;
grant select (id, business_id, store_id, name, role, active, created_at) on public.staff to authenticated;
grant all on public.businesses, public.stores, public.staff, public.staff_sessions, public.products, public.store_stock, public.sales, public.sale_items, public.payments, public.stock_takes, public.stock_take_lines to service_role;

alter table public.businesses enable row level security;
alter table public.stores enable row level security;
alter table public.staff enable row level security;
alter table public.staff_sessions enable row level security;
alter table public.products enable row level security;
alter table public.store_stock enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.payments enable row level security;
alter table public.stock_takes enable row level security;
alter table public.stock_take_lines enable row level security;

create or replace function public.my_business_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.businesses where owner_id = auth.uid()
$$;

create policy "own business" on public.businesses for select to authenticated using (owner_id = auth.uid());
create policy "own stores" on public.stores for select to authenticated using (business_id = public.my_business_id());
create policy "own staff" on public.staff for select to authenticated using (business_id = public.my_business_id());
create policy "own products" on public.products for select to authenticated using (business_id = public.my_business_id());
create policy "own stock" on public.store_stock for select to authenticated using (exists (select 1 from public.stores s where s.id = store_id and s.business_id = public.my_business_id()));
create policy "own sales" on public.sales for select to authenticated using (business_id = public.my_business_id());
create policy "own sale items" on public.sale_items for select to authenticated using (exists (select 1 from public.sales s where s.id = sale_id and s.business_id = public.my_business_id()));
create policy "own payments" on public.payments for select to authenticated using (exists (select 1 from public.sales s where s.id = sale_id and s.business_id = public.my_business_id()));
create policy "own stock takes" on public.stock_takes for select to authenticated using (business_id = public.my_business_id());
create policy "own stock take lines" on public.stock_take_lines for select to authenticated using (exists (select 1 from public.stock_takes t where t.id = stock_take_id and t.business_id = public.my_business_id()));

-- Resolve a staff session token into a staff row, enforcing allowed roles
create or replace function public.require_staff(p_token uuid, p_roles text[]) returns public.staff
language plpgsql stable security definer set search_path = public as $$
declare st public.staff;
begin
  select s.* into st from public.staff_sessions ss join public.staff s on s.id = ss.staff_id
   where ss.token = p_token and ss.expires_at > now() and s.active and s.business_id = public.my_business_id();
  if st.id is null then raise exception 'Locked: enter your PIN again'; end if;
  if not (st.role = any(p_roles)) then raise exception 'Your role (%) is not allowed to do this', st.role; end if;
  return st;
end $$;

create or replace function public.pin_taken(p_business uuid, p_pin text, p_except uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.staff where business_id = p_business and active
     and (p_except is null or id <> p_except) and pin_hash = extensions.crypt(p_pin, pin_hash))
$$;

create or replace function public.setup_business(p_name text, p_currency text, p_store_name text, p_store_type text, p_owner_name text, p_pin text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare b uuid; s uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if exists (select 1 from public.businesses where owner_id = auth.uid()) then raise exception 'Business already set up'; end if;
  if p_pin !~ '^[0-9]{4}$' then raise exception 'PIN must be 4 digits'; end if;
  insert into public.businesses(owner_id, name, currency) values (auth.uid(), p_name, coalesce(nullif(p_currency,''),'R')) returning id into b;
  insert into public.stores(business_id, name, store_type) values (b, p_store_name, p_store_type) returning id into s;
  insert into public.staff(business_id, name, role, pin_hash) values (b, p_owner_name, 'admin', extensions.crypt(p_pin, extensions.gen_salt('bf')));
  return b;
end $$;

create or replace function public.unlock_with_pin(p_pin text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare st public.staff; t uuid;
begin
  select * into st from public.staff where business_id = public.my_business_id() and active
    and pin_hash = extensions.crypt(p_pin, pin_hash) limit 1;
  if st.id is null then raise exception 'Wrong PIN'; end if;
  delete from public.staff_sessions where expires_at < now();
  insert into public.staff_sessions(staff_id) values (st.id) returning token into t;
  return json_build_object('token', t, 'id', st.id, 'name', st.name, 'role', st.role, 'store_id', st.store_id);
end $$;

create or replace function public.lock_session(p_token uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.staff_sessions where token = p_token
$$;

create or replace function public.save_staff(p_token uuid, p_id uuid, p_name text, p_role text, p_pin text, p_store uuid, p_active boolean)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare me public.staff; r uuid;
begin
  me := public.require_staff(p_token, array['admin']);
  if p_pin is not null and p_pin <> '' then
    if p_pin !~ '^[0-9]{4}$' then raise exception 'PIN must be 4 digits'; end if;
    if public.pin_taken(me.business_id, p_pin, p_id) then raise exception 'That PIN is already used by someone else'; end if;
  end if;
  if p_id is null then
    if p_pin is null or p_pin = '' then raise exception 'PIN required'; end if;
    insert into public.staff(business_id, name, role, pin_hash, store_id, active)
      values (me.business_id, p_name, p_role, extensions.crypt(p_pin, extensions.gen_salt('bf')), p_store, coalesce(p_active,true)) returning id into r;
  else
    if p_id = me.id and (p_role <> 'admin' or not p_active) then raise exception 'You cannot demote or deactivate yourself'; end if;
    update public.staff set name = p_name, role = p_role, store_id = p_store, active = coalesce(p_active,true),
      pin_hash = case when p_pin is not null and p_pin <> '' then extensions.crypt(p_pin, extensions.gen_salt('bf')) else pin_hash end
      where id = p_id and business_id = me.business_id returning id into r;
    if not coalesce(p_active,true) then delete from public.staff_sessions where staff_id = p_id; end if;
  end if;
  return r;
end $$;

create or replace function public.save_store(p_token uuid, p_id uuid, p_name text, p_type text)
returns uuid language plpgsql security definer set search_path = public as $$
declare me public.staff; r uuid;
begin
  me := public.require_staff(p_token, array['admin']);
  if p_id is null then
    insert into public.stores(business_id, name, store_type) values (me.business_id, p_name, p_type) returning id into r;
  else
    update public.stores set name = p_name, store_type = p_type where id = p_id and business_id = me.business_id returning id into r;
  end if;
  return r;
end $$;

create or replace function public.save_product(p_token uuid, p_id uuid, p_name text, p_sku text, p_category text, p_price numeric, p_cost numeric, p_active boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare me public.staff; r uuid;
begin
  me := public.require_staff(p_token, array['admin','manager']);
  if p_id is null then
    insert into public.products(business_id, name, sku, category, price, cost, active)
      values (me.business_id, p_name, p_sku, p_category, p_price, p_cost, coalesce(p_active,true)) returning id into r;
  else
    update public.products set name=p_name, sku=p_sku, category=p_category, price=p_price, cost=p_cost, active=coalesce(p_active,true)
      where id = p_id and business_id = me.business_id returning id into r;
  end if;
  return r;
end $$;

create or replace function public.adjust_stock(p_token uuid, p_store uuid, p_product uuid, p_delta numeric)
returns void language plpgsql security definer set search_path = public as $$
declare me public.staff;
begin
  me := public.require_staff(p_token, array['admin','manager']);
  if not exists (select 1 from public.stores where id = p_store and business_id = me.business_id) then raise exception 'Unknown store'; end if;
  insert into public.store_stock(store_id, product_id, qty) values (p_store, p_product, p_delta)
    on conflict (store_id, product_id) do update set qty = public.store_stock.qty + excluded.qty;
end $$;

create or replace function public._move_stock(p_sale uuid, p_sign int) returns void
language sql security definer set search_path = public as $$
  insert into public.store_stock(store_id, product_id, qty)
  select s.store_id, i.product_id, p_sign * i.qty from public.sale_items i join public.sales s on s.id = i.sale_id
   where i.sale_id = p_sale and i.product_id is not null
  on conflict (store_id, product_id) do update set qty = public.store_stock.qty + excluded.qty
$$;
revoke execute on function public._move_stock(uuid, int) from public, anon, authenticated;

-- p_items: [{product_id, qty}] ; p_kind: sale | layby ; p_payment: amount paid now
create or replace function public.checkout(p_token uuid, p_store uuid, p_kind text, p_items jsonb, p_payment numeric, p_method text, p_customer_name text, p_customer_phone text, p_note text)
returns json language plpgsql security definer set search_path = public as $$
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
  insert into public.sale_items(sale_id, product_id, name, qty, price)
    select v_sale, p.id, p.name, (x->>'qty')::numeric, p.price
      from jsonb_array_elements(p_items) x join public.products p on p.id = (x->>'product_id')::uuid and p.business_id = me.business_id;

  if v_status <> 'pending_approval' then
    perform public._move_stock(v_sale, -1);
    if v_pay > 0 then insert into public.payments(sale_id, amount, method, staff_id) values (v_sale, v_pay, coalesce(p_method,'cash'), me.id); end if;
    if p_kind = 'layby' and v_pay >= v_total then update public.sales set status = 'layby_completed' where id = v_sale; end if;
  else
    -- remember intended payment on the invoice note for approver
    update public.sales set note = coalesce(p_note,'') where id = v_sale;
  end if;
  return json_build_object('id', v_sale, 'number', v_num, 'status', (select status from public.sales where id = v_sale), 'total', v_total);
end $$;

create or replace function public.review_invoice(p_token uuid, p_sale uuid, p_approve boolean, p_payment numeric, p_method text)
returns text language plpgsql security definer set search_path = public as $$
declare me public.staff; s public.sales; v_pay numeric; v_status text;
begin
  me := public.require_staff(p_token, array['admin','manager']);
  select * into s from public.sales where id = p_sale and business_id = me.business_id for update;
  if s.id is null or s.status <> 'pending_approval' then raise exception 'Invoice is not awaiting approval'; end if;
  if s.created_by = me.id and me.role <> 'admin' then raise exception 'Another person must approve your invoice'; end if;
  if not p_approve then
    update public.sales set status = 'rejected', approved_by = me.id, approved_at = now() where id = p_sale;
    return 'rejected';
  end if;
  if s.kind = 'layby' then
    v_pay := least(greatest(coalesce(p_payment,0),0), s.total);
    v_status := case when v_pay >= s.total then 'layby_completed' else 'layby_open' end;
  else v_pay := s.total; v_status := 'completed'; end if;
  update public.sales set status = v_status, paid = v_pay, payment_method = coalesce(p_method,'cash'), approved_by = me.id, approved_at = now() where id = p_sale;
  perform public._move_stock(p_sale, -1);
  if v_pay > 0 then insert into public.payments(sale_id, amount, method, staff_id) values (p_sale, v_pay, coalesce(p_method,'cash'), me.id); end if;
  return v_status;
end $$;

create or replace function public.layby_pay(p_token uuid, p_sale uuid, p_amount numeric, p_method text)
returns text language plpgsql security definer set search_path = public as $$
declare me public.staff; s public.sales; v_pay numeric;
begin
  me := public.require_staff(p_token, array['admin','manager','cashier']);
  select * into s from public.sales where id = p_sale and business_id = me.business_id for update;
  if s.id is null or s.status <> 'layby_open' then raise exception 'Layby is not open'; end if;
  v_pay := least(greatest(coalesce(p_amount,0),0), s.total - s.paid);
  if v_pay <= 0 then raise exception 'Enter an amount'; end if;
  insert into public.payments(sale_id, amount, method, staff_id) values (p_sale, v_pay, coalesce(p_method,'cash'), me.id);
  update public.sales set paid = paid + v_pay, status = case when paid + v_pay >= total then 'layby_completed' else status end where id = p_sale;
  return (select status from public.sales where id = p_sale);
end $$;

create or replace function public.cancel_layby(p_token uuid, p_sale uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me public.staff; s public.sales;
begin
  me := public.require_staff(p_token, array['admin','manager']);
  select * into s from public.sales where id = p_sale and business_id = me.business_id for update;
  if s.id is null or s.status <> 'layby_open' then raise exception 'Layby is not open'; end if;
  update public.sales set status = 'layby_cancelled' where id = p_sale;
  perform public._move_stock(p_sale, 1);
end $$;

create or replace function public.start_stock_take(p_token uuid, p_store uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare me public.staff; t uuid;
begin
  me := public.require_staff(p_token, array['admin','manager']);
  if not exists (select 1 from public.stores where id = p_store and business_id = me.business_id) then raise exception 'Unknown store'; end if;
  if exists (select 1 from public.stock_takes where store_id = p_store and status = 'open') then raise exception 'A stock take is already open for this store'; end if;
  insert into public.stock_takes(business_id, store_id, started_by) values (me.business_id, p_store, me.id) returning id into t;
  insert into public.stock_take_lines(stock_take_id, product_id, expected)
    select t, p.id, coalesce(ss.qty,0) from public.products p
      left join public.store_stock ss on ss.product_id = p.id and ss.store_id = p_store
     where p.business_id = me.business_id and p.active;
  return t;
end $$;

create or replace function public.count_stock(p_token uuid, p_take uuid, p_product uuid, p_counted numeric)
returns void language plpgsql security definer set search_path = public as $$
declare me public.staff;
begin
  me := public.require_staff(p_token, array['admin','manager','cashier']);
  update public.stock_take_lines l set counted = p_counted, counted_by = me.id
   from public.stock_takes t where t.id = l.stock_take_id and t.id = p_take and t.status = 'open'
     and t.business_id = me.business_id and l.product_id = p_product;
end $$;

create or replace function public.close_stock_take(p_token uuid, p_take uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me public.staff; t public.stock_takes;
begin
  me := public.require_staff(p_token, array['admin','manager']);
  select * into t from public.stock_takes where id = p_take and business_id = me.business_id and status = 'open';
  if t.id is null then raise exception 'Stock take is not open'; end if;
  insert into public.store_stock(store_id, product_id, qty)
    select t.store_id, product_id, counted from public.stock_take_lines where stock_take_id = p_take and counted is not null
  on conflict (store_id, product_id) do update set qty = excluded.qty;
  update public.stock_takes set status = 'closed', closed_by = me.id, closed_at = now() where id = p_take;
end $$;

revoke execute on function public.require_staff(uuid, text[]) from public, anon;
revoke execute on function public.pin_taken(uuid, text, uuid) from public, anon, authenticated;

-- --- from 20261007084754_5d0a930d-b659-4a08-882c-317f7898dbc7.sql ---------------
do $$ declare f record; begin
for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('my_business_id','require_staff','pin_taken','setup_business','unlock_with_pin','lock_session','save_staff','save_store','save_product','adjust_stock','_move_stock','checkout','review_invoice','layby_pay','cancel_layby','start_stock_take','count_stock','close_stock_take')
loop execute format('revoke execute on function %s from public, anon', f.sig); end loop; end $$;
revoke execute on function public._move_stock(uuid,int) from authenticated;
revoke execute on function public.require_staff(uuid,text[]) from authenticated;
grant execute on function public.my_business_id() to authenticated;

-- --- from 20261007092354_1daf7bc8-d22a-46ae-a571-1e6c509ed166.sql ---------------
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

-- --- from 20261007092411_31369b2b-1f20-4f76-9d27-2079e197c10f.sql ---------------
revoke execute on function public.record_expense(uuid,uuid,numeric,text,text,text,date) from public, anon;
revoke execute on function public.delete_expense(uuid,uuid) from public, anon;
grant execute on function public.record_expense(uuid,uuid,numeric,text,text,text,date) to authenticated;
grant execute on function public.delete_expense(uuid,uuid) to authenticated;

-- --- from 20261007094440_7f9e1944-d2b6-4ff8-922f-9a15d298e414.sql ---------------
create table public.collections (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  discount_pct numeric not null default 0,
  is_shared boolean not null default true,
  share_slug text not null unique default substr(replace(gen_random_uuid()::text,'-',''),1,10),
  created_at timestamptz not null default now()
);
grant select on public.collections to authenticated;
grant all on public.collections to service_role;
alter table public.collections enable row level security;
create policy "own collections" on public.collections for select to authenticated using (business_id = public.my_business_id());

create table public.product_collections (
  collection_id uuid not null references public.collections(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  primary key (collection_id, product_id)
);
grant select on public.product_collections to authenticated;
grant all on public.product_collections to service_role;
alter table public.product_collections enable row level security;
create policy "own product collections" on public.product_collections for select to authenticated
  using (exists (select 1 from public.collections c where c.id = collection_id and c.business_id = public.my_business_id()));

-- migrate categories
insert into public.collections(business_id, name)
  select distinct business_id, trim(category) from public.products where coalesce(trim(category),'') <> '';
insert into public.product_collections(collection_id, product_id)
  select c.id, p.id from public.products p join public.collections c on c.business_id = p.business_id and c.name = trim(p.category);

create or replace function public.effective_price(p_product uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select round(p.price * (1 - least(100, greatest(0, coalesce((
    select max(c.discount_pct) from public.product_collections pc join public.collections c on c.id = pc.collection_id
    where pc.product_id = p.id), 0))) / 100), 2)
  from public.products p where p.id = p_product
$$;

create or replace function public.save_collection(p_token uuid, p_id uuid, p_name text, p_discount numeric, p_shared boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare me public.staff; r uuid;
begin
  me := public.require_staff(p_token, array['admin','manager']);
  if coalesce(trim(p_name),'') = '' then raise exception 'Name is required'; end if;
  if coalesce(p_discount,0) < 0 or coalesce(p_discount,0) > 100 then raise exception 'Discount must be 0–100%%'; end if;
  if p_id is null then
    insert into public.collections(business_id, name, discount_pct, is_shared) values (me.business_id, trim(p_name), coalesce(p_discount,0), coalesce(p_shared,true)) returning id into r;
  else
    update public.collections set name = trim(p_name), discount_pct = coalesce(p_discount,0), is_shared = coalesce(p_shared,true)
      where id = p_id and business_id = me.business_id returning id into r;
    if r is null then raise exception 'Unknown collection'; end if;
  end if;
  return r;
end $$;

create or replace function public.delete_collection(p_token uuid, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me public.staff;
begin
  me := public.require_staff(p_token, array['admin','manager']);
  delete from public.collections where id = p_id and business_id = me.business_id;
end $$;

create or replace function public.set_collection_products(p_token uuid, p_collection uuid, p_products uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare me public.staff;
begin
  me := public.require_staff(p_token, array['admin','manager']);
  if not exists (select 1 from public.collections where id = p_collection and business_id = me.business_id) then raise exception 'Unknown collection'; end if;
  delete from public.product_collections where collection_id = p_collection;
  insert into public.product_collections(collection_id, product_id)
    select p_collection, p.id from public.products p where p.id = any(coalesce(p_products,'{}')) and p.business_id = me.business_id;
end $$;

create or replace function public.set_product_collections(p_token uuid, p_product uuid, p_collections uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare me public.staff;
begin
  me := public.require_staff(p_token, array['admin','manager']);
  if not exists (select 1 from public.products where id = p_product and business_id = me.business_id) then raise exception 'Unknown item'; end if;
  delete from public.product_collections where product_id = p_product;
  insert into public.product_collections(collection_id, product_id)
    select c.id, p_product from public.collections c where c.id = any(coalesce(p_collections,'{}')) and c.business_id = me.business_id;
end $$;

create or replace function public.get_shared_collection(p_slug text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'name', c.name, 'discount_pct', c.discount_pct, 'business', b.name, 'currency', b.currency,
    'items', coalesce((select json_agg(json_build_object('name', p.name, 'price', p.price, 'sale_price', public.effective_price(p.id)) order by p.name)
       from public.product_collections pc join public.products p on p.id = pc.product_id and p.active
       where pc.collection_id = c.id), '[]'::json))
  from public.collections c join public.businesses b on b.id = c.business_id
  where c.share_slug = p_slug and c.is_shared
$$;

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
  select sum(public.effective_price(p.id) * (x->>'qty')::numeric) into v_total
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
    select v_sale, p.id, p.name, (x->>'qty')::numeric, public.effective_price(p.id), p.cost
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

revoke execute on function public.save_collection(uuid,uuid,text,numeric,boolean) from public, anon;
revoke execute on function public.delete_collection(uuid,uuid) from public, anon;
revoke execute on function public.set_collection_products(uuid,uuid,uuid[]) from public, anon;
revoke execute on function public.set_product_collections(uuid,uuid,uuid[]) from public, anon;
revoke execute on function public.effective_price(uuid) from public, anon, authenticated;
grant execute on function public.get_shared_collection(text) to anon, authenticated;

-- --- from 20261007100137_bfc24679-0e49-446b-b715-df35c6e8c994.sql ---------------
CREATE TABLE public.subscriptions (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  trial_ends_at timestamptz NOT NULL DEFAULT (now() + interval '1 day'),
  paid_until timestamptz,
  plan text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own subscription" ON public.subscriptions FOR SELECT TO authenticated USING (business_id = public.my_business_id());

CREATE TABLE public.subscription_payments (
  tx_ref text PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  period text NOT NULL,
  currency text NOT NULL,
  amount numeric NOT NULL,
  stores int NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_by uuid REFERENCES public.staff(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);
GRANT SELECT ON public.subscription_payments TO authenticated;
GRANT ALL ON public.subscription_payments TO service_role;
ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own sub payments" ON public.subscription_payments FOR SELECT TO authenticated USING (business_id = public.my_business_id());

INSERT INTO public.subscriptions (business_id) SELECT id FROM public.businesses ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.on_business_created() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN INSERT INTO subscriptions (business_id) VALUES (NEW.id) ON CONFLICT DO NOTHING; RETURN NEW; END $$;
CREATE TRIGGER business_subscription AFTER INSERT ON public.businesses FOR EACH ROW EXECUTE FUNCTION public.on_business_created();

CREATE OR REPLACE FUNCTION public.start_subscription_payment(p_token uuid, p_period text, p_currency text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s staff; n int; amt numeric; ref text;
BEGIN
  s := require_staff(p_token, ARRAY['admin','manager']);
  IF p_period NOT IN ('monthly','yearly') OR p_currency NOT IN ('MWK','USD') THEN RAISE EXCEPTION 'Invalid plan'; END IF;
  SELECT greatest(count(*),1) INTO n FROM stores WHERE business_id = s.business_id;
  amt := CASE WHEN p_currency = 'MWK' THEN 60000 ELSE 35 END * n;
  IF p_period = 'yearly' THEN amt := round(amt * 12 * 0.85, 2); END IF;
  ref := 'storq-' || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO subscription_payments (tx_ref, business_id, period, currency, amount, stores, created_by)
  VALUES (ref, s.business_id, p_period, p_currency, amt, n, s.id);
  RETURN json_build_object('tx_ref', ref, 'amount', amt, 'currency', p_currency, 'stores', n);
END $$;

CREATE OR REPLACE FUNCTION public.complete_subscription_payment(p_tx_ref text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p subscription_payments; base timestamptz;
BEGIN
  SELECT * INTO p FROM subscription_payments WHERE tx_ref = p_tx_ref FOR UPDATE;
  IF p IS NULL OR p.status = 'paid' THEN RETURN; END IF;
  UPDATE subscription_payments SET status = 'paid', paid_at = now() WHERE tx_ref = p_tx_ref;
  SELECT greatest(now(), coalesce(paid_until, now())) INTO base FROM subscriptions WHERE business_id = p.business_id;
  UPDATE subscriptions SET paid_until = base + CASE WHEN p.period = 'yearly' THEN interval '1 year' ELSE interval '1 month' END,
    plan = p.period WHERE business_id = p.business_id;
END $$;
REVOKE ALL ON FUNCTION public.complete_subscription_payment(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_subscription_payment(text) TO service_role;

-- --- from 20261007100154_8732619d-7649-41d2-8a27-f70876506db1.sql ---------------
REVOKE ALL ON FUNCTION public.on_business_created() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.start_subscription_payment(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_subscription_payment(uuid, text, text) TO authenticated;

-- --- from 20261007101232_afb8cd47-dc5e-4816-83f7-1b530d9194b9.sql ---------------
CREATE OR REPLACE FUNCTION public.require_staff_nosub(p_token uuid, p_roles text[]) RETURNS public.staff
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE st public.staff;
BEGIN
  SELECT s.* INTO st FROM public.staff_sessions ss JOIN public.staff s ON s.id = ss.staff_id
   WHERE ss.token = p_token AND ss.expires_at > now() AND s.active AND s.business_id = public.my_business_id();
  IF st.id IS NULL THEN RAISE EXCEPTION 'Locked: enter your PIN again'; END IF;
  IF NOT (st.role = ANY(p_roles)) THEN RAISE EXCEPTION 'Your role (%) is not allowed to do this', st.role; END IF;
  RETURN st;
END $$;

CREATE OR REPLACE FUNCTION public.subscription_active(p_business uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.subscriptions WHERE business_id = p_business
    AND (trial_ends_at > now() OR coalesce(paid_until, '-infinity') > now()))
$$;

CREATE OR REPLACE FUNCTION public.require_staff(p_token uuid, p_roles text[]) RETURNS public.staff
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE st public.staff;
BEGIN
  st := public.require_staff_nosub(p_token, p_roles);
  IF NOT public.subscription_active(st.business_id) THEN
    RAISE EXCEPTION 'Subscription expired: renew on the Billing page to continue';
  END IF;
  RETURN st;
END $$;

CREATE OR REPLACE FUNCTION public.start_subscription_payment(p_token uuid, p_period text, p_currency text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s staff; n int; amt numeric; ref text;
BEGIN
  s := require_staff_nosub(p_token, ARRAY['admin','manager']);
  IF p_period NOT IN ('monthly','yearly') OR p_currency NOT IN ('MWK','USD') THEN RAISE EXCEPTION 'Invalid plan'; END IF;
  SELECT greatest(count(*),1) INTO n FROM stores WHERE business_id = s.business_id;
  amt := CASE WHEN p_currency = 'MWK' THEN 60000 ELSE 35 END * n;
  IF p_period = 'yearly' THEN amt := round(amt * 12 * 0.85, 2); END IF;
  ref := 'storq-' || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO subscription_payments (tx_ref, business_id, period, currency, amount, stores, created_by)
  VALUES (ref, s.business_id, p_period, p_currency, amt, n, s.id);
  RETURN json_build_object('tx_ref', ref, 'amount', amt, 'currency', p_currency, 'stores', n);
END $$;

REVOKE EXECUTE ON FUNCTION public.require_staff_nosub(uuid, text[]) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.subscription_active(uuid) FROM public, anon;

-- --- from 20261007101247_9e99c53e-cc56-4e02-b439-ace84c09bacf.sql ---------------
REVOKE EXECUTE ON FUNCTION public.subscription_active(uuid) FROM authenticated;

-- --- from 20261007101503_838baf20-162a-45c9-97a2-a1928381f341.sql ---------------
CREATE SCHEMA IF NOT EXISTS app;
REVOKE ALL ON SCHEMA app FROM public;
GRANT USAGE ON SCHEMA app TO authenticated, anon, service_role;

REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM public, anon, authenticated;

DO $$
DECLARE r record; n int; i int; callargs text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_arguments(p.oid) args, pg_get_function_identity_arguments(p.oid) idargs,
           pg_get_function_result(p.oid) res, p.pronargs, has_function_privilege('anon', p.oid, 'execute') anon_ok, p.provolatile
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
      AND p.proname <> 'rls_auto_enable'
      AND (has_function_privilege('authenticated', p.oid, 'execute') OR has_function_privilege('anon', p.oid, 'execute'))
  LOOP
    EXECUTE format('ALTER FUNCTION public.%I(%s) SET SCHEMA app', r.proname, r.idargs);
    callargs := '';
    FOR i IN 1..r.pronargs LOOP
      callargs := callargs || CASE WHEN i > 1 THEN ', ' ELSE '' END || '$' || i;
    END LOOP;
    EXECUTE format('CREATE FUNCTION public.%I(%s) RETURNS %s LANGUAGE sql %s SECURITY INVOKER SET search_path = public AS %L',
      r.proname, r.args, r.res, CASE WHEN r.provolatile = 's' THEN 'STABLE' ELSE 'VOLATILE' END,
      format('SELECT app.%I(%s)', r.proname, callargs));
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM public', r.proname, r.idargs);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated, service_role', r.proname, r.idargs);
    EXECUTE format('GRANT EXECUTE ON FUNCTION app.%I(%s) TO authenticated, service_role', r.proname, r.idargs);
    IF r.anon_ok THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO anon', r.proname, r.idargs);
      EXECUTE format('GRANT EXECUTE ON FUNCTION app.%I(%s) TO anon', r.proname, r.idargs);
    END IF;
  END LOOP;
END $$;

CREATE POLICY "no direct access" ON public.staff_sessions FOR SELECT TO authenticated USING (false);

-- --- from 20261007102244_c10153f5-18b7-409c-8196-3337d3f296c4.sql ---------------
-- ===== Tax settings & new columns =====
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS tax_rate numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_inclusive boolean NOT NULL DEFAULT true;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS tax numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refunded numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shift_id uuid;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS refunded_qty numeric NOT NULL DEFAULT 0;

-- ===== Stock movement ledger =====
CREATE TABLE public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  delta numeric NOT NULL,
  balance_after numeric NOT NULL,
  reason text NOT NULL DEFAULT 'adjustment',
  note text,
  ref_id uuid,
  staff_id uuid REFERENCES public.staff(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.stock_movements(store_id, product_id, created_at DESC);
GRANT SELECT ON public.stock_movements TO authenticated;
GRANT ALL ON public.stock_movements TO service_role;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own stock movements" ON public.stock_movements FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.business_id = app.my_business_id()));

CREATE OR REPLACE FUNCTION app.log_stock_movement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d numeric; v_staff text; v_ref text;
BEGIN
  d := NEW.qty - CASE WHEN TG_OP = 'UPDATE' THEN OLD.qty ELSE 0 END;
  IF d = 0 THEN RETURN NEW; END IF;
  v_staff := nullif(current_setting('storq.staff', true), '');
  v_ref := nullif(current_setting('storq.ref', true), '');
  INSERT INTO public.stock_movements(store_id, product_id, delta, balance_after, reason, note, ref_id, staff_id)
  VALUES (NEW.store_id, NEW.product_id, d, NEW.qty,
    coalesce(nullif(current_setting('storq.reason', true), ''), 'adjustment'),
    nullif(current_setting('storq.note', true), ''),
    v_ref::uuid, v_staff::uuid);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.log_stock_movement() FROM public, anon, authenticated;
CREATE TRIGGER store_stock_ledger AFTER INSERT OR UPDATE OF qty ON public.store_stock
  FOR EACH ROW EXECUTE FUNCTION app.log_stock_movement();

CREATE OR REPLACE FUNCTION app.set_ctx(p_reason text, p_ref uuid, p_note text) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('storq.reason', coalesce(p_reason,''), true),
         set_config('storq.ref', coalesce(p_ref::text,''), true),
         set_config('storq.note', coalesce(p_note,''), true);
$$;
REVOKE ALL ON FUNCTION app.set_ctx(text, uuid, text) FROM public, anon, authenticated;

-- record acting staff for the ledger whenever a PIN session is verified
CREATE OR REPLACE FUNCTION public.require_staff_nosub(p_token uuid, p_roles text[])
 RETURNS staff LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE st public.staff;
BEGIN
  SELECT s.* INTO st FROM public.staff_sessions ss JOIN public.staff s ON s.id = ss.staff_id
   WHERE ss.token = p_token AND ss.expires_at > now() AND s.active AND s.business_id = public.my_business_id();
  IF st.id IS NULL THEN RAISE EXCEPTION 'Locked: enter your PIN again'; END IF;
  IF NOT (st.role = ANY(p_roles)) THEN RAISE EXCEPTION 'Your role (%) is not allowed to do this', st.role; END IF;
  PERFORM set_config('storq.staff', st.id::text, true);
  RETURN st;
END $$;

-- sale stock movement tags reason
CREATE OR REPLACE FUNCTION public._move_stock(p_sale uuid, p_sign integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM app.set_ctx(CASE WHEN p_sign < 0 THEN 'sale' ELSE 'sale_reversal' END, p_sale, NULL);
  INSERT INTO public.store_stock(store_id, product_id, qty)
  SELECT s.store_id, i.product_id, p_sign * i.qty FROM public.sale_items i JOIN public.sales s ON s.id = i.sale_id
   WHERE i.sale_id = p_sale AND i.product_id IS NOT NULL
  ON CONFLICT (store_id, product_id) DO UPDATE SET qty = public.store_stock.qty + excluded.qty;
  PERFORM app.set_ctx(NULL, NULL, NULL);
END $$;
REVOKE EXECUTE ON FUNCTION public._move_stock(uuid, int) FROM public, anon, authenticated;

-- backfill opening balances so the ledger starts from current stock
INSERT INTO public.stock_movements(store_id, product_id, delta, balance_after, reason, note)
SELECT store_id, product_id, qty, qty, 'opening_balance', 'Balance when ledger started' FROM public.store_stock WHERE qty <> 0;

-- stock adjustment with reason
CREATE OR REPLACE FUNCTION app.adjust_stock_reason(p_token uuid, p_store uuid, p_product uuid, p_delta numeric, p_reason text, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff;
BEGIN
  me := public.require_staff(p_token, array['admin','manager']);
  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store AND business_id = me.business_id) THEN RAISE EXCEPTION 'Unknown store'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product AND business_id = me.business_id) THEN RAISE EXCEPTION 'Unknown product'; END IF;
  IF p_reason NOT IN ('supplier_intake','damage','shrinkage','transfer_in','transfer_out','correction','return_to_supplier','adjustment') THEN
    RAISE EXCEPTION 'Unknown reason'; END IF;
  PERFORM app.set_ctx(p_reason, NULL, p_note);
  INSERT INTO public.store_stock(store_id, product_id, qty) VALUES (p_store, p_product, p_delta)
    ON CONFLICT (store_id, product_id) DO UPDATE SET qty = public.store_stock.qty + excluded.qty;
  PERFORM app.set_ctx(NULL, NULL, NULL);
END $$;

-- stock take close tags reason
CREATE OR REPLACE FUNCTION app.close_stock_take(p_token uuid, p_take uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff; t public.stock_takes;
BEGIN
  me := public.require_staff(p_token, array['admin','manager']);
  SELECT * INTO t FROM public.stock_takes WHERE id = p_take AND business_id = me.business_id AND status = 'open';
  IF t.id IS NULL THEN RAISE EXCEPTION 'Stock take is not open'; END IF;
  PERFORM app.set_ctx('stocktake', p_take, NULL);
  INSERT INTO public.store_stock(store_id, product_id, qty)
    SELECT t.store_id, product_id, counted FROM public.stock_take_lines WHERE stock_take_id = p_take AND counted IS NOT NULL
  ON CONFLICT (store_id, product_id) DO UPDATE SET qty = excluded.qty;
  PERFORM app.set_ctx(NULL, NULL, NULL);
  UPDATE public.stock_takes SET status = 'closed', closed_by = me.id, closed_at = now() WHERE id = p_take;
END $$;

-- ===== Cash shifts =====
CREATE TABLE public.cash_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open',
  opened_by uuid REFERENCES public.staff(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  opening_float numeric NOT NULL DEFAULT 0,
  closed_by uuid REFERENCES public.staff(id),
  closed_at timestamptz,
  expected_cash numeric,
  counted_cash numeric,
  variance numeric,
  summary jsonb,
  notes text
);
CREATE UNIQUE INDEX one_open_shift_per_store ON public.cash_shifts(store_id) WHERE status = 'open';
GRANT SELECT ON public.cash_shifts TO authenticated;
GRANT ALL ON public.cash_shifts TO service_role;
ALTER TABLE public.cash_shifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own shifts" ON public.cash_shifts FOR SELECT TO authenticated USING (business_id = app.my_business_id());

CREATE TABLE public.cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.cash_shifts(id) ON DELETE CASCADE,
  kind text NOT NULL,
  amount numeric NOT NULL,
  reason text,
  staff_id uuid REFERENCES public.staff(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.cash_movements TO authenticated;
GRANT ALL ON public.cash_movements TO service_role;
ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own cash movements" ON public.cash_movements FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cash_shifts s WHERE s.id = shift_id AND s.business_id = app.my_business_id()));

-- ===== Refunds =====
CREATE TABLE public.refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id),
  sale_id uuid NOT NULL REFERENCES public.sales(id),
  number serial,
  amount numeric NOT NULL,
  cost numeric NOT NULL DEFAULT 0,
  tax numeric NOT NULL DEFAULT 0,
  method text NOT NULL DEFAULT 'cash',
  reason text,
  staff_id uuid REFERENCES public.staff(id),
  shift_id uuid REFERENCES public.cash_shifts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.refunds TO authenticated;
GRANT ALL ON public.refunds TO service_role;
ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own refunds" ON public.refunds FOR SELECT TO authenticated USING (business_id = app.my_business_id());

CREATE TABLE public.refund_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id uuid NOT NULL REFERENCES public.refunds(id) ON DELETE CASCADE,
  sale_item_id uuid NOT NULL REFERENCES public.sale_items(id),
  product_id uuid REFERENCES public.products(id),
  name text NOT NULL,
  qty numeric NOT NULL,
  amount numeric NOT NULL,
  cost numeric NOT NULL DEFAULT 0,
  restock boolean NOT NULL DEFAULT true
);
GRANT SELECT ON public.refund_items TO authenticated;
GRANT ALL ON public.refund_items TO service_role;
ALTER TABLE public.refund_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own refund items" ON public.refund_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.refunds r WHERE r.id = refund_id AND r.business_id = app.my_business_id()));

-- ===== Shift functions =====
CREATE OR REPLACE FUNCTION app.open_shift(p_token uuid, p_store uuid, p_float numeric, p_notes text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff; r uuid;
BEGIN
  me := public.require_staff(p_token, array['admin','manager','cashier']);
  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store AND business_id = me.business_id) THEN RAISE EXCEPTION 'Unknown store'; END IF;
  IF me.role = 'cashier' AND me.store_id IS NOT NULL AND me.store_id <> p_store THEN RAISE EXCEPTION 'You are not assigned to this store'; END IF;
  IF EXISTS (SELECT 1 FROM public.cash_shifts WHERE store_id = p_store AND status = 'open') THEN RAISE EXCEPTION 'A shift is already open for this store'; END IF;
  IF coalesce(p_float,0) < 0 THEN RAISE EXCEPTION 'Float cannot be negative'; END IF;
  INSERT INTO public.cash_shifts(business_id, store_id, opened_by, opening_float, notes)
    VALUES (me.business_id, p_store, me.id, coalesce(p_float,0), p_notes) RETURNING id INTO r;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION app.cash_move(p_token uuid, p_shift uuid, p_kind text, p_amount numeric, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff;
BEGIN
  me := public.require_staff(p_token, array['admin','manager','cashier']);
  IF p_kind NOT IN ('in','out') THEN RAISE EXCEPTION 'Kind must be in or out'; END IF;
  IF coalesce(p_amount,0) <= 0 THEN RAISE EXCEPTION 'Enter an amount'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cash_shifts WHERE id = p_shift AND business_id = me.business_id AND status = 'open') THEN RAISE EXCEPTION 'Shift is not open'; END IF;
  INSERT INTO public.cash_movements(shift_id, kind, amount, reason, staff_id) VALUES (p_shift, p_kind, p_amount, p_reason, me.id);
END $$;

-- computes the live cash summary for a shift window
CREATE OR REPLACE FUNCTION app.shift_summary(p_shift uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.cash_shifts; v_end timestamptz; cash_sales numeric; other jsonb; refunds_cash numeric; ins numeric; outs numeric; exp numeric; n int;
BEGIN
  SELECT * INTO s FROM public.cash_shifts WHERE id = p_shift;
  v_end := coalesce(s.closed_at, now());
  SELECT coalesce(sum(p.amount),0) INTO cash_sales FROM public.payments p JOIN public.sales x ON x.id = p.sale_id
    WHERE x.store_id = s.store_id AND p.method = 'cash' AND p.created_at >= s.opened_at AND p.created_at <= v_end;
  SELECT coalesce(jsonb_object_agg(method, amt), '{}'::jsonb) INTO other FROM (
    SELECT p.method, sum(p.amount) amt FROM public.payments p JOIN public.sales x ON x.id = p.sale_id
    WHERE x.store_id = s.store_id AND p.created_at >= s.opened_at AND p.created_at <= v_end GROUP BY p.method) q;
  SELECT count(DISTINCT p.sale_id) INTO n FROM public.payments p JOIN public.sales x ON x.id = p.sale_id
    WHERE x.store_id = s.store_id AND p.created_at >= s.opened_at AND p.created_at <= v_end;
  SELECT coalesce(sum(amount),0) INTO refunds_cash FROM public.refunds
    WHERE store_id = s.store_id AND method = 'cash' AND created_at >= s.opened_at AND created_at <= v_end;
  SELECT coalesce(sum(amount) FILTER (WHERE kind='in'),0), coalesce(sum(amount) FILTER (WHERE kind='out'),0) INTO ins, outs
    FROM public.cash_movements WHERE shift_id = p_shift;
  SELECT coalesce(sum(amount),0) INTO exp FROM public.expenses
    WHERE store_id = s.store_id AND source = 'till' AND created_at >= s.opened_at AND created_at <= v_end;
  RETURN jsonb_build_object('opening_float', s.opening_float, 'cash_sales', cash_sales, 'by_method', other,
    'transactions', n, 'cash_refunds', refunds_cash, 'cash_in', ins, 'cash_out', outs, 'till_expenses', exp,
    'expected_cash', s.opening_float + cash_sales - refunds_cash + ins - outs - exp);
END $$;
REVOKE ALL ON FUNCTION app.shift_summary(uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION app.get_shift_summary(p_token uuid, p_shift uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff;
BEGIN
  me := public.require_staff(p_token, array['admin','manager','cashier']);
  IF NOT EXISTS (SELECT 1 FROM public.cash_shifts WHERE id = p_shift AND business_id = me.business_id) THEN RAISE EXCEPTION 'Unknown shift'; END IF;
  RETURN app.shift_summary(p_shift);
END $$;

CREATE OR REPLACE FUNCTION app.close_shift(p_token uuid, p_shift uuid, p_counted numeric, p_notes text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff; sm jsonb; exp numeric;
BEGIN
  me := public.require_staff(p_token, array['admin','manager','cashier']);
  PERFORM 1 FROM public.cash_shifts WHERE id = p_shift AND business_id = me.business_id AND status = 'open' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shift is not open'; END IF;
  IF p_counted IS NULL OR p_counted < 0 THEN RAISE EXCEPTION 'Enter the cash you counted'; END IF;
  UPDATE public.cash_shifts SET closed_at = now() WHERE id = p_shift;
  sm := app.shift_summary(p_shift);
  exp := (sm->>'expected_cash')::numeric;
  UPDATE public.cash_shifts SET status = 'closed', closed_by = me.id, expected_cash = exp, counted_cash = p_counted,
    variance = p_counted - exp, summary = sm, notes = coalesce(nullif(p_notes,''), notes) WHERE id = p_shift;
  RETURN sm || jsonb_build_object('counted_cash', p_counted, 'variance', p_counted - exp);
END $$;

-- ===== Refund function =====
-- p_items: [{sale_item_id, qty, restock}]
CREATE OR REPLACE FUNCTION app.process_refund(p_token uuid, p_sale uuid, p_items jsonb, p_method text, p_reason text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff; s public.sales; b public.businesses; r uuid; rn int; x jsonb; it public.sale_items;
  q numeric; amt numeric := 0; cst numeric := 0; line numeric; v_shift uuid; v_tax numeric;
BEGIN
  me := public.require_staff(p_token, array['admin','manager']);
  SELECT * INTO s FROM public.sales WHERE id = p_sale AND business_id = me.business_id FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Unknown sale'; END IF;
  IF s.status NOT IN ('completed','layby_completed','refunded','partially_refunded') THEN RAISE EXCEPTION 'Only completed sales can be refunded'; END IF;
  IF jsonb_array_length(coalesce(p_items,'[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'Pick items to return'; END IF;
  IF coalesce(trim(p_reason),'') = '' THEN RAISE EXCEPTION 'Give a reason for the refund'; END IF;
  SELECT * INTO b FROM public.businesses WHERE id = s.business_id;
  SELECT id INTO v_shift FROM public.cash_shifts WHERE store_id = s.store_id AND status = 'open';
  INSERT INTO public.refunds(business_id, store_id, sale_id, amount, method, reason, staff_id, shift_id)
    VALUES (s.business_id, s.store_id, s.id, 0, coalesce(p_method,'cash'), p_reason, me.id, v_shift) RETURNING id, number INTO r, rn;
  FOR x IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO it FROM public.sale_items WHERE id = (x->>'sale_item_id')::uuid AND sale_id = s.id FOR UPDATE;
    IF it.id IS NULL THEN RAISE EXCEPTION 'Item not on this sale'; END IF;
    q := (x->>'qty')::numeric;
    IF q IS NULL OR q <= 0 THEN CONTINUE; END IF;
    IF q > it.qty - it.refunded_qty THEN RAISE EXCEPTION 'Cannot return more % than was sold', it.name; END IF;
    line := round(it.price * q, 2);
    IF NOT b.tax_inclusive AND b.tax_rate > 0 THEN line := round(line * (1 + b.tax_rate/100), 2); END IF;
    amt := amt + line;
    UPDATE public.sale_items SET refunded_qty = refunded_qty + q WHERE id = it.id;
    INSERT INTO public.refund_items(refund_id, sale_item_id, product_id, name, qty, amount, cost, restock)
      VALUES (r, it.id, it.product_id, it.name, q, line, CASE WHEN coalesce((x->>'restock')::boolean, true) THEN it.cost * q ELSE 0 END,
        coalesce((x->>'restock')::boolean, true));
    IF coalesce((x->>'restock')::boolean, true) AND it.product_id IS NOT NULL THEN
      cst := cst + it.cost * q;
      PERFORM app.set_ctx('refund_restock', r, p_reason);
      INSERT INTO public.store_stock(store_id, product_id, qty) VALUES (s.store_id, it.product_id, q)
        ON CONFLICT (store_id, product_id) DO UPDATE SET qty = public.store_stock.qty + excluded.qty;
      PERFORM app.set_ctx(NULL, NULL, NULL);
    END IF;
  END LOOP;
  IF amt <= 0 THEN RAISE EXCEPTION 'Nothing to refund'; END IF;
  IF s.refunded + amt > s.total + 0.01 THEN RAISE EXCEPTION 'Refund exceeds sale total'; END IF;
  v_tax := CASE WHEN s.total > 0 THEN round(s.tax * amt / s.total, 2) ELSE 0 END;
  UPDATE public.refunds SET amount = amt, cost = cst, tax = v_tax WHERE id = r;
  UPDATE public.sales SET refunded = refunded + amt,
    status = CASE WHEN refunded + amt >= total - 0.01 THEN 'refunded' ELSE 'partially_refunded' END WHERE id = s.id;
  RETURN json_build_object('id', r, 'number', rn, 'amount', amt);
END $$;

-- ===== Tax settings =====
CREATE OR REPLACE FUNCTION app.save_tax_settings(p_token uuid, p_rate numeric, p_inclusive boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff;
BEGIN
  me := public.require_staff(p_token, array['admin']);
  IF p_rate IS NULL OR p_rate < 0 OR p_rate > 50 THEN RAISE EXCEPTION 'Tax rate must be between 0 and 50%%'; END IF;
  UPDATE public.businesses SET tax_rate = p_rate, tax_inclusive = coalesce(p_inclusive, true) WHERE id = me.business_id;
END $$;

-- ===== Checkout with tax + shift =====
CREATE OR REPLACE FUNCTION app.checkout(p_token uuid, p_store uuid, p_kind text, p_items jsonb, p_payment numeric, p_method text, p_customer_name text, p_customer_phone text, p_note text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff; st public.stores; b public.businesses; v_sub numeric; v_total numeric; v_tax numeric; v_sale uuid; v_status text; v_num int; v_pay numeric; v_shift uuid;
BEGIN
  me := public.require_staff(p_token, array['admin','manager','cashier']);
  SELECT * INTO st FROM public.stores WHERE id = p_store AND business_id = me.business_id;
  IF st.id IS NULL THEN RAISE EXCEPTION 'Unknown store'; END IF;
  IF me.role = 'cashier' AND me.store_id IS NOT NULL AND me.store_id <> p_store THEN RAISE EXCEPTION 'You are not assigned to this store'; END IF;
  IF jsonb_array_length(coalesce(p_items,'[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'Cart is empty'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) x WHERE coalesce((x->>'qty')::numeric,0) <= 0) THEN RAISE EXCEPTION 'Quantities must be above zero'; END IF;
  IF p_kind NOT IN ('sale','layby') THEN RAISE EXCEPTION 'Unknown sale type'; END IF;
  IF p_kind = 'layby' AND coalesce(trim(p_customer_name),'') = '' THEN RAISE EXCEPTION 'Layby needs a customer name'; END IF;
  SELECT * INTO b FROM public.businesses WHERE id = me.business_id;
  SELECT sum(public.effective_price(p.id) * (x->>'qty')::numeric) INTO v_sub
    FROM jsonb_array_elements(p_items) x JOIN public.products p ON p.id = (x->>'product_id')::uuid AND p.business_id = me.business_id;
  IF v_sub IS NULL THEN RAISE EXCEPTION 'Invalid items'; END IF;
  IF b.tax_rate > 0 AND b.tax_inclusive THEN v_total := round(v_sub, 2); v_tax := round(v_sub - v_sub / (1 + b.tax_rate/100), 2);
  ELSIF b.tax_rate > 0 THEN v_tax := round(v_sub * b.tax_rate/100, 2); v_total := round(v_sub, 2) + v_tax;
  ELSE v_total := round(v_sub, 2); v_tax := 0; END IF;
  SELECT id INTO v_shift FROM public.cash_shifts WHERE store_id = p_store AND status = 'open';
  v_pay := least(greatest(coalesce(p_payment,0),0), v_total);
  IF st.store_type = 'approval' THEN v_status := 'pending_approval';
  ELSIF p_kind = 'layby' THEN v_status := 'layby_open';
  ELSE v_status := 'completed'; v_pay := v_total; END IF;
  INSERT INTO public.sales(business_id, store_id, kind, status, total, tax, paid, payment_method, customer_name, customer_phone, note, created_by, shift_id)
    VALUES (me.business_id, p_store, p_kind, v_status, v_total, v_tax,
      CASE WHEN v_status = 'pending_approval' THEN 0 ELSE v_pay END, p_method, p_customer_name, p_customer_phone, p_note, me.id, v_shift)
    RETURNING id, number INTO v_sale, v_num;
  INSERT INTO public.sale_items(sale_id, product_id, name, qty, price, cost)
    SELECT v_sale, p.id, p.name, (x->>'qty')::numeric, public.effective_price(p.id), p.cost
      FROM jsonb_array_elements(p_items) x JOIN public.products p ON p.id = (x->>'product_id')::uuid AND p.business_id = me.business_id;
  IF v_status <> 'pending_approval' THEN
    PERFORM public._move_stock(v_sale, -1);
    IF v_pay > 0 THEN INSERT INTO public.payments(sale_id, amount, method, staff_id) VALUES (v_sale, v_pay, coalesce(p_method,'cash'), me.id); END IF;
    IF p_kind = 'layby' AND v_pay >= v_total THEN UPDATE public.sales SET status = 'layby_completed' WHERE id = v_sale; END IF;
  END IF;
  RETURN json_build_object('id', v_sale, 'number', v_num, 'status', (SELECT status FROM public.sales WHERE id = v_sale), 'total', v_total, 'tax', v_tax);
END $$;

-- ===== Public wrappers =====
CREATE OR REPLACE FUNCTION public.adjust_stock_reason(p_token uuid, p_store uuid, p_product uuid, p_delta numeric, p_reason text, p_note text)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$ SELECT app.adjust_stock_reason($1,$2,$3,$4,$5,$6) $$;
CREATE OR REPLACE FUNCTION public.open_shift(p_token uuid, p_store uuid, p_float numeric, p_notes text)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$ SELECT app.open_shift($1,$2,$3,$4) $$;
CREATE OR REPLACE FUNCTION public.cash_move(p_token uuid, p_shift uuid, p_kind text, p_amount numeric, p_reason text)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$ SELECT app.cash_move($1,$2,$3,$4,$5) $$;
CREATE OR REPLACE FUNCTION public.get_shift_summary(p_token uuid, p_shift uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$ SELECT app.get_shift_summary($1,$2) $$;
CREATE OR REPLACE FUNCTION public.close_shift(p_token uuid, p_shift uuid, p_counted numeric, p_notes text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$ SELECT app.close_shift($1,$2,$3,$4) $$;
CREATE OR REPLACE FUNCTION public.process_refund(p_token uuid, p_sale uuid, p_items jsonb, p_method text, p_reason text)
RETURNS json LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$ SELECT app.process_refund($1,$2,$3,$4,$5) $$;
CREATE OR REPLACE FUNCTION public.save_tax_settings(p_token uuid, p_rate numeric, p_inclusive boolean)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$ SELECT app.save_tax_settings($1,$2,$3) $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['adjust_stock_reason(uuid,uuid,uuid,numeric,text,text)','open_shift(uuid,uuid,numeric,text)',
    'cash_move(uuid,uuid,text,numeric,text)','get_shift_summary(uuid,uuid)','close_shift(uuid,uuid,numeric,text)',
    'process_refund(uuid,uuid,jsonb,text,text)','save_tax_settings(uuid,numeric,boolean)'] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION public.' || f || ' FROM public, anon';
    EXECUTE 'REVOKE ALL ON FUNCTION app.' || f || ' FROM public, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.' || f || ' TO authenticated, service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION app.' || f || ' TO authenticated, service_role';
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION app.set_ctx(text, uuid, text) TO authenticated;

-- --- from 20261007102303_4260d56f-8e50-4ca0-add6-16990ca353ab.sql ---------------
ALTER FUNCTION app.set_ctx(text, uuid, text) SET search_path = public;
REVOKE ALL ON FUNCTION app.set_ctx(text, uuid, text) FROM authenticated;

-- --- from 20261007115041_3e857134-c53a-47c9-a33f-3db16cc13962.sql ---------------
ALTER TABLE public.subscriptions ADD COLUMN paid_store_limit integer NOT NULL DEFAULT 0;
UPDATE public.subscriptions s SET paid_store_limit = coalesce((SELECT p.stores FROM public.subscription_payments p WHERE p.business_id=s.business_id AND p.status='paid' ORDER BY p.paid_at DESC NULLS LAST, p.created_at DESC LIMIT 1),0);

CREATE OR REPLACE FUNCTION public.subscription_active(p_business uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.subscriptions s WHERE s.business_id=p_business AND ((s.paid_until>now() AND s.paid_store_limit >= (SELECT count(*) FROM public.stores WHERE business_id=p_business)) OR (s.trial_ends_at>now() AND coalesce(s.paid_until,'-infinity')<=now())))
$$;

CREATE OR REPLACE FUNCTION public.require_staff(p_token uuid,p_roles text[]) RETURNS public.staff LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE st public.staff;
BEGIN
 st:=public.require_staff_nosub(p_token,p_roles);
 IF NOT public.subscription_active(st.business_id) THEN RAISE EXCEPTION 'Subscription inactive or store limit exceeded: open Billing to continue'; END IF;
 RETURN st;
END $$;

CREATE OR REPLACE FUNCTION app.save_store(p_token uuid,p_id uuid,p_name text,p_type text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE me public.staff; s public.subscriptions; n integer; r uuid;
BEGIN
 me:=public.require_staff(p_token,ARRAY['admin']);
 SELECT * INTO s FROM public.subscriptions WHERE business_id=me.business_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Subscription missing: open Billing'; END IF;
 IF p_name IS NULL OR trim(p_name)='' OR p_type IS NULL OR p_type NOT IN ('direct','approval') THEN RAISE EXCEPTION 'Enter a store name and valid store type'; END IF;
 IF p_id IS NULL THEN
  SELECT count(*) INTO n FROM public.stores WHERE business_id=me.business_id;
  IF s.paid_until>now() THEN
   IF n>=s.paid_store_limit THEN RAISE EXCEPTION 'All paid store slots are in use. Pay for additional capacity on Billing before adding a store'; END IF;
  ELSIF s.trial_ends_at<=now() THEN RAISE EXCEPTION 'Subscription expired: open Billing'; END IF;
  INSERT INTO public.stores(business_id,name,store_type) VALUES(me.business_id,trim(p_name),p_type) RETURNING id INTO r;
 ELSE
  UPDATE public.stores SET name=trim(p_name),store_type=p_type WHERE id=p_id AND business_id=me.business_id RETURNING id INTO r;
  IF r IS NULL THEN RAISE EXCEPTION 'Store not found'; END IF;
 END IF;
 RETURN r;
END $$;

CREATE OR REPLACE FUNCTION app.start_store_subscription_payment(p_token uuid,p_period text,p_currency text,p_stores integer) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE st public.staff; s public.subscriptions; n integer; amt numeric; ref text;
BEGIN
 st:=public.require_staff_nosub(p_token,ARRAY['admin','manager']);
 SELECT * INTO s FROM public.subscriptions WHERE business_id=st.business_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Subscription missing'; END IF;
 IF p_period IS NULL OR p_period NOT IN ('monthly','yearly') OR p_currency IS NULL OR p_currency NOT IN ('MWK','USD') THEN RAISE EXCEPTION 'Invalid plan'; END IF;
 SELECT greatest(count(*),1) INTO n FROM public.stores WHERE business_id=st.business_id;
 IF p_stores IS NULL OR p_stores<n OR p_stores>1000 OR (s.paid_until>now() AND p_stores<s.paid_store_limit) THEN RAISE EXCEPTION 'Store capacity must cover existing stores and active paid slots (maximum 1000)'; END IF;
 amt:=(CASE WHEN p_currency='MWK' THEN 60000 ELSE 35 END)*p_stores;
 IF p_period='yearly' THEN amt:=round(amt*12*0.85,2); END IF;
 ref:='storq-'||replace(gen_random_uuid()::text,'-','');
 INSERT INTO public.subscription_payments(tx_ref,business_id,period,currency,amount,stores,created_by) VALUES(ref,st.business_id,p_period,p_currency,amt,p_stores,st.id);
 RETURN json_build_object('tx_ref',ref,'amount',amt,'currency',p_currency,'stores',p_stores);
END $$;
REVOKE ALL ON FUNCTION app.start_store_subscription_payment(uuid,text,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION app.start_store_subscription_payment(uuid,text,text,integer) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.start_store_subscription_payment(p_token uuid,p_period text,p_currency text,p_stores integer) RETURNS json LANGUAGE sql SET search_path=public AS $$ SELECT app.start_store_subscription_payment($1,$2,$3,$4) $$;
REVOKE ALL ON FUNCTION public.start_store_subscription_payment(uuid,text,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.start_store_subscription_payment(uuid,text,text,integer) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION app.start_subscription_payment(p_token uuid,p_period text,p_currency text) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE st public.staff; n integer;
BEGIN
 st:=public.require_staff_nosub(p_token,ARRAY['admin','manager']);
 SELECT greatest((SELECT count(*) FROM public.stores WHERE business_id=st.business_id),CASE WHEN paid_until>now() THEN paid_store_limit ELSE 0 END,1) INTO n FROM public.subscriptions WHERE business_id=st.business_id;
 RETURN app.start_store_subscription_payment(p_token,p_period,p_currency,n);
END $$;

CREATE OR REPLACE FUNCTION public.complete_subscription_payment(p_tx_ref text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p public.subscription_payments; s public.subscriptions; target integer; old_slots integer; remaining double precision; duration double precision;
BEGIN
 SELECT * INTO p FROM public.subscription_payments WHERE tx_ref=p_tx_ref FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
 IF p.status='paid' THEN RETURN; END IF;
 IF p.status<>'pending' OR p.stores<1 OR p.period NOT IN ('monthly','yearly') OR p.currency NOT IN ('MWK','USD') OR p.amount<>round((CASE WHEN p.currency='MWK' THEN 60000 ELSE 35 END)*p.stores*(CASE WHEN p.period='yearly' THEN 12*0.85 ELSE 1 END),2) THEN RAISE EXCEPTION 'Invalid subscription payment'; END IF;
 SELECT * INTO s FROM public.subscriptions WHERE business_id=p.business_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Subscription missing'; END IF;
 old_slots:=CASE WHEN s.paid_until>now() THEN s.paid_store_limit ELSE 0 END;
 target:=greatest(p.stores,old_slots);
 remaining:=greatest(0,extract(epoch FROM (coalesce(s.paid_until,now())-now()))) * old_slots / target;
 duration:=extract(epoch FROM ((now()+CASE WHEN p.period='yearly' THEN interval '1 year' ELSE interval '1 month' END)-now())) * p.stores / target;
 UPDATE public.subscriptions SET paid_until=now()+make_interval(secs=>remaining+duration),paid_store_limit=target,plan=p.period WHERE business_id=p.business_id;
 UPDATE public.subscription_payments SET status='paid',paid_at=now() WHERE tx_ref=p_tx_ref;
END $$;
REVOKE ALL ON FUNCTION public.complete_subscription_payment(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_subscription_payment(text) TO service_role;

-- --- from 20261007115238_6662954d-34a5-4c8e-b71e-7f98b51895af.sql ---------------
DO $$
DECLARE b public.businesses; st public.staff; token uuid:=gen_random_uuid(); n integer; ref text:='storq-guard-test-'||replace(gen_random_uuid()::text,'-',''); first_end timestamptz; second_end timestamptz; blocked boolean;
BEGIN
 SELECT * INTO b FROM public.businesses LIMIT 1;
 SELECT * INTO st FROM public.staff WHERE business_id=b.id AND active AND role='admin' LIMIT 1;
 IF b.id IS NULL OR st.id IS NULL THEN RAISE EXCEPTION 'No existing admin available for rollback-only guard checks'; END IF;
 BEGIN
  PERFORM set_config('request.jwt.claim.sub',b.owner_id::text,true);
  PERFORM set_config('request.jwt.claims',json_build_object('sub',b.owner_id,'role','authenticated')::text,true);
  INSERT INTO public.staff_sessions(token,staff_id,expires_at) VALUES(token,st.id,now()+interval '5 minutes');
  SELECT count(*) INTO n FROM public.stores WHERE business_id=b.id;
  UPDATE public.subscriptions SET paid_until=now()+interval '1 month',paid_store_limit=n,trial_ends_at=now()+interval '1 day' WHERE business_id=b.id;
  IF NOT public.subscription_active(b.id) THEN RAISE EXCEPTION 'Covered store access failed'; END IF;
  blocked:=false;
  BEGIN
   PERFORM app.save_store(token,NULL,'Rollback-only test store','direct');
  EXCEPTION WHEN OTHERS THEN
   IF SQLERRM LIKE '%All paid store slots%' THEN blocked:=true; ELSE RAISE; END IF;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Extra store was not blocked'; END IF;
  UPDATE public.subscriptions SET paid_store_limit=greatest(n-1,0) WHERE business_id=b.id;
  IF public.subscription_active(b.id) THEN RAISE EXCEPTION 'Over-capacity access bypassed guard'; END IF;
  blocked:=false;
  BEGIN PERFORM public.require_staff(token,ARRAY['admin']);
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%store limit exceeded%' THEN blocked:=true; ELSE RAISE; END IF; END;
  IF NOT blocked THEN RAISE EXCEPTION 'Staff write guard failed'; END IF;
  UPDATE public.subscriptions SET paid_until=now()+interval '1 month',paid_store_limit=n WHERE business_id=b.id;
  INSERT INTO public.subscription_payments(tx_ref,business_id,period,currency,amount,stores,status,created_by) VALUES(ref,b.id,'monthly','MWK',60000*(n+1),n+1,'pending',st.id);
  PERFORM public.complete_subscription_payment(ref);
  SELECT paid_until INTO first_end FROM public.subscriptions WHERE business_id=b.id;
  IF NOT EXISTS(SELECT 1 FROM public.subscriptions WHERE business_id=b.id AND paid_store_limit=n+1) THEN RAISE EXCEPTION 'Confirmed capacity not activated'; END IF;
  PERFORM public.complete_subscription_payment(ref);
  SELECT paid_until INTO second_end FROM public.subscriptions WHERE business_id=b.id;
  IF first_end<>second_end THEN RAISE EXCEPTION 'Duplicate confirmation granted time'; END IF;
  IF abs(extract(epoch FROM (first_end-now()))-extract(epoch FROM ((now()+interval '1 month')-now()))*(1.0+n::numeric/(n+1)))>3 THEN RAISE EXCEPTION 'Prepaid credit calculation failed'; END IF;
  RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='guard_checks_passed_rollback';
 EXCEPTION WHEN no_data_found THEN
  IF SQLERRM<>'guard_checks_passed_rollback' THEN RAISE; END IF;
  RAISE NOTICE 'PASS: extra stores blocked; over-capacity staff actions blocked; paid slots activated; duplicate confirmation safe; prepaid credit preserved; all fixtures rolled back';
 END;
END $$;

-- --- from 20261007182146_48413f83-16ba-421f-b269-777201b5e8b1.sql ---------------
CREATE OR REPLACE FUNCTION app.process_refund(p_token uuid, p_sale uuid, p_items jsonb, p_method text, p_reason text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE me public.staff; s public.sales; r uuid; rn int; x jsonb; it public.sale_items;
  q numeric; amt numeric := 0; cst numeric := 0; line numeric; v_shift uuid; v_tax numeric; v_sub numeric; v_left numeric;
BEGIN
  me := public.require_staff(p_token, array['admin','manager']);
  SELECT * INTO s FROM public.sales WHERE id = p_sale AND business_id = me.business_id FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Unknown sale'; END IF;
  IF s.status NOT IN ('completed','layby_completed','partially_refunded') THEN RAISE EXCEPTION 'Only completed sales can be refunded'; END IF;
  IF jsonb_array_length(coalesce(p_items,'[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'Pick items to return'; END IF;
  IF coalesce(trim(p_reason),'') = '' THEN RAISE EXCEPTION 'Give a reason for the refund'; END IF;
  SELECT coalesce(sum(price*qty),0) INTO v_sub FROM public.sale_items WHERE sale_id = s.id;
  IF v_sub <= 0 THEN RAISE EXCEPTION 'Nothing to refund'; END IF;
  SELECT id INTO v_shift FROM public.cash_shifts WHERE store_id = s.store_id AND status = 'open';
  INSERT INTO public.refunds(business_id, store_id, sale_id, amount, method, reason, staff_id, shift_id)
    VALUES (s.business_id, s.store_id, s.id, 0, coalesce(p_method,'cash'), p_reason, me.id, v_shift) RETURNING id, number INTO r, rn;
  FOR x IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO it FROM public.sale_items WHERE id = (x->>'sale_item_id')::uuid AND sale_id = s.id FOR UPDATE;
    IF it.id IS NULL THEN RAISE EXCEPTION 'Item not on this sale'; END IF;
    q := (x->>'qty')::numeric;
    IF q IS NULL OR q <= 0 THEN CONTINUE; END IF;
    IF q > it.qty - it.refunded_qty THEN RAISE EXCEPTION 'Cannot return more % than was sold', it.name; END IF;
    -- share of what the customer actually paid (incl. any VAT charged on the sale)
    line := round(s.total * (it.price * q) / v_sub, 2);
    amt := amt + line;
    UPDATE public.sale_items SET refunded_qty = refunded_qty + q WHERE id = it.id;
    INSERT INTO public.refund_items(refund_id, sale_item_id, product_id, name, qty, amount, cost, restock)
      VALUES (r, it.id, it.product_id, it.name, q, line, CASE WHEN coalesce((x->>'restock')::boolean, true) THEN it.cost * q ELSE 0 END,
        coalesce((x->>'restock')::boolean, true));
    IF coalesce((x->>'restock')::boolean, true) AND it.product_id IS NOT NULL THEN
      cst := cst + it.cost * q;
      PERFORM app.set_ctx('refund_restock', r, p_reason);
      INSERT INTO public.store_stock(store_id, product_id, qty) VALUES (s.store_id, it.product_id, q)
        ON CONFLICT (store_id, product_id) DO UPDATE SET qty = public.store_stock.qty + excluded.qty;
      PERFORM app.set_ctx(NULL, NULL, NULL);
    END IF;
  END LOOP;
  IF amt <= 0 THEN RAISE EXCEPTION 'Nothing to refund'; END IF;
  SELECT coalesce(sum(qty - refunded_qty),0) INTO v_left FROM public.sale_items WHERE sale_id = s.id;
  IF v_left <= 0 OR s.refunded + amt > s.total THEN amt := s.total - s.refunded; END IF;
  IF amt <= 0 THEN RAISE EXCEPTION 'This sale is already fully refunded'; END IF;
  v_tax := CASE WHEN s.total > 0 THEN round(s.tax * amt / s.total, 2) ELSE 0 END;
  UPDATE public.refunds SET amount = amt, cost = cst, tax = v_tax WHERE id = r;
  UPDATE public.sales SET refunded = refunded + amt,
    status = CASE WHEN v_left <= 0 OR refunded + amt >= total - 0.01 THEN 'refunded' ELSE 'partially_refunded' END WHERE id = s.id;
  RETURN json_build_object('id', r, 'number', rn, 'amount', amt);
END $function$;

-- --- from 20261007183338_b2173994-433e-4727-8c60-bf0d6a8a7aca.sql ---------------
ALTER TABLE public.sales DROP CONSTRAINT sales_status_check;
ALTER TABLE public.sales ADD CONSTRAINT sales_status_check CHECK (status = ANY (ARRAY['completed','pending_approval','rejected','layby_open','layby_completed','layby_cancelled','partially_refunded','refunded']));

-- --- from 20261008204357_security_hardening.sql ---------------------------------
-- ============================================================================
-- Security hardening: anonymous RPC lockdown, PIN brute-force throttle,
-- device-bound short-lived staff sessions, server-side role separation for
-- reads, cost/margin segregation, input validation bounds, plan limits.
-- ============================================================================

-- ---------- 1. No unauthenticated (anon) RPC calls except the public share page ----------
DO $$
DECLARE r record; allow text[] := array['get_shared_collection'];
BEGIN
  FOR r IN
    SELECT n.nspname AS sch, p.proname AS fn, pg_get_function_identity_arguments(p.oid) AS idargs
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public','app') AND p.prokind = 'f'
      AND has_function_privilege('anon', p.oid, 'execute')
      AND NOT (p.proname = ANY (allow))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I(%s) FROM anon', r.sch, r.fn, r.idargs);
  END LOOP;
END $$;

-- Legacy reason-less stock adjustment (superseded by adjust_stock_reason) — drop both overloads.
DROP FUNCTION IF EXISTS public.adjust_stock(uuid, uuid, uuid, numeric);
DROP FUNCTION IF EXISTS app.adjust_stock(uuid, uuid, uuid, numeric);

-- ---------- 2. PIN attempt throttle (per business + per signed-in device) ----------
CREATE TABLE IF NOT EXISTS public.pin_throttle (
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  auth_uid uuid NOT NULL,
  fails integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, auth_uid)
);
ALTER TABLE public.pin_throttle ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "no direct access" ON public.pin_throttle;
CREATE POLICY "no direct access" ON public.pin_throttle FOR SELECT TO authenticated USING (false);
REVOKE ALL ON public.pin_throttle FROM public, anon, authenticated;
GRANT ALL ON public.pin_throttle TO service_role;
COMMENT ON TABLE public.pin_throttle IS 'Server-side counter that locks PIN entry after repeated wrong attempts on one device login.';

-- ---------- 3. Staff sessions: bind to the device login, shorten lifetime ----------
ALTER TABLE public.staff_sessions ADD COLUMN IF NOT EXISTS auth_uid uuid;
ALTER TABLE public.staff_sessions ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.staff_sessions ALTER COLUMN expires_at SET DEFAULT (now() + interval '8 hours');
CREATE INDEX IF NOT EXISTS staff_sessions_auth_uid_idx ON public.staff_sessions (auth_uid);
CREATE INDEX IF NOT EXISTS staff_sessions_expires_at_idx ON public.staff_sessions (expires_at);

-- ---------- 4. Cost / margin moved out of broadly readable tables ----------
CREATE TABLE IF NOT EXISTS public.product_costs (
  product_id uuid PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  cost numeric(12,2) NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS public.sale_item_costs (
  sale_item_id uuid PRIMARY KEY REFERENCES public.sale_items(id) ON DELETE CASCADE,
  cost numeric(12,2) NOT NULL DEFAULT 0
);
ALTER TABLE public.product_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_item_costs ENABLE ROW LEVEL SECURITY;

INSERT INTO public.product_costs (product_id, cost) SELECT id, cost FROM public.products ON CONFLICT (product_id) DO NOTHING;
INSERT INTO public.sale_item_costs (sale_item_id, cost) SELECT id, cost FROM public.sale_items ON CONFLICT (sale_item_id) DO NOTHING;

ALTER TABLE public.products DROP COLUMN IF EXISTS cost;
ALTER TABLE public.sale_items DROP COLUMN IF EXISTS cost;

-- ---------- 5. Role resolution from the verified PIN session ----------
CREATE OR REPLACE FUNCTION app.session_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.role
  FROM public.staff_sessions ss JOIN public.staff s ON s.id = ss.staff_id
  WHERE ss.auth_uid = auth.uid() AND ss.expires_at > now() AND s.active
  ORDER BY ss.expires_at DESC LIMIT 1
$$;
REVOKE ALL ON FUNCTION app.session_role() FROM public, anon;
GRANT EXECUTE ON FUNCTION app.session_role() TO authenticated, service_role;
COMMENT ON FUNCTION app.session_role() IS 'Role of the one live PIN session for this device login; NULL when nobody has unlocked.';

-- ---------- 6. RLS: business data requires a PIN session; money data requires a role ----------
DROP POLICY IF EXISTS "own products" ON public.products;
CREATE POLICY "own products" ON public.products FOR SELECT TO authenticated
  USING (business_id = app.my_business_id() AND app.session_role() = ANY (ARRAY['admin','manager','cashier']));

DROP POLICY IF EXISTS "own stores" ON public.stores;
CREATE POLICY "own stores" ON public.stores FOR SELECT TO authenticated
  USING (business_id = app.my_business_id());

DROP POLICY IF EXISTS "own staff" ON public.staff;
CREATE POLICY "own staff" ON public.staff FOR SELECT TO authenticated
  USING (business_id = app.my_business_id() AND app.session_role() = ANY (ARRAY['admin','manager','cashier']));

DROP POLICY IF EXISTS "own sales" ON public.sales;
CREATE POLICY "own sales" ON public.sales FOR SELECT TO authenticated
  USING (business_id = app.my_business_id() AND app.session_role() = ANY (ARRAY['admin','manager','cashier']));

DROP POLICY IF EXISTS "own sale items" ON public.sale_items;
CREATE POLICY "own sale items" ON public.sale_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_id AND s.business_id = app.my_business_id())
    AND app.session_role() = ANY (ARRAY['admin','manager','cashier']));

DROP POLICY IF EXISTS "own payments" ON public.payments;
CREATE POLICY "own payments" ON public.payments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_id AND s.business_id = app.my_business_id())
    AND app.session_role() = ANY (ARRAY['admin','manager','cashier']));

DROP POLICY IF EXISTS "own stock" ON public.store_stock;
CREATE POLICY "own stock" ON public.store_stock FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.business_id = app.my_business_id())
    AND app.session_role() = ANY (ARRAY['admin','manager','cashier']));

DROP POLICY IF EXISTS "own collections" ON public.collections;
CREATE POLICY "own collections" ON public.collections FOR SELECT TO authenticated
  USING (business_id = app.my_business_id() AND app.session_role() = ANY (ARRAY['admin','manager','cashier']));

DROP POLICY IF EXISTS "own product collections" ON public.product_collections;
CREATE POLICY "own product collections" ON public.product_collections FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.collections c WHERE c.id = collection_id AND c.business_id = app.my_business_id())
    AND app.session_role() = ANY (ARRAY['admin','manager','cashier']));

DROP POLICY IF EXISTS "own stock takes" ON public.stock_takes;
CREATE POLICY "own stock takes" ON public.stock_takes FOR SELECT TO authenticated
  USING (business_id = app.my_business_id() AND app.session_role() = ANY (ARRAY['admin','manager','cashier']));

DROP POLICY IF EXISTS "own stock take lines" ON public.stock_take_lines;
CREATE POLICY "own stock take lines" ON public.stock_take_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.stock_takes t WHERE t.id = stock_take_id AND t.business_id = app.my_business_id())
    AND app.session_role() = ANY (ARRAY['admin','manager','cashier']));

DROP POLICY IF EXISTS "own shifts" ON public.cash_shifts;
CREATE POLICY "own shifts" ON public.cash_shifts FOR SELECT TO authenticated
  USING (business_id = app.my_business_id() AND app.session_role() = ANY (ARRAY['admin','manager','cashier']));

DROP POLICY IF EXISTS "own cash movements" ON public.cash_movements;
CREATE POLICY "own cash movements" ON public.cash_movements FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cash_shifts s WHERE s.id = shift_id AND s.business_id = app.my_business_id())
    AND app.session_role() = ANY (ARRAY['admin','manager','cashier']));

DROP POLICY IF EXISTS "own expenses" ON public.expenses;
CREATE POLICY "own expenses" ON public.expenses FOR SELECT TO authenticated
  USING (business_id = app.my_business_id() AND app.session_role() = ANY (ARRAY['admin','manager','cashier']));

-- Managers and admins only: buying costs, refunds, stock ledger, billing.
DROP POLICY IF EXISTS "managers read product costs" ON public.product_costs;
CREATE POLICY "managers read product costs" ON public.product_costs FOR SELECT TO authenticated
  USING (app.session_role() = ANY (ARRAY['admin','manager'])
    AND EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_id AND p.business_id = app.my_business_id()));
DROP POLICY IF EXISTS "managers read sale item costs" ON public.sale_item_costs;
CREATE POLICY "managers read sale item costs" ON public.sale_item_costs FOR SELECT TO authenticated
  USING (app.session_role() = ANY (ARRAY['admin','manager'])
    AND EXISTS (SELECT 1 FROM public.sale_items i JOIN public.sales s ON s.id = i.sale_id
                 WHERE i.id = sale_item_id AND s.business_id = app.my_business_id()));

DROP POLICY IF EXISTS "own refunds" ON public.refunds;
CREATE POLICY "own refunds" ON public.refunds FOR SELECT TO authenticated
  USING (business_id = app.my_business_id() AND app.session_role() = ANY (ARRAY['admin','manager']));
DROP POLICY IF EXISTS "own refund items" ON public.refund_items;
CREATE POLICY "own refund items" ON public.refund_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.refunds r WHERE r.id = refund_id AND r.business_id = app.my_business_id())
    AND app.session_role() = ANY (ARRAY['admin','manager']));

DROP POLICY IF EXISTS "own stock movements" ON public.stock_movements;
CREATE POLICY "own stock movements" ON public.stock_movements FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.business_id = app.my_business_id())
    AND app.session_role() = ANY (ARRAY['admin','manager']));

DROP POLICY IF EXISTS "own sub payments" ON public.subscription_payments;
CREATE POLICY "own sub payments" ON public.subscription_payments FOR SELECT TO authenticated
  USING (business_id = app.my_business_id() AND app.session_role() = ANY (ARRAY['admin','manager']));

-- ---------- 7. Data bounds (defence in depth below the RPC validation) ----------
ALTER TABLE public.businesses DROP CONSTRAINT IF EXISTS businesses_name_len;
ALTER TABLE public.businesses ADD CONSTRAINT businesses_name_len CHECK (name IS NOT NULL AND char_length(btrim(name)) BETWEEN 1 AND 200 AND char_length(currency) BETWEEN 1 AND 4);
ALTER TABLE public.stores DROP CONSTRAINT IF EXISTS stores_name_len;
ALTER TABLE public.stores ADD CONSTRAINT stores_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 120);
ALTER TABLE public.staff DROP CONSTRAINT IF EXISTS staff_name_len;
ALTER TABLE public.staff ADD CONSTRAINT staff_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 100);
ALTER TABLE public.staff DROP CONSTRAINT IF EXISTS staff_role_set;
ALTER TABLE public.staff ADD CONSTRAINT staff_role_set CHECK (role IN ('admin','manager','cashier'));
ALTER TABLE public.staff DROP CONSTRAINT IF EXISTS staff_pin_shape;
ALTER TABLE public.staff ADD CONSTRAINT staff_pin_shape CHECK (pin_hash ~ '^\$2[aby]\$[0-9]{2}\$.{53}$');
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_name_len;
ALTER TABLE public.products ADD CONSTRAINT products_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 200);
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_sku_shape;
ALTER TABLE public.products ADD CONSTRAINT products_sku_shape CHECK (sku IS NULL OR btrim(sku) = '' OR (char_length(sku) <= 64 AND sku ~ '^[A-Za-z0-9._\- ]+$'));
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_price_bounds;
ALTER TABLE public.products ADD CONSTRAINT products_price_bounds CHECK (price >= 0 AND price <= 1000000000);
ALTER TABLE public.product_costs DROP CONSTRAINT IF EXISTS product_costs_bounds;
ALTER TABLE public.product_costs ADD CONSTRAINT product_costs_bounds CHECK (cost >= 0 AND cost <= 1000000000);
ALTER TABLE public.sale_items DROP CONSTRAINT IF EXISTS sale_items_bounds;
ALTER TABLE public.sale_items ADD CONSTRAINT sale_items_bounds CHECK (qty > 0 AND qty <= 1000000 AND price >= 0 AND price <= 1000000000 AND refunded_qty >= 0 AND refunded_qty <= qty);
ALTER TABLE public.sale_items DROP CONSTRAINT IF EXISTS sale_items_name_len;
ALTER TABLE public.sale_items ADD CONSTRAINT sale_items_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 200);
ALTER TABLE public.sale_item_costs DROP CONSTRAINT IF EXISTS sale_item_costs_bounds;
ALTER TABLE public.sale_item_costs ADD CONSTRAINT sale_item_costs_bounds CHECK (cost >= 0 AND cost <= 1000000000);
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_bounds;
ALTER TABLE public.payments ADD CONSTRAINT payments_bounds CHECK (amount > 0 AND amount <= 10000000000);
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_money_bounds;
ALTER TABLE public.sales ADD CONSTRAINT sales_money_bounds CHECK (total >= 0 AND total <= 10000000000 AND paid >= 0 AND refunded >= 0 AND refunded <= total + 0.01);
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_text_len;
ALTER TABLE public.sales ADD CONSTRAINT sales_text_len CHECK (coalesce(char_length(customer_name),0) <= 120 AND coalesce(char_length(customer_phone),0) <= 32 AND coalesce(char_length(note),0) <= 500);
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_phone_shape;
ALTER TABLE public.sales ADD CONSTRAINT sales_phone_shape CHECK (customer_phone IS NULL OR btrim(customer_phone) = '' OR customer_phone ~ '^[+0-9()\- ]{6,32}$');
ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_bounds;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_bounds CHECK (amount > 0 AND amount <= 1000000000 AND char_length(btrim(category)) BETWEEN 1 AND 60 AND coalesce(char_length(note),0) <= 500);
ALTER TABLE public.collections DROP CONSTRAINT IF EXISTS collections_bounds;
ALTER TABLE public.collections ADD CONSTRAINT collections_bounds CHECK (char_length(btrim(name)) BETWEEN 1 AND 120 AND discount_pct BETWEEN 0 AND 100);
ALTER TABLE public.store_stock DROP CONSTRAINT IF EXISTS store_stock_bounds;
ALTER TABLE public.store_stock ADD CONSTRAINT store_stock_bounds CHECK (qty >= 0 AND qty <= 100000000);
ALTER TABLE public.stock_take_lines DROP CONSTRAINT IF EXISTS stock_take_lines_bounds;
ALTER TABLE public.stock_take_lines ADD CONSTRAINT stock_take_lines_bounds CHECK (expected >= 0 AND (counted IS NULL OR (counted >= 0 AND counted <= 100000000)));
ALTER TABLE public.subscription_payments DROP CONSTRAINT IF EXISTS sub_payments_bounds;
ALTER TABLE public.subscription_payments ADD CONSTRAINT sub_payments_bounds CHECK (stores BETWEEN 1 AND 1000 AND amount > 0 AND amount <= 100000000000 AND status IN ('pending','paid','failed','cancelled'));
ALTER TABLE public.refunds DROP CONSTRAINT IF EXISTS refunds_bounds;
ALTER TABLE public.refunds ADD CONSTRAINT refunds_bounds CHECK (amount >= 0 AND amount <= 10000000000 AND coalesce(char_length(reason),0) <= 500);
ALTER TABLE public.pin_throttle DROP CONSTRAINT IF EXISTS pin_throttle_fails;
ALTER TABLE public.pin_throttle ADD CONSTRAINT pin_throttle_fails CHECK (fails >= 0);

-- ---------- 8. PIN unlock with throttling, device binding and single active session ----------
CREATE OR REPLACE FUNCTION app.unlock_with_pin(p_pin text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE b uuid; uid uuid := auth.uid(); st public.staff; t uuid; thr public.pin_throttle; v_exp timestamptz;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  b := app.my_business_id();
  IF b IS NULL THEN RAISE EXCEPTION 'No business for this account'; END IF;
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4,8}$' THEN RAISE EXCEPTION 'Wrong PIN'; END IF;

  SELECT * INTO thr FROM public.pin_throttle WHERE business_id = b AND auth_uid = uid FOR UPDATE;
  IF thr.business_id IS NOT NULL AND thr.locked_until IS NOT NULL AND thr.locked_until > now() THEN
    RAISE EXCEPTION 'Too many wrong PIN attempts. Try again in % minute(s)',
      greatest(1, ceil(extract(epoch FROM (thr.locked_until - now())) / 60)::int);
  END IF;

  SELECT * INTO st FROM public.staff
   WHERE business_id = b AND active AND pin_hash = extensions.crypt(p_pin, pin_hash) LIMIT 1;

  IF st.id IS NULL THEN
    INSERT INTO public.pin_throttle (business_id, auth_uid, fails, locked_until, updated_at)
    VALUES (b, uid, 1, NULL, now())
    ON CONFLICT (business_id, auth_uid) DO UPDATE
      SET fails = pin_throttle.fails + 1,
          locked_until = CASE WHEN pin_throttle.fails + 1 >= 5 THEN now() + interval '15 minutes' ELSE NULL END,
          updated_at = now();
    RAISE EXCEPTION 'Wrong PIN';
  END IF;

  DELETE FROM public.pin_throttle WHERE business_id = b AND auth_uid = uid;
  -- one live PIN session per signed-in device: a second unlock replaces the first
  DELETE FROM public.staff_sessions WHERE auth_uid = uid;
  DELETE FROM public.staff_sessions WHERE expires_at < now();

  v_exp := now() + interval '8 hours';
  INSERT INTO public.staff_sessions (staff_id, auth_uid, expires_at) VALUES (st.id, uid, v_exp) RETURNING token INTO t;
  RETURN json_build_object('token', t, 'id', st.id, 'name', st.name, 'role', st.role,
    'store_id', st.store_id, 'expires_at', v_exp);
END $$;

-- Sessions are now only usable from the device login that created them.
CREATE OR REPLACE FUNCTION public.require_staff_nosub(p_token uuid, p_roles text[]) RETURNS public.staff
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE st public.staff;
BEGIN
  SELECT s.* INTO st FROM public.staff_sessions ss JOIN public.staff s ON s.id = ss.staff_id
   WHERE ss.token = p_token AND ss.expires_at > now() AND ss.auth_uid = auth.uid()
     AND s.active AND s.business_id = app.my_business_id();
  IF st.id IS NULL THEN RAISE EXCEPTION 'Locked: enter your PIN again'; END IF;
  IF NOT (st.role = ANY(p_roles)) THEN RAISE EXCEPTION 'Your role (%) is not allowed to do this', st.role; END IF;
  PERFORM set_config('storq.staff', st.id::text, true);
  RETURN st;
END $$;

CREATE OR REPLACE FUNCTION app.lock_session(p_token uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  DELETE FROM public.staff_sessions ss
   WHERE ss.token = p_token AND (ss.auth_uid = uid OR ss.auth_uid IS NULL
     OR ss.staff_id IN (SELECT id FROM public.staff WHERE business_id = app.my_business_id()));
  DELETE FROM public.pin_throttle WHERE auth_uid = uid;
END $$;

-- Sign-out helper: drop every session and throttle row for this device login.
CREATE OR REPLACE FUNCTION app.lock_all_sessions() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); b uuid := app.my_business_id();
BEGIN
  DELETE FROM public.staff_sessions
   WHERE auth_uid = uid
      OR (b IS NOT NULL AND auth_uid IS NULL AND staff_id IN (SELECT id FROM public.staff WHERE business_id = b));
  DELETE FROM public.pin_throttle WHERE auth_uid = uid;
END $$;

-- ---------- 9. Subscription: trial is one store, and expiry is honest ----------
CREATE OR REPLACE FUNCTION public.subscription_active(p_business uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.subscriptions s WHERE s.business_id = p_business
    AND ((s.paid_until > now() AND s.paid_store_limit >= (SELECT count(*) FROM public.stores WHERE business_id = p_business))
      OR (s.trial_ends_at > now() AND coalesce(s.paid_until,'-infinity') <= now()
          AND (SELECT count(*) FROM public.stores WHERE business_id = p_business) <= 1)))
$$;

CREATE OR REPLACE FUNCTION app.save_store(p_token uuid, p_id uuid, p_name text, p_type text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff; s public.subscriptions; n integer; r uuid;
BEGIN
  me := public.require_staff(p_token, ARRAY['admin']);
  IF p_name IS NULL OR btrim(p_name) = '' THEN RAISE EXCEPTION 'Enter a store name'; END IF;
  IF char_length(btrim(p_name)) > 120 THEN RAISE EXCEPTION 'Store name is too long (max 120 characters)'; END IF;
  IF p_type IS NULL OR p_type NOT IN ('direct','approval') THEN RAISE EXCEPTION 'Choose a store type'; END IF;
  SELECT * INTO s FROM public.subscriptions WHERE business_id = me.business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscription missing: open Billing'; END IF;
  IF p_id IS NULL THEN
    SELECT count(*) INTO n FROM public.stores WHERE business_id = me.business_id;
    IF s.paid_until > now() THEN
      IF n >= s.paid_store_limit THEN RAISE EXCEPTION 'All paid store slots are in use. Pay for additional capacity on Billing before adding a store'; END IF;
    ELSIF s.trial_ends_at <= now() THEN
      RAISE EXCEPTION 'Subscription expired: open Billing';
    ELSIF n >= 1 THEN
      RAISE EXCEPTION 'The free trial covers one store. Pay on Billing to add more stores';
    END IF;
    INSERT INTO public.stores(business_id, name, store_type) VALUES(me.business_id, btrim(p_name), p_type) RETURNING id INTO r;
  ELSE
    UPDATE public.stores SET name = btrim(p_name), store_type = p_type WHERE id = p_id AND business_id = me.business_id RETURNING id INTO r;
    IF r IS NULL THEN RAISE EXCEPTION 'Store not found'; END IF;
  END IF;
  RETURN r;
END $$;

-- ---------- 10. Staff: plan limit for staff PINs, validated input, PIN policy ----------
CREATE OR REPLACE FUNCTION app.save_staff(p_token uuid, p_id uuid, p_name text, p_role text, p_pin text, p_store uuid, p_active boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE me public.staff; r uuid; n integer; sub public.subscriptions; was_admin boolean;
BEGIN
  me := public.require_staff(p_token, ARRAY['admin']);
  IF p_name IS NULL OR btrim(p_name) = '' THEN RAISE EXCEPTION 'Enter a name'; END IF;
  IF char_length(btrim(p_name)) > 100 THEN RAISE EXCEPTION 'Name is too long (max 100 characters)'; END IF;
  IF p_role IS NULL OR p_role NOT IN ('admin','manager','cashier') THEN RAISE EXCEPTION 'Choose a valid role'; END IF;
  IF p_store IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store AND business_id = me.business_id) THEN
    RAISE EXCEPTION 'Unknown store';
  END IF;
  IF p_pin IS NOT NULL AND p_pin <> '' THEN
    IF p_pin !~ '^[0-9]{4,8}$' THEN RAISE EXCEPTION 'PIN must be 4 to 8 digits'; END IF;
    IF public.pin_taken(me.business_id, p_pin, p_id) THEN RAISE EXCEPTION 'That PIN is already used by someone else'; END IF;
  END IF;

  IF p_id IS NULL THEN
    IF p_pin IS NULL OR p_pin = '' THEN RAISE EXCEPTION 'PIN required'; END IF;
    SELECT * INTO sub FROM public.subscriptions WHERE business_id = me.business_id;
    IF sub.business_id IS NULL OR coalesce(sub.paid_until, '-infinity') <= now() THEN
      SELECT count(*) INTO n FROM public.staff WHERE business_id = me.business_id AND active;
      IF n >= 3 THEN RAISE EXCEPTION 'The free plan covers 3 staff PINs. Pay on Billing to add more'; END IF;
    END IF;
    INSERT INTO public.staff(business_id, name, role, pin_hash, store_id, active)
      VALUES (me.business_id, btrim(p_name), p_role, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)), p_store, coalesce(p_active, true))
      RETURNING id INTO r;
  ELSE
    IF p_id = me.id AND (p_role <> 'admin' OR NOT coalesce(p_active, true)) THEN RAISE EXCEPTION 'You cannot demote or deactivate yourself'; END IF;
    SELECT role = 'admin' AND active INTO was_admin FROM public.staff WHERE id = p_id AND business_id = me.business_id;
    IF was_admin IS NULL THEN RAISE EXCEPTION 'Staff not found'; END IF;
    IF was_admin AND (p_role <> 'admin' OR NOT coalesce(p_active, true))
       AND (SELECT count(*) FROM public.staff WHERE business_id = me.business_id AND active AND role = 'admin' AND id <> p_id) = 0 THEN
      RAISE EXCEPTION 'Keep at least one active admin';
    END IF;
    UPDATE public.staff SET name = btrim(p_name), role = p_role, store_id = p_store, active = coalesce(p_active, true),
      pin_hash = CASE WHEN p_pin IS NOT NULL AND p_pin <> '' THEN extensions.crypt(p_pin, extensions.gen_salt('bf', 10)) ELSE pin_hash END
      WHERE id = p_id AND business_id = me.business_id RETURNING id INTO r;
    IF r IS NULL THEN RAISE EXCEPTION 'Staff not found'; END IF;
    IF NOT coalesce(p_active, true) THEN DELETE FROM public.staff_sessions WHERE staff_id = p_id; END IF;
  END IF;
  RETURN r;
END $$;

-- ---------- 11. Setup: validated business creation ----------
CREATE OR REPLACE FUNCTION app.setup_business(p_name text, p_currency text, p_store_name text, p_store_type text, p_owner_name text, p_pin text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE b uuid; s uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF EXISTS (SELECT 1 FROM public.businesses WHERE owner_id = auth.uid()) THEN RAISE EXCEPTION 'Business already set up'; END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN RAISE EXCEPTION 'Enter a business name'; END IF;
  IF char_length(btrim(p_name)) > 200 THEN RAISE EXCEPTION 'Business name is too long (max 200 characters)'; END IF;
  IF p_store_name IS NULL OR btrim(p_store_name) = '' THEN RAISE EXCEPTION 'Enter a store name'; END IF;
  IF char_length(btrim(p_store_name)) > 120 THEN RAISE EXCEPTION 'Store name is too long (max 120 characters)'; END IF;
  IF p_owner_name IS NULL OR btrim(p_owner_name) = '' THEN RAISE EXCEPTION 'Enter your name'; END IF;
  IF char_length(btrim(p_owner_name)) > 100 THEN RAISE EXCEPTION 'Name is too long (max 100 characters)'; END IF;
  IF p_store_type IS NULL OR p_store_type NOT IN ('direct','approval') THEN RAISE EXCEPTION 'Choose a store type'; END IF;
  IF p_currency IS NOT NULL AND btrim(p_currency) <> '' AND char_length(btrim(p_currency)) > 4 THEN RAISE EXCEPTION 'Currency symbol is too long'; END IF;
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4,8}$' THEN RAISE EXCEPTION 'PIN must be 4 to 8 digits'; END IF;
  INSERT INTO public.businesses(owner_id, name, currency) VALUES (auth.uid(), btrim(p_name), coalesce(nullif(btrim(p_currency),''),'R')) RETURNING id INTO b;
  INSERT INTO public.stores(business_id, name, store_type) VALUES (b, btrim(p_store_name), p_store_type) RETURNING id INTO s;
  INSERT INTO public.staff(business_id, name, role, pin_hash) VALUES (b, btrim(p_owner_name), 'admin', extensions.crypt(p_pin, extensions.gen_salt('bf', 10)));
  RETURN b;
END $$;

-- ---------- 12. Products: validated input, cost written to the gated table ----------
-- numeric NaN compares greater than every finite value, so an upper bound also rejects it.
CREATE OR REPLACE FUNCTION app.save_product(p_token uuid, p_id uuid, p_name text, p_sku text, p_category text, p_price numeric, p_cost numeric, p_active boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff; r uuid;
BEGIN
  me := public.require_staff(p_token, ARRAY['admin','manager']);
  IF p_name IS NULL OR btrim(p_name) = '' THEN RAISE EXCEPTION 'Enter an item name'; END IF;
  IF char_length(btrim(p_name)) > 200 THEN RAISE EXCEPTION 'Item name is too long (max 200 characters)'; END IF;
  IF p_name ~ '[[:cntrl:]<>]' THEN RAISE EXCEPTION 'Item name contains unsupported characters'; END IF;
  IF p_sku IS NOT NULL AND btrim(p_sku) <> '' AND (char_length(p_sku) > 64 OR p_sku !~ '^[A-Za-z0-9._\- ]+$') THEN
    RAISE EXCEPTION 'Barcode/SKU may only contain letters, numbers, spaces and . _ - (max 64)';
  END IF;
  IF p_category IS NOT NULL AND char_length(p_category) > 120 THEN RAISE EXCEPTION 'Category is too long (max 120 characters)'; END IF;
  IF p_price IS NULL OR p_price NOT BETWEEN 0 AND 1000000000 THEN RAISE EXCEPTION 'Selling price must be between 0 and 1,000,000,000'; END IF;
  IF p_cost IS NOT NULL AND p_cost NOT BETWEEN 0 AND 1000000000 THEN RAISE EXCEPTION 'Buying cost must be between 0 and 1,000,000,000'; END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.products(business_id, name, sku, category, price, active)
      VALUES (me.business_id, btrim(p_name), nullif(btrim(p_sku),''), nullif(btrim(p_category),''), p_price, coalesce(p_active, true))
      RETURNING id INTO r;
  ELSE
    UPDATE public.products SET name = btrim(p_name), sku = nullif(btrim(p_sku),''), category = nullif(btrim(p_category),''),
      price = p_price, active = coalesce(p_active, true)
      WHERE id = p_id AND business_id = me.business_id RETURNING id INTO r;
    IF r IS NULL THEN RAISE EXCEPTION 'Item not found'; END IF;
  END IF;
  INSERT INTO public.product_costs(product_id, cost) VALUES (r, coalesce(p_cost, 0))
    ON CONFLICT (product_id) DO UPDATE SET cost = coalesce(p_cost, 0);
  RETURN r;
END $$;

-- ---------- 13. Checkout: validated cart, stock floor, cost to gated table ----------
CREATE OR REPLACE FUNCTION app.checkout(p_token uuid, p_store uuid, p_kind text, p_items jsonb, p_payment numeric, p_method text, p_customer_name text, p_customer_phone text, p_note text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff; st public.stores; b public.businesses; v_sub numeric; v_total numeric; v_tax numeric; v_sale uuid;
  v_status text; v_num int; v_pay numeric; v_shift uuid; v_short text; v_lines int; v_matched int; x jsonb;
  v_pid uuid; v_name text; v_price numeric; v_cost numeric; v_qty numeric; v_item uuid;
BEGIN
  me := public.require_staff(p_token, array['admin','manager','cashier']);
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'Cart must be a list of items'; END IF;
  IF jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Cart is empty'; END IF;
  IF jsonb_array_length(p_items) > 500 THEN RAISE EXCEPTION 'Too many lines on one sale (max 500)'; END IF;
  -- every line must carry a well-formed product id and a plain positive quantity
  SELECT count(*) INTO v_lines FROM jsonb_array_elements(p_items) x
   WHERE coalesce(jsonb_typeof(x),'') <> 'object'
      OR coalesce(x->>'product_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      OR coalesce(x->>'qty','') !~ '^[0-9]{1,7}(\.[0-9]{1,3})?$';
  IF v_lines > 0 THEN RAISE EXCEPTION 'Cart contains an item with a bad id or quantity'; END IF;
  SELECT count(*) INTO v_lines FROM jsonb_array_elements(p_items) x WHERE (x->>'qty')::numeric <= 0;
  IF v_lines > 0 THEN RAISE EXCEPTION 'Quantities must be above zero'; END IF;

  SELECT * INTO st FROM public.stores WHERE id = p_store AND business_id = me.business_id;
  IF st.id IS NULL THEN RAISE EXCEPTION 'Unknown store'; END IF;
  IF me.role = 'cashier' AND me.store_id IS NOT NULL AND me.store_id <> p_store THEN RAISE EXCEPTION 'You are not assigned to this store'; END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('sale','layby') THEN RAISE EXCEPTION 'Unknown sale type'; END IF;
  IF p_kind = 'layby' AND coalesce(btrim(p_customer_name),'') = '' THEN RAISE EXCEPTION 'Layby needs a customer name'; END IF;
  IF char_length(coalesce(p_customer_name,'')) > 120 THEN RAISE EXCEPTION 'Customer name is too long (max 120 characters)'; END IF;
  IF p_customer_name ~ '[[:cntrl:]<>]' THEN RAISE EXCEPTION 'Customer name contains unsupported characters'; END IF;
  IF p_customer_phone IS NOT NULL AND btrim(p_customer_phone) <> '' AND btrim(p_customer_phone) !~ '^[+0-9()\- ]{6,32}$' THEN
    RAISE EXCEPTION 'Customer phone must be 6-32 characters of digits, + ( ) - and spaces';
  END IF;
  IF coalesce(p_note,'') <> '' AND char_length(p_note) > 500 THEN RAISE EXCEPTION 'Note is too long (max 500 characters)'; END IF;
  IF p_method IS NOT NULL AND p_method NOT IN ('cash','card','mobile') THEN RAISE EXCEPTION 'Unknown payment method'; END IF;
  IF p_payment IS NOT NULL AND p_payment NOT BETWEEN 0 AND 10000000000 THEN RAISE EXCEPTION 'Payment amount must be between 0 and 10,000,000,000'; END IF;
  SELECT * INTO b FROM public.businesses WHERE id = me.business_id;

  SELECT count(*) INTO v_matched FROM jsonb_array_elements(p_items) x
    JOIN public.products p ON p.id = (x->>'product_id')::uuid AND p.business_id = me.business_id AND p.active;
  IF v_matched <> jsonb_array_length(p_items) THEN RAISE EXCEPTION 'One or more items are not in your catalogue'; END IF;

  SELECT sum(public.effective_price(p.id) * (x->>'qty')::numeric) INTO v_sub
    FROM jsonb_array_elements(p_items) x JOIN public.products p ON p.id = (x->>'product_id')::uuid AND p.business_id = me.business_id;
  IF v_sub IS NULL OR v_sub NOT BETWEEN 0 AND 100000000000 THEN RAISE EXCEPTION 'Invalid items'; END IF;
  IF b.tax_rate > 0 AND b.tax_inclusive THEN v_total := round(v_sub, 2); v_tax := round(v_sub - v_sub / (1 + b.tax_rate/100), 2);
  ELSIF b.tax_rate > 0 THEN v_tax := round(v_sub * b.tax_rate/100, 2); v_total := round(v_sub, 2) + v_tax;
  ELSE v_total := round(v_sub, 2); v_tax := 0; END IF;

  v_status := CASE WHEN st.store_type = 'approval' THEN 'pending_approval' WHEN p_kind = 'layby' THEN 'layby_open' ELSE 'completed' END;

  -- stock may not go negative on a sale that moves stock right now
  IF v_status <> 'pending_approval' THEN
    WITH need AS (
      SELECT (x->>'product_id')::uuid AS pid, sum((x->>'qty')::numeric) AS q
      FROM jsonb_array_elements(p_items) x GROUP BY 1)
    SELECT string_agg(p.name, ', ') INTO v_short FROM need
      JOIN public.products p ON p.id = need.pid
      LEFT JOIN public.store_stock ss ON ss.product_id = need.pid AND ss.store_id = p_store
      WHERE coalesce(ss.qty, 0) < need.q;
    IF v_short IS NOT NULL THEN RAISE EXCEPTION 'Not enough stock for: %', v_short; END IF;
  END IF;

  SELECT id INTO v_shift FROM public.cash_shifts WHERE store_id = p_store AND status = 'open';
  v_pay := least(greatest(coalesce(p_payment, 0), 0), v_total);
  IF v_status = 'completed' THEN v_pay := v_total; END IF;

  INSERT INTO public.sales(business_id, store_id, kind, status, total, tax, paid, payment_method, customer_name, customer_phone, note, created_by, shift_id)
    VALUES (me.business_id, p_store, p_kind, v_status, v_total, v_tax,
      CASE WHEN v_status = 'pending_approval' THEN 0 ELSE v_pay END, p_method,
      nullif(btrim(coalesce(p_customer_name,'')),''), nullif(btrim(coalesce(p_customer_phone,'')),''),
      nullif(btrim(coalesce(p_note,'')),''), me.id, v_shift)
    RETURNING id, number INTO v_sale, v_num;

  FOR x IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT p.id, p.name, public.effective_price(p.id), coalesce(pc.cost, 0)
      INTO v_pid, v_name, v_price, v_cost
      FROM public.products p LEFT JOIN public.product_costs pc ON pc.product_id = p.id
      WHERE p.id = (x->>'product_id')::uuid AND p.business_id = me.business_id;
    v_qty := (x->>'qty')::numeric;
    INSERT INTO public.sale_items(sale_id, product_id, name, qty, price)
      VALUES (v_sale, v_pid, v_name, v_qty, v_price) RETURNING id INTO v_item;
    INSERT INTO public.sale_item_costs(sale_item_id, cost) VALUES (v_item, v_cost);
  END LOOP;

  IF v_status <> 'pending_approval' THEN
    PERFORM public._move_stock(v_sale, -1);
    IF v_pay > 0 THEN INSERT INTO public.payments(sale_id, amount, method, staff_id) VALUES (v_sale, v_pay, coalesce(p_method,'cash'), me.id); END IF;
    IF p_kind = 'layby' AND v_pay >= v_total THEN UPDATE public.sales SET status = 'layby_completed' WHERE id = v_sale; END IF;
  END IF;
  RETURN json_build_object('id', v_sale, 'number', v_num, 'status', (SELECT status FROM public.sales WHERE id = v_sale), 'total', v_total, 'tax', v_tax);
END $$;

-- ---------- 14. Approval: same stock floor when stock actually moves ----------
CREATE OR REPLACE FUNCTION app.review_invoice(p_token uuid, p_sale uuid, p_approve boolean, p_payment numeric, p_method text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff; s public.sales; v_pay numeric; v_status text; v_short text;
BEGIN
  me := public.require_staff(p_token, array['admin','manager']);
  SELECT * INTO s FROM public.sales WHERE id = p_sale AND business_id = me.business_id FOR UPDATE;
  IF s.id IS NULL OR s.status <> 'pending_approval' THEN RAISE EXCEPTION 'Invoice is not awaiting approval'; END IF;
  IF s.created_by = me.id AND me.role <> 'admin' THEN RAISE EXCEPTION 'Another person must approve your invoice'; END IF;
  IF NOT p_approve THEN
    UPDATE public.sales SET status = 'rejected', approved_by = me.id, approved_at = now() WHERE id = p_sale;
    RETURN 'rejected';
  END IF;
  WITH need AS (SELECT product_id, sum(qty) AS q FROM public.sale_items WHERE sale_id = p_sale AND product_id IS NOT NULL GROUP BY 1)
  SELECT string_agg(p.name, ', ') INTO v_short FROM need
    JOIN public.products p ON p.id = need.product_id
    LEFT JOIN public.store_stock ss ON ss.product_id = need.product_id AND ss.store_id = s.store_id
    WHERE coalesce(ss.qty, 0) < need.q;
  IF v_short IS NOT NULL THEN RAISE EXCEPTION 'Not enough stock for: %', v_short; END IF;
  IF s.kind = 'layby' THEN
    v_pay := least(greatest(coalesce(p_payment, 0), 0), s.total);
    v_status := CASE WHEN v_pay >= s.total THEN 'layby_completed' ELSE 'layby_open' END;
  ELSE v_pay := s.total; v_status := 'completed'; END IF;
  IF p_method IS NOT NULL AND p_method NOT IN ('cash','card','mobile') THEN RAISE EXCEPTION 'Unknown payment method'; END IF;
  UPDATE public.sales SET status = v_status, paid = v_pay, payment_method = coalesce(p_method,'cash'), approved_by = me.id, approved_at = now() WHERE id = p_sale;
  PERFORM public._move_stock(p_sale, -1);
  IF v_pay > 0 THEN INSERT INTO public.payments(sale_id, amount, method, staff_id) VALUES (p_sale, v_pay, coalesce(p_method,'cash'), me.id); END IF;
  RETURN v_status;
END $$;

-- ---------- 15. Refunds: read buying cost from the gated table ----------
CREATE OR REPLACE FUNCTION app.process_refund(p_token uuid, p_sale uuid, p_items jsonb, p_method text, p_reason text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE me public.staff; s public.sales; r uuid; rn int; x jsonb; it public.sale_items;
  q numeric; amt numeric := 0; cst numeric := 0; line numeric; v_shift uuid; v_tax numeric; v_sub numeric; v_left numeric; v_unit numeric; v_bad int;
BEGIN
  me := public.require_staff(p_token, array['admin','manager']);
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'Refund must be a list of items'; END IF;
  IF jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Pick items to return'; END IF;
  IF jsonb_array_length(p_items) > 500 THEN RAISE EXCEPTION 'Too many lines on one refund (max 500)'; END IF;
  SELECT count(*) INTO v_bad FROM jsonb_array_elements(p_items) x
   WHERE coalesce(jsonb_typeof(x),'') <> 'object'
      OR coalesce(x->>'sale_item_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      OR coalesce(x->>'qty','') !~ '^[0-9]{1,7}(\.[0-9]{1,3})?$'
      OR (jsonb_exists(x,'restock') AND coalesce(x->>'restock','') NOT IN ('true','false'));
  IF v_bad > 0 THEN RAISE EXCEPTION 'Refund contains an item with a bad id or quantity'; END IF;
  SELECT * INTO s FROM public.sales WHERE id = p_sale AND business_id = me.business_id FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Unknown sale'; END IF;
  IF s.status NOT IN ('completed','layby_completed','partially_refunded') THEN RAISE EXCEPTION 'Only completed sales can be refunded'; END IF;
  IF coalesce(btrim(p_reason),'') = '' THEN RAISE EXCEPTION 'Give a reason for the refund'; END IF;
  IF char_length(p_reason) > 500 THEN RAISE EXCEPTION 'Reason is too long (max 500 characters)'; END IF;
  IF p_method IS NOT NULL AND p_method NOT IN ('cash','card','mobile') THEN RAISE EXCEPTION 'Unknown payment method'; END IF;
  SELECT coalesce(sum(price*qty),0) INTO v_sub FROM public.sale_items WHERE sale_id = s.id;
  IF v_sub <= 0 THEN RAISE EXCEPTION 'Nothing to refund'; END IF;
  SELECT id INTO v_shift FROM public.cash_shifts WHERE store_id = s.store_id AND status = 'open';
  INSERT INTO public.refunds(business_id, store_id, sale_id, amount, method, reason, staff_id, shift_id)
    VALUES (s.business_id, s.store_id, s.id, 0, coalesce(p_method,'cash'), btrim(p_reason), me.id, v_shift) RETURNING id, number INTO r, rn;
  FOR x IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO it FROM public.sale_items WHERE id = (x->>'sale_item_id')::uuid AND sale_id = s.id FOR UPDATE;
    IF it.id IS NULL THEN RAISE EXCEPTION 'Item not on this sale'; END IF;
    q := (x->>'qty')::numeric;
    IF q IS NULL OR q <= 0 THEN CONTINUE; END IF;
    IF q > it.qty - it.refunded_qty THEN RAISE EXCEPTION 'Cannot return more % than was sold', it.name; END IF;
    SELECT coalesce(cost, 0) INTO v_unit FROM public.sale_item_costs WHERE sale_item_id = it.id;
    line := round(s.total * (it.price * q) / v_sub, 2);
    amt := amt + line;
    UPDATE public.sale_items SET refunded_qty = refunded_qty + q WHERE id = it.id;
    INSERT INTO public.refund_items(refund_id, sale_item_id, product_id, name, qty, amount, cost, restock)
      VALUES (r, it.id, it.product_id, it.name, q, line,
        CASE WHEN coalesce((x->>'restock')::boolean, true) THEN v_unit * q ELSE 0 END,
        coalesce((x->>'restock')::boolean, true));
    IF coalesce((x->>'restock')::boolean, true) AND it.product_id IS NOT NULL THEN
      cst := cst + v_unit * q;
      PERFORM app.set_ctx('refund_restock', r, p_reason);
      INSERT INTO public.store_stock(store_id, product_id, qty) VALUES (s.store_id, it.product_id, q)
        ON CONFLICT (store_id, product_id) DO UPDATE SET qty = public.store_stock.qty + excluded.qty;
      PERFORM app.set_ctx(NULL, NULL, NULL);
    END IF;
  END LOOP;
  IF amt <= 0 THEN RAISE EXCEPTION 'Nothing to refund'; END IF;
  SELECT coalesce(sum(qty - refunded_qty),0) INTO v_left FROM public.sale_items WHERE sale_id = s.id;
  IF v_left <= 0 OR s.refunded + amt > s.total THEN amt := s.total - s.refunded; END IF;
  IF amt <= 0 THEN RAISE EXCEPTION 'This sale is already fully refunded'; END IF;
  v_tax := CASE WHEN s.total > 0 THEN round(s.tax * amt / s.total, 2) ELSE 0 END;
  UPDATE public.refunds SET amount = amt, cost = cst, tax = v_tax WHERE id = r;
  UPDATE public.sales SET refunded = refunded + amt,
    status = CASE WHEN v_left <= 0 OR refunded + amt >= total - 0.01 THEN 'refunded' ELSE 'partially_refunded' END WHERE id = s.id;
  RETURN json_build_object('id', r, 'number', rn, 'amount', amt);
END $$;

-- ---------- 16. Adjustments, layby, expenses, collections, stock takes: input bounds ----------
CREATE OR REPLACE FUNCTION app.adjust_stock_reason(p_token uuid, p_store uuid, p_product uuid, p_delta numeric, p_reason text, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff; v_qty numeric;
BEGIN
  me := public.require_staff(p_token, array['admin','manager']);
  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store AND business_id = me.business_id) THEN RAISE EXCEPTION 'Unknown store'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product AND business_id = me.business_id) THEN RAISE EXCEPTION 'Unknown product'; END IF;
  IF p_reason NOT IN ('supplier_intake','damage','shrinkage','transfer_in','transfer_out','correction','return_to_supplier','adjustment') THEN
    RAISE EXCEPTION 'Unknown reason'; END IF;
  IF p_delta IS NULL OR p_delta = 0 OR p_delta NOT BETWEEN -1000000 AND 1000000 THEN
    RAISE EXCEPTION 'Enter an adjustment amount between 1 and 1,000,000'; END IF;
  IF coalesce(char_length(p_note),0) > 500 THEN RAISE EXCEPTION 'Note is too long (max 500 characters)'; END IF;
  SELECT coalesce(qty, 0) INTO v_qty FROM public.store_stock WHERE store_id = p_store AND product_id = p_product;
  IF v_qty + p_delta < 0 THEN RAISE EXCEPTION 'Only % in stock — cannot remove %', v_qty, abs(p_delta); END IF;
  PERFORM app.set_ctx(p_reason, NULL, p_note);
  INSERT INTO public.store_stock(store_id, product_id, qty) VALUES (p_store, p_product, p_delta)
    ON CONFLICT (store_id, product_id) DO UPDATE SET qty = public.store_stock.qty + excluded.qty;
  PERFORM app.set_ctx(NULL, NULL, NULL);
END $$;

CREATE OR REPLACE FUNCTION app.layby_pay(p_token uuid, p_sale uuid, p_amount numeric, p_method text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff; s public.sales; v_pay numeric;
BEGIN
  me := public.require_staff(p_token, array['admin','manager','cashier']);
  SELECT * INTO s FROM public.sales WHERE id = p_sale AND business_id = me.business_id FOR UPDATE;
  IF s.id IS NULL OR s.status <> 'layby_open' THEN RAISE EXCEPTION 'Layby is not open'; END IF;
  IF p_amount IS NOT NULL AND p_amount NOT BETWEEN 0 AND 10000000000 THEN RAISE EXCEPTION 'Amount must be between 0 and 10,000,000,000'; END IF;
  IF p_method IS NOT NULL AND p_method NOT IN ('cash','card','mobile') THEN RAISE EXCEPTION 'Unknown payment method'; END IF;
  v_pay := least(greatest(coalesce(p_amount, 0), 0), s.total - s.paid);
  IF v_pay <= 0 THEN RAISE EXCEPTION 'Enter an amount'; END IF;
  INSERT INTO public.payments(sale_id, amount, method, staff_id) VALUES (p_sale, v_pay, coalesce(p_method,'cash'), me.id);
  UPDATE public.sales SET paid = paid + v_pay, status = CASE WHEN paid + v_pay >= total THEN 'layby_completed' ELSE status END WHERE id = p_sale;
  RETURN (SELECT status FROM public.sales WHERE id = p_sale);
END $$;

CREATE OR REPLACE FUNCTION app.record_expense(p_token uuid, p_store uuid, p_amount numeric, p_category text, p_source text, p_note text, p_date date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff; r uuid;
BEGIN
  me := public.require_staff(p_token, array['admin','manager','cashier']);
  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store AND business_id = me.business_id) THEN RAISE EXCEPTION 'Unknown store'; END IF;
  IF me.role = 'cashier' AND me.store_id IS NOT NULL AND me.store_id <> p_store THEN RAISE EXCEPTION 'You are not assigned to this store'; END IF;
  IF p_amount IS NULL OR p_amount NOT BETWEEN 0.01 AND 1000000000 THEN RAISE EXCEPTION 'Enter a valid amount'; END IF;
  IF p_source IS NULL OR p_source NOT IN ('till','bank','mobile') THEN RAISE EXCEPTION 'Invalid source'; END IF;
  IF coalesce(char_length(p_note), 0) > 500 THEN RAISE EXCEPTION 'Note is too long (max 500 characters)'; END IF;
  IF coalesce(char_length(p_category), 0) > 60 THEN RAISE EXCEPTION 'Category is too long (max 60 characters)'; END IF;
  IF coalesce(p_category, p_note, '') ~ '[[:cntrl:]<>]' THEN RAISE EXCEPTION 'Text contains unsupported characters'; END IF;
  INSERT INTO public.expenses(business_id, store_id, amount, category, source, note, spent_on, created_by)
    VALUES (me.business_id, p_store, p_amount, coalesce(nullif(btrim(p_category),''),'Other'), p_source,
      nullif(btrim(coalesce(p_note,'')),''), coalesce(p_date, current_date), me.id)
    RETURNING id INTO r;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION app.save_collection(p_token uuid, p_id uuid, p_name text, p_discount numeric, p_shared boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff; r uuid;
BEGIN
  me := public.require_staff(p_token, array['admin','manager']);
  IF coalesce(btrim(p_name),'') = '' THEN RAISE EXCEPTION 'Name is required'; END IF;
  IF char_length(btrim(p_name)) > 120 THEN RAISE EXCEPTION 'Name is too long (max 120 characters)'; END IF;
  IF p_name ~ '[[:cntrl:]<>]' THEN RAISE EXCEPTION 'Name contains unsupported characters'; END IF;
  IF p_discount IS NOT NULL AND p_discount NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'Discount must be between 0 and 100 percent'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.collections(business_id, name, discount_pct, is_shared)
      VALUES (me.business_id, btrim(p_name), coalesce(p_discount, 0), coalesce(p_shared, true)) RETURNING id INTO r;
  ELSE
    UPDATE public.collections SET name = btrim(p_name), discount_pct = coalesce(p_discount, 0), is_shared = coalesce(p_shared, true)
      WHERE id = p_id AND business_id = me.business_id RETURNING id INTO r;
    IF r IS NULL THEN RAISE EXCEPTION 'Unknown collection'; END IF;
  END IF;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION app.count_stock(p_token uuid, p_take uuid, p_product uuid, p_counted numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff;
BEGIN
  me := public.require_staff(p_token, array['admin','manager','cashier']);
  IF p_counted IS NULL OR p_counted NOT BETWEEN 0 AND 100000000 THEN
    RAISE EXCEPTION 'Enter a counted quantity between 0 and 100,000,000'; END IF;
  UPDATE public.stock_take_lines l SET counted = p_counted, counted_by = me.id
   FROM public.stock_takes t WHERE t.id = l.stock_take_id AND t.id = p_take AND t.status = 'open'
     AND t.business_id = me.business_id AND l.product_id = p_product;
END $$;

CREATE OR REPLACE FUNCTION app.get_shared_collection(p_slug text) RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT json_build_object(
    'name', c.name, 'discount_pct', c.discount_pct, 'business', b.name, 'currency', b.currency,
    'items', coalesce((select json_agg(json_build_object('name', p.name, 'price', p.price, 'sale_price', public.effective_price(p.id)) order by p.name)
       from public.product_collections pc join public.products p on p.id = pc.product_id and p.active
       where pc.collection_id = c.id), '[]'::json))
  from public.collections c join public.businesses b on b.id = c.business_id
  where c.share_slug = btrim(coalesce(p_slug,'')) and c.is_shared
$$;

-- ---------- 17. Effective price (unchanged contract, cost-free products) ----------
CREATE OR REPLACE FUNCTION public.effective_price(p_product uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT round(p.price * (1 - least(100, greatest(0, coalesce((
    SELECT max(c.discount_pct) FROM public.product_collections pc JOIN public.collections c ON c.id = pc.collection_id
    WHERE pc.product_id = p.id), 0))) / 100), 2)
  FROM public.products p WHERE p.id = p_product
$$;

-- ---------- 18. Re-affirm the RPC surface: public wrappers plus app bodies ----------
-- The one new RPC the client calls needs its public wrapper.
CREATE OR REPLACE FUNCTION public.lock_all_sessions() RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$ SELECT app.lock_all_sessions() $$;

-- Grants: the share page is the only anon callable; staff checks stay internal.
DO $$
DECLARE f record;
  anon_allow text[] := array['get_shared_collection'];
  internal_only text[] := array['require_staff','require_staff_nosub','pin_taken','subscription_active','effective_price','_move_stock'];
BEGIN
  FOR f IN
    SELECT n.nspname AS sch, p.proname AS fn, pg_get_function_identity_arguments(p.oid) AS idargs
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public','app') AND p.prokind = 'f'
      AND p.proname <> ALL (array['my_business_id','session_role','set_ctx','shift_summary','rls_auto_enable','on_business_created','log_stock_movement','complete_subscription_payment'])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I(%s) FROM public, anon, authenticated', f.sch, f.fn, f.idargs);
    IF f.fn = ANY (anon_allow) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO anon, authenticated, service_role', f.sch, f.fn, f.idargs);
    ELSIF NOT (f.fn = ANY (internal_only)) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO authenticated, service_role', f.sch, f.fn, f.idargs);
    ELSE
      EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO service_role', f.sch, f.fn, f.idargs);
    END IF;
  END LOOP;
END $$;

-- ---------- 19. Tables stay read-only for clients: every write goes through an RPC ----------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM authenticated, anon, public', r.relname);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', r.relname);
  END LOOP;
  REVOKE ALL ON public.pin_throttle, public.product_costs, public.sale_item_costs FROM anon, public;
END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM authenticated, anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO authenticated;

NOTIFY pgrst, 'reload schema';

-- --- from 20261009192705_c04f3a80-e05e-498f-ab87-694d79f3fe3f.sql ---------------
CREATE INDEX IF NOT EXISTS sales_store_created_idx ON public.sales (store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sales_business_created_idx ON public.sales (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sales_store_status_idx ON public.sales (store_id, status);
CREATE INDEX IF NOT EXISTS sale_items_sale_idx ON public.sale_items (sale_id);
CREATE INDEX IF NOT EXISTS sale_items_product_idx ON public.sale_items (product_id);
CREATE INDEX IF NOT EXISTS payments_sale_idx ON public.payments (sale_id);
CREATE INDEX IF NOT EXISTS refunds_sale_idx ON public.refunds (sale_id);
CREATE INDEX IF NOT EXISTS refunds_store_created_idx ON public.refunds (store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS refunds_business_created_idx ON public.refunds (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS refund_items_refund_idx ON public.refund_items (refund_id);
CREATE INDEX IF NOT EXISTS expenses_store_spent_idx ON public.expenses (store_id, spent_on DESC);
CREATE INDEX IF NOT EXISTS expenses_business_spent_idx ON public.expenses (business_id, spent_on DESC);
CREATE INDEX IF NOT EXISTS products_business_name_idx ON public.products (business_id, name);
CREATE INDEX IF NOT EXISTS products_business_sku_idx ON public.products (business_id, sku) WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS product_collections_product_idx ON public.product_collections (product_id);
CREATE INDEX IF NOT EXISTS collections_business_idx ON public.collections (business_id);
CREATE INDEX IF NOT EXISTS stores_business_idx ON public.stores (business_id, created_at);
CREATE INDEX IF NOT EXISTS staff_business_idx ON public.staff (business_id);
CREATE INDEX IF NOT EXISTS store_stock_product_idx ON public.store_stock (product_id);
CREATE INDEX IF NOT EXISTS stock_takes_store_created_idx ON public.stock_takes (store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cash_shifts_store_opened_idx ON public.cash_shifts (store_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS cash_movements_shift_idx ON public.cash_movements (shift_id);
CREATE INDEX IF NOT EXISTS subscription_payments_business_idx ON public.subscription_payments (business_id, created_at DESC);

-- --- from 20261009193153_97dc4c9b-c64d-4f55-9cfe-e17b97fb71ec.sql ---------------
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS client_ref uuid;
CREATE UNIQUE INDEX IF NOT EXISTS sales_client_ref_key ON public.sales (client_ref) WHERE client_ref IS NOT NULL;

CREATE OR REPLACE FUNCTION app.checkout_ref(p_token uuid, p_client_ref uuid, p_store uuid, p_kind text, p_items jsonb, p_payment numeric, p_method text, p_customer_name text, p_customer_phone text, p_note text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE me public.staff; s public.sales; r json;
BEGIN
  me := public.require_staff(p_token, array['admin','manager','cashier']);
  IF p_client_ref IS NULL THEN RAISE EXCEPTION 'Missing sale reference'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_client_ref::text));
  SELECT * INTO s FROM public.sales WHERE client_ref = p_client_ref;
  IF s.id IS NOT NULL THEN
    IF s.business_id <> me.business_id THEN RAISE EXCEPTION 'Sale reference already used'; END IF;
    RETURN json_build_object('id', s.id, 'number', s.number, 'status', s.status, 'total', s.total, 'tax', s.tax, 'duplicate', true);
  END IF;
  r := app.checkout(p_token, p_store, p_kind, p_items, p_payment, p_method, p_customer_name, p_customer_phone, p_note);
  UPDATE public.sales SET client_ref = p_client_ref WHERE id = (r->>'id')::uuid;
  RETURN r;
END $function$;
REVOKE ALL ON FUNCTION app.checkout_ref(uuid,uuid,uuid,text,jsonb,numeric,text,text,text,text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.checkout_ref(p_token uuid, p_client_ref uuid, p_store uuid, p_kind text, p_items jsonb, p_payment numeric, p_method text, p_customer_name text, p_customer_phone text, p_note text)
 RETURNS json LANGUAGE sql SET search_path TO 'public'
AS $function$ SELECT app.checkout_ref($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) $function$;
REVOKE ALL ON FUNCTION public.checkout_ref(uuid,uuid,uuid,text,jsonb,numeric,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.checkout_ref(uuid,uuid,uuid,text,jsonb,numeric,text,text,text,text) TO authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.role_routine_grants WHERE routine_schema='app' AND routine_name='checkout' AND grantee='authenticated') THEN
    GRANT EXECUTE ON FUNCTION app.checkout_ref(uuid,uuid,uuid,text,jsonb,numeric,text,text,text,text) TO authenticated;
  END IF;
END $$;

