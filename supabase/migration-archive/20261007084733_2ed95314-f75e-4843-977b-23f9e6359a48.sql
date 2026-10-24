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
