-- Malawi payment methods + MWK default.
--
-- A business now owns the list of payment methods it accepts. Cash is always
-- accepted; every other code comes from the app catalogue (the six Malawian
-- banks plus Airtel Money and Mpamba). The list is tenant data, not a client
-- constant, so a sale, a layby payment, an invoice approval, a refund or an
-- expense records the real place the money went.
--
-- Existing businesses are seeded with cash/card/mobile so a till that is still
-- running yesterday's bundle keeps selling. Card and mobile stay readable and
-- valid for those tenants but are not offered to new businesses.

-- ---------------------------------------------------------------------------
-- 1. Tenant payment methods
-- ---------------------------------------------------------------------------
create table if not exists public.business_payment_methods (
  business_id uuid not null references public.businesses(id) on delete cascade,
  code text not null,
  created_at timestamptz not null default now(),
  primary key (business_id, code)
);

alter table public.business_payment_methods enable row level security;

drop policy if exists "own payment methods" on public.business_payment_methods;
create policy "own payment methods" on public.business_payment_methods
  for select to authenticated
  using (business_id = app.my_business_id());

-- Reads only: every write goes through app.save_business_settings.
revoke all on public.business_payment_methods from anon, authenticated;
grant select on public.business_payment_methods to authenticated;

-- Grandfather every existing tenant onto the methods its tills already send.
insert into public.business_payment_methods(business_id, code)
select b.id, v.code
  from public.businesses b
 cross join (values ('cash'), ('card'), ('mobile')) as v(code)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Catalogue + guard
-- ---------------------------------------------------------------------------
create or replace function app.payment_method_catalog()
returns text[]
language sql
immutable
set search_path to 'public'
as $$
  select array[
    'cash',
    'national_bank',
    'standard_bank',
    'fdh',
    'fcb',
    'nbs',
    'ecobank',
    'airtel_money',
    'mpamba'
  ]::text[]
$$;

create or replace function app.payment_method_allowed(p_business uuid, p_code text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when p_business is null or p_code is null then false
    -- Cash is the one method every business must accept.
    when lower(btrim(p_code)) = 'cash' then true
    else exists (
      select 1
        from public.business_payment_methods m
       where m.business_id = p_business
         and m.code = lower(btrim(p_code))
    )
  end
$$;

-- Server-side helpers only; the browser carries its own static catalogue.
revoke all on function app.payment_method_catalog() from public, anon, authenticated;
revoke all on function app.payment_method_allowed(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Expenses: the drawer is 'cash' now
-- ---------------------------------------------------------------------------
update public.expenses set source = 'cash' where source = 'till';

-- ---------------------------------------------------------------------------
-- 4. Patch the RPCs that still hard-code cash/card/mobile
-- ---------------------------------------------------------------------------
do $patch$
declare
  r record;
  v_def text;
  v_new text;
  v_hits int;
begin
  for r in
    select * from (values
      (
        'checkout',
        'IF p_method IS NOT NULL AND p_method NOT IN (''cash'',''card'',''mobile'') THEN RAISE EXCEPTION ''Unknown payment method''; END IF;',
        'IF p_method IS NOT NULL AND NOT app.payment_method_allowed(me.business_id, p_method) THEN RAISE EXCEPTION ''Unknown payment method''; END IF;',
        1
      ),
      (
        'checkout',
        'OR coalesce(t->>''method'','''') NOT IN (''cash'',''card'',''mobile'')',
        'OR NOT app.payment_method_allowed(me.business_id, coalesce(t->>''method'',''''))',
        1
      ),
      (
        'review_invoice',
        'IF p_method IS NOT NULL AND p_method NOT IN (''cash'',''card'',''mobile'') THEN RAISE EXCEPTION ''Unknown payment method''; END IF;',
        'IF p_method IS NOT NULL AND NOT app.payment_method_allowed(me.business_id, p_method) THEN RAISE EXCEPTION ''Unknown payment method''; END IF;',
        1
      ),
      (
        'review_invoice',
        'OR coalesce(t->>''method'','''') NOT IN (''cash'',''card'',''mobile'')',
        'OR NOT app.payment_method_allowed(me.business_id, coalesce(t->>''method'',''''))',
        1
      ),
      (
        'layby_pay',
        'IF p_method IS NOT NULL AND p_method NOT IN (''cash'',''card'',''mobile'') THEN RAISE EXCEPTION ''Unknown payment method''; END IF;',
        'IF p_method IS NOT NULL AND NOT app.payment_method_allowed(me.business_id, p_method) THEN RAISE EXCEPTION ''Unknown payment method''; END IF;',
        1
      ),
      (
        'process_refund',
        'IF p_method IS NOT NULL AND p_method NOT IN (''cash'',''card'',''mobile'') THEN RAISE EXCEPTION ''Unknown payment method''; END IF;',
        'IF p_method IS NOT NULL AND NOT app.payment_method_allowed(me.business_id, p_method) THEN RAISE EXCEPTION ''Unknown payment method''; END IF;',
        1
      ),
      (
        'record_expense',
        'IF p_source IS NULL OR p_source NOT IN (''till'',''bank'',''mobile'') THEN RAISE EXCEPTION ''Invalid source''; END IF;',
        'IF p_source = ''till'' THEN p_source := ''cash''; END IF;
  IF p_source IS NULL OR (p_source NOT IN (''bank'',''mobile'') AND NOT app.payment_method_allowed(me.business_id, p_source)) THEN RAISE EXCEPTION ''Invalid source''; END IF;',
        1
      ),
      (
        'shift_summary',
        'WHERE store_id = s.store_id AND source = ''till'' AND created_at >= s.opened_at AND created_at <= v_end;',
        'WHERE store_id = s.store_id AND source IN (''cash'',''till'') AND created_at >= s.opened_at AND created_at <= v_end;',
        1
      )
    ) as t(fn, old_snip, new_snip, need)
  loop
    v_def := null;
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname = r.fn;

    if v_def is null then
      raise exception 'app.% not found', r.fn;
    end if;

    v_hits := (char_length(v_def) - char_length(replace(v_def, r.old_snip, ''))) / char_length(r.old_snip);
    if v_hits <> r.need then
      raise exception 'app.%: expected % match(es), found %', r.fn, r.need, v_hits;
    end if;

    v_new := replace(v_def, r.old_snip, r.new_snip);
    execute v_new;
  end loop;
end
$patch$;

-- ---------------------------------------------------------------------------
-- 5. Currency default + onboarding that captures the methods
-- ---------------------------------------------------------------------------
alter table public.businesses alter column currency set default 'MWK';

-- The 7th argument is optional so an old bundle that still sends six arguments
-- keeps working and simply lands on cash-only.
drop function if exists public.setup_business(text, text, text, text, text, text);
drop function if exists app.setup_business(text, text, text, text, text, text);

create or replace function app.setup_business(
  p_name text,
  p_currency text,
  p_store_name text,
  p_store_type text,
  p_owner_name text,
  p_pin text,
  p_payment_methods text[] default null
) returns uuid
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  b uuid;
  s uuid;
  v_methods text[];
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if exists (select 1 from public.businesses where owner_id = auth.uid()) then raise exception 'Business already set up'; end if;
  if p_name is null or btrim(p_name) = '' then raise exception 'Enter a business name'; end if;
  if char_length(btrim(p_name)) > 200 then raise exception 'Business name is too long (max 200 characters)'; end if;
  if p_store_name is null or btrim(p_store_name) = '' then raise exception 'Enter a store name'; end if;
  if char_length(btrim(p_store_name)) > 120 then raise exception 'Store name is too long (max 120 characters)'; end if;
  if p_owner_name is null or btrim(p_owner_name) = '' then raise exception 'Enter your name'; end if;
  if char_length(btrim(p_owner_name)) > 100 then raise exception 'Name is too long (max 100 characters)'; end if;
  if p_store_type is null or p_store_type not in ('direct', 'approval') then raise exception 'Choose a store type'; end if;
  if p_currency is not null and btrim(p_currency) <> '' and char_length(btrim(p_currency)) > 4 then raise exception 'Currency symbol is too long'; end if;
  if p_currency is not null and btrim(p_currency) ~ '[[:cntrl:]<>]' then raise exception 'Currency contains unsupported characters'; end if;
  if p_pin is null or p_pin !~ '^[0-9]{4,8}$' then raise exception 'PIN must be 4 to 8 digits'; end if;

  -- Cash is always accepted; anything else must be a catalogue code.
  select array_agg(distinct lower(btrim(x)))
    into v_methods
    from unnest(coalesce(p_payment_methods, array[]::text[])) as u(x)
   where x is not null and btrim(x) <> '';
  if v_methods is null then v_methods := array['cash']; end if;
  if exists (select 1 from unnest(v_methods) as u(code) where code <> all(app.payment_method_catalog())) then
    raise exception 'Unknown payment method';
  end if;
  if not ('cash' = any(v_methods)) then v_methods := array_prepend('cash', v_methods); end if;

  insert into public.businesses(owner_id, name, currency)
    values (auth.uid(), btrim(p_name), coalesce(nullif(upper(btrim(p_currency)), ''), 'MWK'))
    returning id into b;
  insert into public.stores(business_id, name, store_type) values (b, btrim(p_store_name), p_store_type) returning id into s;
  insert into public.staff(business_id, name, role, pin_hash, permissions, is_owner)
    values (b, btrim(p_owner_name), 'admin',
            extensions.crypt(p_pin, extensions.gen_salt('bf', 10)),
            app.all_permissions(), true);
  insert into public.business_payment_methods(business_id, code)
    select b, code from unnest(v_methods) as u(code)
    on conflict do nothing;
  return b;
end
$function$;

create or replace function public.setup_business(
  p_name text,
  p_currency text,
  p_store_name text,
  p_store_type text,
  p_owner_name text,
  p_pin text,
  p_payment_methods text[] default null
) returns uuid
language sql
set search_path to 'public'
as $function$
  select app.setup_business($1, $2, $3, $4, $5, $6, $7)
$function$;

grant execute on function app.setup_business(text, text, text, text, text, text, text[]) to authenticated, service_role;
grant execute on function public.setup_business(text, text, text, text, text, text, text[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Business settings (currency + accepted methods)
-- ---------------------------------------------------------------------------
create or replace function app.save_business_settings(
  p_token uuid,
  p_currency text,
  p_methods text[]
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  me public.staff;
  v_currency text;
  v_methods text[];
  v_existing text[];
begin
  me := app.require_perm(p_token, '{money}'::text[]);

  if p_currency is null or btrim(p_currency) = '' then raise exception 'Choose a currency'; end if;
  v_currency := upper(btrim(p_currency));
  if char_length(v_currency) > 4 then raise exception 'Currency symbol is too long'; end if;
  if v_currency ~ '[^A-Z]' then raise exception 'Use letters only for the currency code'; end if;
  -- Historical amounts are never converted, so only the owner moves the unit.
  if not me.is_owner and v_currency <> (select currency from public.businesses where id = me.business_id) then
    raise exception 'Only the owner can change the currency';
  end if;

  select array_agg(distinct lower(btrim(x)))
    into v_methods
    from unnest(coalesce(p_methods, array[]::text[])) as u(x)
   where x is not null and btrim(x) <> '';
  if v_methods is null then raise exception 'Choose at least one payment method'; end if;

  select array_agg(code) into v_existing
    from public.business_payment_methods
   where business_id = me.business_id;

  -- New codes must come from the catalogue; legacy card/mobile may be kept or
  -- removed by an existing tenant but never added back.
  if exists (
    select 1
      from unnest(v_methods) as u(code)
     where code <> all(app.payment_method_catalog())
       and code <> all(coalesce(v_existing, array[]::text[]))
  ) then
    raise exception 'Unknown payment method';
  end if;

  if not ('cash' = any(v_methods)) then v_methods := array_prepend('cash', v_methods); end if;

  update public.businesses
     set currency = v_currency,
         updated_at = now()
   where id = me.business_id;

  delete from public.business_payment_methods
   where business_id = me.business_id
     and code <> all(v_methods);

  insert into public.business_payment_methods(business_id, code)
    select me.business_id, code from unnest(v_methods) as u(code)
    on conflict do nothing;
end
$function$;

create or replace function public.save_business_settings(
  p_token uuid,
  p_currency text,
  p_methods text[]
) returns void
language sql
set search_path to 'public'
as $function$
  select app.save_business_settings($1, $2, $3)
$function$;

grant execute on function app.save_business_settings(uuid, text, text[]) to authenticated, service_role;
grant execute on function public.save_business_settings(uuid, text, text[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Assertions
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_missing int;
  v_till int;
  v_def text;
begin
  select count(*) into v_missing
    from public.businesses b
   where not exists (
     select 1 from public.business_payment_methods m
      where m.business_id = b.id and m.code = 'cash'
   );
  if v_missing > 0 then
    raise exception 'verification failed: % business(es) without cash', v_missing;
  end if;

  select count(*) into v_till from public.expenses where source = 'till';
  if v_till > 0 then
    raise exception 'verification failed: % expense(s) still on the till label', v_till;
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'checkout';
  if v_def like '%''cash'',''card'',''mobile''%' then
    raise exception 'verification failed: checkout still hard-codes the old methods';
  end if;
end
$verify$;

notify pgrst, 'reload schema';
