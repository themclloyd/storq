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