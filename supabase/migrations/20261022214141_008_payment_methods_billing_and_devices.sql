-- ============================================================================
-- 008 - Payment methods, billing lifecycle and device-scoped reads
--
-- Squashed baseline. This file is the ordered, verbatim concatenation of the
-- migrations listed below. Replaying it on an empty database produces the same
-- schema those files produced one at a time, in this exact order. Every
-- original is kept unedited in supabase/migration-archive/ for provenance.
--
--   20261022214141  payment_methods_and_currency
--   20261022220137  store_payment_methods
--   20261024174223  store_payment_methods_policy_authenticated
--   20261023221127  device_scoped_reads
--   20261023221328  billing_and_account_lifecycle
--   20261023221440  offline_sale_time
--   20261023223042  device_management_and_rpc_grants
--   20261023223055  ops_payment_verification
--
-- Folded forward: 20261024174223_store_payment_methods_policy_authenticated ran later, but it only tightens the policy created by 20261022220137_store_payment_methods, so it sits directly beside it here. Nothing between the two touched that policy.
-- ============================================================================

-- --- from 20261022214141_payment_methods_and_currency.sql -----------------------
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

-- --- from 20261022220137_store_payment_methods.sql ------------------------------
-- Payment methods become a property of the location, not the business: a branch
-- without a bank account or a wallet float must not offer that method, and the
-- money ledger must stay truthful per till. Every write is checked against the
-- store the money lands in; cash is always accepted server-side.

-- ── 1. Per-location table ────────────────────────────────────────────────────
create table if not exists public.store_payment_methods (
  store_id uuid not null references public.stores(id) on delete cascade,
  code text not null,
  created_at timestamptz not null default now(),
  primary key (store_id, code)
);

alter table public.store_payment_methods enable row level security;

drop policy if exists "own store payment methods" on public.store_payment_methods;
create policy "own store payment methods" on public.store_payment_methods
  for select using (
    exists (
      select 1 from public.stores s
       where s.id = store_payment_methods.store_id
         and s.business_id = app.my_business_id()
    )
  );

revoke all on public.store_payment_methods from anon, authenticated;
grant select on public.store_payment_methods to authenticated;

-- ── 2. Backfill: every location inherits what its business offered ───────────
insert into public.store_payment_methods(store_id, code)
select st.id, m.code
  from public.stores st
  join public.business_payment_methods m on m.business_id = st.business_id
on conflict do nothing;

insert into public.store_payment_methods(store_id, code)
select st.id, 'cash'
  from public.stores st
 where not exists (select 1 from public.store_payment_methods m where m.store_id = st.id)
on conflict do nothing;

-- ── 3. Store-aware guard (same signature, new meaning) ───────────────────────
-- The parameter changes name, which CREATE OR REPLACE refuses; dropping is safe
-- because every caller is PL/pgSQL and is repointed below in the same run.
drop function if exists app.payment_method_allowed(uuid, text);

create or replace function app.payment_method_allowed(p_store uuid, p_code text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v_code text;
begin
  v_code := lower(btrim(coalesce(p_code, '')));
  if v_code = '' then return false; end if;
  -- Cash never disappears: a till must always be able to take money.
  if v_code = 'cash' then return true; end if;
  return exists (
    select 1 from public.store_payment_methods m
     where m.store_id = p_store and m.code = v_code
  );
end $function$;

revoke all on function app.payment_method_allowed(uuid, text) from public, anon, authenticated;

-- ── 4. Point every money path at the store it lands in ───────────────────────
do $patch$
declare
  v_def text;
  v_new text;
  v_needle text;
  v_hits int;
begin
  -- checkout: the till's own store.
  v_needle := 'app.payment_method_allowed(me.business_id,';
  select pg_get_functiondef(
    'app.checkout(uuid,uuid,text,jsonb,numeric,text,text,text,text,jsonb,jsonb,text)'::regprocedure
  ) into v_def;
  v_hits := (length(v_def) - length(replace(v_def, v_needle, ''))) / length(v_needle);
  if v_hits <> 2 then raise exception 'checkout: expected 2 method guards, found %', v_hits; end if;
  v_new := replace(v_def, v_needle, 'app.payment_method_allowed(p_store,');
  execute v_new;

  -- invoice approval: the invoice's store.
  select pg_get_functiondef(
    'app.review_invoice(uuid,uuid,boolean,numeric,text,jsonb)'::regprocedure
  ) into v_def;
  v_hits := (length(v_def) - length(replace(v_def, v_needle, ''))) / length(v_needle);
  if v_hits <> 2 then raise exception 'review_invoice: expected 2 method guards, found %', v_hits; end if;
  v_new := replace(v_def, v_needle, 'app.payment_method_allowed(s.store_id,');
  execute v_new;

  -- layby payments: the layby's store.
  select pg_get_functiondef(
    'app.layby_pay(uuid,uuid,numeric,text)'::regprocedure
  ) into v_def;
  v_hits := (length(v_def) - length(replace(v_def, v_needle, ''))) / length(v_needle);
  if v_hits <> 1 then raise exception 'layby_pay: expected 1 method guard, found %', v_hits; end if;
  v_new := replace(v_def, v_needle, 'app.payment_method_allowed(s.store_id,');
  execute v_new;

  -- refunds: the store that sold the goods.
  select pg_get_functiondef(
    'app.process_refund(uuid,uuid,jsonb,text,text)'::regprocedure
  ) into v_def;
  v_hits := (length(v_def) - length(replace(v_def, v_needle, ''))) / length(v_needle);
  if v_hits <> 1 then raise exception 'process_refund: expected 1 method guard, found %', v_hits; end if;
  v_new := replace(v_def, v_needle, 'app.payment_method_allowed(s.store_id,');
  execute v_new;

  -- expenses: the store that spent the money. Generic 'bank'/'mobile' codes no
  -- longer stand in for a real method, so cash flow per location stays readable.
  select pg_get_functiondef(
    'app.record_expense(uuid,uuid,numeric,text,text,text,date)'::regprocedure
  ) into v_def;
  v_needle := 'IF p_source IS NULL OR (p_source NOT IN (''bank'',''mobile'') AND NOT app.payment_method_allowed(me.business_id, p_source)) THEN RAISE EXCEPTION ''Invalid source''; END IF;';
  v_hits := (length(v_def) - length(replace(v_def, v_needle, ''))) / length(v_needle);
  if v_hits <> 1 then raise exception 'record_expense: expected 1 source guard, found %', v_hits; end if;
  v_new := replace(
    v_def,
    v_needle,
    'IF p_source IS NULL OR NOT app.payment_method_allowed(p_store, p_source) THEN RAISE EXCEPTION ''Invalid source''; END IF;'
  );
  execute v_new;
end $patch$;

-- ── 5. Onboarding seeds the first location, not the business ─────────────────
do $patch$
declare
  v_def text;
  v_new text;
  v_needle text := 'insert into public.business_payment_methods(business_id, code)
    select b, code from unnest(v_methods) as u(code)
    on conflict do nothing;';
begin
  select pg_get_functiondef(
    'app.setup_business(text,text,text,text,text,text,text[])'::regprocedure
  ) into v_def;
  if position(v_needle in v_def) = 0 then
    raise exception 'setup_business: methods insert not found';
  end if;
  v_new := replace(
    v_def,
    v_needle,
    'insert into public.store_payment_methods(store_id, code)
    select s, code from unnest(v_methods) as u(code)
    on conflict do nothing;'
  );
  execute v_new;
end $patch$;

-- ── 6. save_store owns the location's method list ────────────────────────────
drop function if exists public.save_store(uuid, uuid, text, text, text, text, text, text, numeric, boolean);
drop function if exists app.save_store(uuid, uuid, text, text, text, text, text, text, numeric, boolean);

create function app.save_store(
  p_token uuid,
  p_id uuid,
  p_name text,
  p_type text,
  p_phone text default null,
  p_email text default null,
  p_address text default null,
  p_tax_number text default null,
  p_tax_rate numeric default null,
  p_tax_inclusive boolean default null,
  p_payment_methods text[] default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  me public.staff; s public.subscriptions; n integer; r uuid;
  v_phone text; v_email text; v_address text; v_taxno text; v_rate numeric; v_incl boolean;
  v_methods text[];
begin
  me := app.require_perm(p_token, '{locations}'::text[]);
  if p_name is null or btrim(p_name) = '' then raise exception 'Enter a store name'; end if;
  if char_length(btrim(p_name)) > 120 then raise exception 'Store name is too long (max 120 characters)'; end if;
  if btrim(p_name) ~ '[[:cntrl:]<>]' then raise exception 'Store name contains unsupported characters'; end if;
  if p_type is null or p_type not in ('direct','approval') then raise exception 'Choose a store type'; end if;

  v_phone := nullif(btrim(coalesce(p_phone, '')), '');
  if v_phone is not null and (char_length(v_phone) > 32 or v_phone !~ '^[+0-9()\- ]{6,32}$') then
    raise exception 'Phone number must be 6-32 characters of digits, + ( ) - and spaces';
  end if;
  v_email := nullif(btrim(coalesce(p_email, '')), '');
  if v_email is not null and (
       char_length(v_email) > 254
       or v_email !~* '^[a-z0-9_%+-]+(\.[a-z0-9_%+-]+)*@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
     ) then
    raise exception 'Enter a valid email address';
  end if;
  v_address := nullif(btrim(coalesce(p_address, '')), '');
  if v_address is not null and char_length(v_address) > 240 then
    raise exception 'Location is too long (max 240 characters)';
  end if;
  v_taxno := nullif(btrim(coalesce(p_tax_number, '')), '');
  if v_taxno is not null and char_length(v_taxno) > 40 then
    raise exception 'VAT number is too long (max 40 characters)';
  end if;
  if (v_email is not null and v_email ~ '[[:cntrl:]<>]')
     or (v_address is not null and v_address ~ '[[:cntrl:]<>]')
     or (v_taxno is not null and v_taxno ~ '[[:cntrl:]<>]') then
    raise exception 'Location details contain unsupported characters';
  end if;

  -- Methods are the ways this location banks money: catalogue codes only, plus
  -- any retired code the location already carried (kept or dropped, never new).
  if p_payment_methods is not null then
    select array_agg(distinct lower(btrim(x))) into v_methods
      from unnest(p_payment_methods) as u(x)
     where x is not null and btrim(x) <> '';
    if v_methods is null then raise exception 'Choose at least one payment method'; end if;
    if exists (
      select 1 from unnest(v_methods) as u(code)
       where code <> all(app.payment_method_catalog())
         and not exists (
           select 1 from public.store_payment_methods m
            where m.store_id = p_id and m.code = u.code
         )
    ) then
      raise exception 'Unknown payment method';
    end if;
    if not ('cash' = any(v_methods)) then v_methods := array_prepend('cash', v_methods); end if;
  end if;

  select * into s from public.subscriptions where business_id = me.business_id for update;
  if not found then raise exception 'Subscription missing: open Billing'; end if;

  if p_id is null then
    select count(*) into n from public.stores where business_id = me.business_id;
    if s.paid_until > now() then
      if n >= s.paid_store_limit then raise exception 'All paid store slots are in use. Pay for additional capacity on Billing before adding a store'; end if;
    elsif s.trial_ends_at <= now() then
      raise exception 'Subscription expired: open Billing';
    elsif n >= 1 then
      raise exception 'The free trial covers one store. Pay on Billing to add more stores';
    end if;
    select tax_rate, tax_inclusive into v_rate, v_incl from public.businesses where id = me.business_id;
    if p_tax_rate is not null then v_rate := p_tax_rate; end if;
    v_incl := coalesce(p_tax_inclusive, v_incl, true);
    if v_rate is null or v_rate not between 0 and 50 then
      raise exception 'Tax rate must be between 0 and 50 percent';
    end if;
    insert into public.stores(business_id, name, store_type, phone, email, address, tax_number, tax_rate, tax_inclusive)
      values (me.business_id, btrim(p_name), p_type, v_phone, v_email, v_address, v_taxno, v_rate, v_incl)
      returning id into r;
  else
    if p_tax_rate is not null and (p_tax_rate < 0 or p_tax_rate > 50) then
      raise exception 'Tax rate must be between 0 and 50 percent';
    end if;
    update public.stores
       set name = btrim(p_name), store_type = p_type, phone = v_phone, email = v_email,
           address = v_address, tax_number = v_taxno,
           tax_rate = coalesce(p_tax_rate, tax_rate),
           tax_inclusive = coalesce(p_tax_inclusive, tax_inclusive)
     where id = p_id and business_id = me.business_id
     returning id into r;
    if r is null then raise exception 'Store not found'; end if;
  end if;

  if v_methods is not null then
    delete from public.store_payment_methods where store_id = r and code <> all(v_methods);
    insert into public.store_payment_methods(store_id, code)
      select r, code from unnest(v_methods) as u(code)
      on conflict do nothing;
  elsif p_id is null then
    -- A brand-new location with no list still has to be able to sell for cash.
    insert into public.store_payment_methods(store_id, code) values (r, 'cash')
      on conflict do nothing;
  end if;

  return r;
end $function$;

create function public.save_store(
  p_token uuid,
  p_id uuid,
  p_name text,
  p_type text,
  p_phone text default null,
  p_email text default null,
  p_address text default null,
  p_tax_number text default null,
  p_tax_rate numeric default null,
  p_tax_inclusive boolean default null,
  p_payment_methods text[] default null
) returns uuid
language sql
set search_path to 'public'
as $function$ select app.save_store($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) $function$;

revoke all on function app.save_store(uuid, uuid, text, text, text, text, text, text, numeric, boolean, text[]) from public, anon;
grant execute on function app.save_store(uuid, uuid, text, text, text, text, text, text, numeric, boolean, text[]) to authenticated;
revoke all on function public.save_store(uuid, uuid, text, text, text, text, text, text, numeric, boolean, text[]) from public, anon;
grant execute on function public.save_store(uuid, uuid, text, text, text, text, text, text, numeric, boolean, text[]) to authenticated;

-- ── 7. Business settings shrink back to currency ─────────────────────────────
drop function if exists public.save_business_settings(uuid, text, text[]);
drop function if exists app.save_business_settings(uuid, text, text[]);

create function app.save_business_settings(p_token uuid, p_currency text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare me public.staff; v_currency text;
begin
  me := app.require_perm(p_token, '{money}'::text[]);
  -- History is never converted, so the unit of money stays the owner's call.
  if not me.is_owner then raise exception 'Only the owner can change the currency'; end if;
  v_currency := coalesce(nullif(upper(btrim(p_currency)), ''), 'MWK');
  if v_currency !~ '^[A-Z]{1,4}$' then raise exception 'Currency must be 1 to 4 letters'; end if;
  update public.businesses set currency = v_currency where id = me.business_id;
  return v_currency;
end $function$;

create function public.save_business_settings(p_token uuid, p_currency text)
returns text
language sql
set search_path to 'public'
as $function$ select app.save_business_settings($1,$2) $function$;

revoke all on function app.save_business_settings(uuid, text) from public, anon;
grant execute on function app.save_business_settings(uuid, text) to authenticated;
revoke all on function public.save_business_settings(uuid, text) from public, anon;
grant execute on function public.save_business_settings(uuid, text) to authenticated;

-- ── 8. The business-wide list is gone; locations now own the truth ───────────
drop table if exists public.business_payment_methods;

-- ── 9. Assertions ────────────────────────────────────────────────────────────
do $check$
declare v_bad int;
begin
  select count(*) into v_bad
    from public.stores st
   where not exists (
     select 1 from public.store_payment_methods m
      where m.store_id = st.id and m.code = 'cash'
   );
  if v_bad > 0 then raise exception '% stores without a cash method', v_bad; end if;

  select count(*) into v_bad
    from public.store_payment_methods
   where code <> all(app.payment_method_catalog())
     and code not in ('card','mobile');
  if v_bad > 0 then raise exception '% unknown method rows', v_bad; end if;

  if position(
       'payment_method_allowed(p_store'
       in pg_get_functiondef('app.checkout(uuid,uuid,text,jsonb,numeric,text,text,text,text,jsonb,jsonb,text)'::regprocedure)
     ) = 0 then
    raise exception 'checkout still guards methods at business level';
  end if;

  if position(
       'payment_method_allowed(p_store'
       in pg_get_functiondef('app.record_expense(uuid,uuid,numeric,text,text,text,date)'::regprocedure)
     ) = 0 then
    raise exception 'record_expense still guards methods at business level';
  end if;

  if exists (
    select 1 from pg_proc p
     where p.pronamespace in ('app'::regnamespace, 'public'::regnamespace)
       and p.proname in ('checkout','review_invoice','layby_pay','process_refund','record_expense',
                         'setup_business','save_business_settings','save_store','payment_method_allowed')
       and pg_get_functiondef(p.oid) like '%business_payment_methods%'
  ) then
    raise exception 'a money function still references business_payment_methods';
  end if;
end $check$;

notify pgrst, 'reload schema';

-- --- from 20261024174223_store_payment_methods_policy_authenticated.sql ---------
-- `store_payment_methods` was the only tenant table whose read policy was granted
-- to `public` instead of `authenticated`. The qual is tenant-scoped, so an
-- anonymous caller matched no rows — but that safety was coming from the qual, not
-- from the policy, and every other table gets its rows only from a signed-in
-- session. Tightening the role makes that the rule rather than a consequence.

ALTER POLICY "own store payment methods" ON public.store_payment_methods TO authenticated;

DO $$
DECLARE r text;
BEGIN
  SELECT coalesce(array_to_string(array(
           SELECT rolname FROM pg_roles WHERE oid = ANY(pol.polroles)), ','), '')
    INTO r
    FROM pg_policy pol
   WHERE pol.polrelid = 'public.store_payment_methods'::regclass;

  IF r <> 'authenticated' THEN
    RAISE EXCEPTION 'store_payment_methods read policy still applies to %', coalesce(nullif(r, ''), 'public');
  END IF;
END $$;

-- --- from 20261023221127_device_scoped_reads.sql --------------------------------
-- Device-scoped read tier.
--
-- app.session_role() and app.session_store() are called by every SELECT policy
-- on this schema. They used to resolve the account's newest live session
-- (`ORDER BY expires_at DESC LIMIT 1`), which was correct while a business
-- login was shared per device and wrong the moment PIN sessions became
-- per-device: two tills signed in as the same person resolved to whichever
-- session sorted first, so a cashier device could read at the manager tier and
-- a second shop could read the other shop's catalogue.
--
-- The read now resolves from the request's own `x-storq-session` header, which
-- the PostgREST client attaches from the token held by that browser. The
-- header is a hint only: the token still has to belong to the signed-in
-- auth.uid(), still has to be unexpired, and the staff row still has to be
-- active, so a forged or borrowed value resolves to nobody.
--
-- Fallback: when no header arrives (a client mid-update, a curl, the service
-- role), a single live session for the account is unambiguous and keeps
-- reading. Two or more live sessions is exactly the ambiguous case that used
-- to escalate, so it resolves to no tier and no store, and RLS denies.

CREATE OR REPLACE FUNCTION app.request_header(p_name text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT nullif(btrim(coalesce(
    nullif(current_setting('request.headers', true), '')::jsonb ->> lower(p_name), ''
  )), '')
$$;

-- Private: only the policy helpers below may read the raw request.
REVOKE ALL ON FUNCTION app.request_header(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION app.request_session_token()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE raw text := app.request_header('x-storq-session');
BEGIN
  -- Shape check before the cast: a malformed header must read as "no header",
  -- never raise 22P02 from inside an RLS policy.
  IF raw IS NULL OR raw !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;
  RETURN raw::uuid;
END $$;

REVOKE ALL ON FUNCTION app.request_session_token() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION app.session_staff()
RETURNS public.staff
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE tok uuid := app.request_session_token(); st public.staff; n integer;
BEGIN
  IF tok IS NOT NULL THEN
    SELECT s.* INTO st
      FROM public.staff_sessions ss JOIN public.staff s ON s.id = ss.staff_id
     WHERE ss.token = tok AND ss.auth_uid = auth.uid()
       AND ss.expires_at > now() AND s.active;
    IF st.id IS NOT NULL THEN RETURN st; END IF;
    -- A token this account does not own proves nothing; fall through.
  END IF;

  -- No usable header. One live session cannot be confused with another person,
  -- so a single-till device (or a client mid-update) still reads. Two or more
  -- is exactly the case that used to escalate, so it resolves to nobody.
  SELECT count(*) INTO n
    FROM public.staff_sessions ss JOIN public.staff s ON s.id = ss.staff_id
   WHERE ss.auth_uid = auth.uid() AND ss.expires_at > now() AND s.active;
  IF n = 1 THEN
    SELECT s.* INTO st
      FROM public.staff_sessions ss JOIN public.staff s ON s.id = ss.staff_id
     WHERE ss.auth_uid = auth.uid() AND ss.expires_at > now() AND s.active;
  END IF;
  RETURN st;
END $$;

-- Private: it returns a whole staff row, including the column the table grant
-- deliberately withholds from the client.
REVOKE ALL ON FUNCTION app.session_staff() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION app.session_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$ SELECT (app.session_staff()).role $$;

CREATE OR REPLACE FUNCTION app.session_store()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$ SELECT (app.session_staff()).store_id $$;

REVOKE ALL ON FUNCTION app.session_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app.session_store() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.session_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.session_store() TO authenticated, service_role;

-- Regression proof, rollback only: builds a tenant with a manager session and
-- a store-bound cashier session, then asserts the header decides the tier.
DO $proof$
DECLARE
  b uuid; sa uuid; st_a uuid; st_b uuid; mgr uuid; csh uuid;
  tok_m uuid; tok_c uuid; row app.staff;
BEGIN
  SELECT u.id INTO sa
    FROM auth.users u
   WHERE NOT EXISTS (SELECT 1 FROM public.businesses x WHERE x.owner_id = u.id)
   LIMIT 1;
  IF sa IS NULL THEN RETURN; END IF;   -- fresh database: nothing to build with

  INSERT INTO public.businesses (owner_id, name) VALUES (sa, 'Proof Tenant') RETURNING id INTO b;
  INSERT INTO public.stores (business_id, name) VALUES (b, 'Proof A') RETURNING id INTO st_a;
  INSERT INTO public.stores (business_id, name) VALUES (b, 'Proof B') RETURNING id INTO st_b;
  INSERT INTO public.staff (business_id, name, role, pin_hash, active, is_owner)
    VALUES (b, 'Proof Manager', 'manager', 'x', true, false) RETURNING id INTO mgr;
  INSERT INTO public.staff (business_id, store_id, name, role, pin_hash, active, is_owner)
    VALUES (b, st_a, 'Proof Cashier', 'cashier', 'x', true, false) RETURNING id INTO csh;

  tok_m := gen_random_uuid(); tok_c := gen_random_uuid();
  INSERT INTO public.staff_sessions (staff_id, auth_uid, device_id, token, expires_at)
    VALUES (mgr, sa, 'proof-m', tok_m, now() + interval '1 hour'),
           (csh, sa, 'proof-c', tok_c, now() + interval '1 hour');

  PERFORM set_config('request.jwt.claim.sub', sa::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', sa)::text, true);

  PERFORM set_config('request.headers', json_build_object('x-storq-session', tok_m)::text, true);
  row := app.session_staff();
  ASSERT row.id = mgr, 'manager header must resolve the manager session';
  ASSERT row.store_id IS NULL, 'manager is not store-bound';

  PERFORM set_config('request.headers', json_build_object('x-storq-session', tok_c)::text, true);
  row := app.session_staff();
  ASSERT row.id = csh, 'cashier header must resolve the cashier session';
  ASSERT row.store_id = st_a, 'cashier must resolve its own store';

  PERFORM set_config('request.headers', '{}', true);
  ASSERT app.session_staff().id IS NULL, 'two live sessions with no header must deny';

  PERFORM set_config('request.headers', json_build_object('x-storq-session', gen_random_uuid())::text, true);
  ASSERT app.session_staff().id IS NULL, 'a forged token must deny';

  DELETE FROM public.staff_sessions WHERE device_id = 'proof-m';
  PERFORM set_config('request.headers', '{}', true);
  row := app.session_staff();
  ASSERT row.id = csh, 'a lone live session keeps reading without a header';

  RAISE EXCEPTION 'proof complete: rolling back';
EXCEPTION WHEN OTHERS THEN
  IF sqlerrm <> 'proof complete: rolling back' THEN RAISE; END IF;
END $proof$;

-- --- from 20261023221328_billing_and_account_lifecycle.sql ----------------------
-- Account lifecycle: trial length, owner PIN recovery, per-device sign-out.
--
-- Three gaps closed here, all of them ways a paying shop could end up with no
-- way back in:
--
--  * The trial default was one day, so a shop that registered on Friday and
--    came back on Monday was locked out before it ever rang up a sale.
--  * The owner PIN had no recovery path at all: a forgotten digit meant a
--    permanent dead end on a device that only knows the PIN pad.
--  * Signing out called app.lock_all_sessions(), which took every till in the
--    business offline because they share one business login.

-- ---------------------------------------------------------------------------
-- 1. Trial length
-- ---------------------------------------------------------------------------

ALTER TABLE public.subscriptions
  ALTER COLUMN trial_ends_at SET DEFAULT (now() + interval '14 days');

-- One-time backfill: give trial tenants the two weeks they should have had.
-- greatest() keeps any longer trial already granted, and paid tenants are
-- untouched.
UPDATE public.subscriptions s
   SET trial_ends_at = greatest(s.trial_ends_at, s.created_at + interval '14 days')
 WHERE s.paid_until IS NULL
   AND s.closed_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Linter: trigger function without a pinned search_path
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Linter: unindexed foreign key
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS platform_audit_log_actor_idx
  ON public.platform_audit_log (actor_user_id);

-- ---------------------------------------------------------------------------
-- 4. Per-device sign-out
-- ---------------------------------------------------------------------------

-- Ends only the session this device holds. The business login is shared, so
-- one till signing out must never sign the shop out everywhere. The header
-- token is a second handle on the same row for a client that lost its device
-- id.
CREATE OR REPLACE FUNCTION app.lock_device(p_device_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  b uuid := app.my_business_id();
  dev text := lower(btrim(coalesce(p_device_id, '')));
  tok uuid := app.request_session_token();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF dev <> '' AND dev !~ '^[a-z0-9][a-z0-9._-]{7,63}$' THEN dev := ''; END IF;

  DELETE FROM public.staff_sessions
   WHERE auth_uid = uid
     AND ((dev <> '' AND device_id = dev)
          OR (tok IS NOT NULL AND token = tok));

  DELETE FROM public.pin_throttle
   WHERE auth_uid = uid
     AND dev <> ''
     AND device_id = dev
     AND (b IS NULL OR business_id = b);
END $$;

REVOKE ALL ON FUNCTION app.lock_device(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.lock_device(p_device_id text)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$ SELECT app.lock_device($1) $$;

-- ---------------------------------------------------------------------------
-- 5. Owner PIN recovery
-- ---------------------------------------------------------------------------

-- The password that signs the business in can also re-set the owner PIN, but
-- only right after it was actually typed: the PIN pad is what an unattended
-- till exposes, so recovery has to cost a fresh password sign-in rather than
-- ride on a session someone walked away from.
CREATE OR REPLACE FUNCTION app.reset_owner_pin(p_pin text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  uid uuid := auth.uid();
  b uuid;
  o public.staff;
  v_seen timestamptz;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4,8}$' THEN
    RAISE EXCEPTION 'PIN must be 4 to 8 digits';
  END IF;

  SELECT id INTO b FROM public.businesses WHERE owner_id = uid;
  IF b IS NULL THEN RAISE EXCEPTION 'No business for this account'; END IF;

  SELECT last_sign_in_at INTO v_seen FROM auth.users WHERE id = uid;
  IF v_seen IS NULL OR v_seen < now() - interval '15 minutes' THEN
    RAISE EXCEPTION 'Confirm your password again to reset the PIN';
  END IF;

  SELECT * INTO o FROM public.staff WHERE business_id = b AND is_owner LIMIT 1;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Owner not found'; END IF;

  -- Two people sharing one PIN would unlock as the wrong person.
  IF public.pin_taken(b, p_pin, o.id) THEN
    RAISE EXCEPTION 'That PIN already belongs to someone else';
  END IF;

  UPDATE public.staff
     SET pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 10))
   WHERE id = o.id;

  -- Every live till was unlocked with the old PIN, so the reset ends them all
  -- and the new one is the only way back in. Throttle state goes too, or a
  -- locked-out pad would stay locked after a successful reset.
  DELETE FROM public.staff_sessions
   WHERE auth_uid = uid
      OR staff_id IN (SELECT id FROM public.staff WHERE business_id = b);
  DELETE FROM public.pin_throttle WHERE business_id = b;
  DELETE FROM public.pin_login_throttle WHERE business_id = b;

  RETURN json_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION app.reset_owner_pin(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reset_owner_pin(p_pin text)
RETURNS json
LANGUAGE sql
SET search_path = public
AS $$ SELECT app.reset_owner_pin($1) $$;

-- ---------------------------------------------------------------------------
-- 6. Pending subscription payments for the Billing sweep
-- ---------------------------------------------------------------------------

-- The Billing screen is the recovery screen, so this reads while the
-- subscription is inactive: a shop whose payment went through but whose
-- browser never came back needs to find that reference and settle it.
CREATE OR REPLACE FUNCTION app.pending_payment_refs(p_token uuid)
RETURNS TABLE (
  tx_ref text,
  amount numeric,
  currency text,
  stores integer,
  billed_stores integer,
  period text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE st public.staff;
BEGIN
  st := app.require_perm_nosub(p_token, ARRAY['money']);
  RETURN QUERY
    SELECT p.tx_ref, p.amount, p.currency, p.stores, p.billed_stores, p.period, p.created_at
      FROM public.subscription_payments p
     WHERE p.business_id = st.business_id
       AND p.status = 'pending'
       AND p.created_at > now() - interval '7 days'
     ORDER BY p.created_at DESC
     LIMIT 20;
END $$;

REVOKE ALL ON FUNCTION app.pending_payment_refs(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pending_payment_refs(p_token uuid)
RETURNS TABLE (
  tx_ref text,
  amount numeric,
  currency text,
  stores integer,
  billed_stores integer,
  period text,
  created_at timestamptz
)
LANGUAGE sql
SET search_path = public
AS $$ SELECT * FROM app.pending_payment_refs($1) $$;

-- --- from 20261023221440_offline_sale_time.sql ----------------------------------
-- Offline sales keep the time they happened.
--
-- A queued sale replayed from a till that was offline went in with
-- now() as its timestamp, so a Saturday evening sale synced on Monday: landed
-- in Monday's revenue and in whatever drawer happened to be open when the
-- network came back. Yesterday's till could not be counted and today's
-- expected cash was wrong by the amount of the queue.
--
-- The client now sends the moment it rang the sale up, and the sale is stamped
-- with that moment (clamped to the last week so a device with a badly set clock
-- cannot backdate into closed books) and attributed to the drawer that was
-- open then. A historical sale with no drawer covering it stays unattributed
-- instead of being pushed into today's count.
--
-- The public RPCs are dropped and recreated rather than overloaded: a 12-arg
-- and a 13-arg version would both resolve, and the old one must not survive.

DROP FUNCTION public.checkout_ref(uuid, uuid, uuid, text, jsonb, numeric, text, text, text, text, jsonb, jsonb, text);
DROP FUNCTION public.checkout(uuid, uuid, text, jsonb, numeric, text, text, text, text, jsonb, jsonb, text);
DROP FUNCTION app.checkout_ref(uuid, uuid, uuid, text, jsonb, numeric, text, text, text, text, jsonb, jsonb, text);
DROP FUNCTION app.checkout(uuid, uuid, text, jsonb, numeric, text, text, text, text, jsonb, jsonb, text);

-- Drawer attribution follows the sale's own timestamp for both paths.
CREATE OR REPLACE FUNCTION app.attach_drawer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r uuid;
BEGIN
  -- An approval invoice takes no money yet; its drawer opens when it is paid.
  -- A layby with no deposit is a promise, not cash in the drawer.
  IF NEW.shift_id IS NOT NULL
     OR NEW.status = 'pending_approval'
     OR (NEW.status = 'layby_open' AND coalesce(NEW.paid, 0) <= 0) THEN
    RETURN NEW;
  END IF;

  -- The drawer that was open when this sale happened, not the one open now.
  SELECT id INTO r FROM public.cash_shifts
   WHERE store_id = NEW.store_id
     AND opened_at <= NEW.created_at
     AND (closed_at IS NULL OR closed_at > NEW.created_at)
   ORDER BY opened_at DESC
   LIMIT 1;
  IF r IS NOT NULL THEN
    NEW.shift_id := r;
    RETURN NEW;
  END IF;

  -- No drawer covered that moment. A live sale still gets one opened for it;
  -- a replayed offline sale from an untracked window stays unattributed rather
  -- than inflating today's count.
  IF NEW.created_at < now() - interval '1 minute' THEN RETURN NEW; END IF;

  NEW.shift_id := app.ensure_drawer(NEW.business_id, NEW.store_id, NEW.created_by);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.checkout(p_token uuid, p_store uuid, p_kind text, p_items jsonb, p_payment numeric, p_method text, p_customer_name text, p_customer_phone text, p_note text, p_tenders jsonb DEFAULT NULL::jsonb, p_discounts jsonb DEFAULT NULL::jsonb, p_override_pin text DEFAULT NULL::text, p_occurred_at timestamptz DEFAULT NULL::timestamptz)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE me public.staff; st public.stores; v_gross numeric; v_disc numeric; v_sub numeric; v_total numeric; v_tax numeric; v_sale uuid;
  v_status text; v_num int; v_pay numeric; v_shift uuid; v_short text; v_lines int; v_matched int; v_n int; ln jsonb;
  v_pid uuid; v_name text; v_unit numeric; v_cost numeric; v_qty numeric; v_ld numeric; v_item uuid; v_dc int;
  v_nm int; v_cash numeric; v_tsum numeric; v_pm text; v_ovr numeric; v_at timestamptz;
BEGIN
  me := app.require_perm(p_token, '{sell}'::text[]);
  -- Offline replay: the till's clock is the truth, within reason. Future times
  -- collapse to now, times older than a week collapse to a week ago.
  v_at := least(coalesce(p_occurred_at, now()), now());
  IF v_at < now() - interval '7 days' THEN v_at := now() - interval '7 days'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'Cart must be a list of items'; END IF;
  IF jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Cart is empty'; END IF;
  IF jsonb_array_length(p_items) > 500 THEN RAISE EXCEPTION 'Too many lines on one sale (max 500)'; END IF;
  SELECT count(*) INTO v_lines FROM jsonb_array_elements(p_items) x
   WHERE coalesce(jsonb_typeof(x),'') <> 'object'
      OR coalesce(x->>'product_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      OR coalesce(x->>'qty','') !~ '^[0-9]{1,7}(\.[0-9]{1,3})?$';
  IF v_lines > 0 THEN RAISE EXCEPTION 'Cart contains an item with a bad id or quantity'; END IF;
  SELECT count(*) INTO v_lines FROM jsonb_array_elements(p_items) x WHERE (x->>'qty')::numeric <= 0;
  IF v_lines > 0 THEN RAISE EXCEPTION 'Quantities must be above zero'; END IF;

  IF p_discounts IS NOT NULL THEN
    IF jsonb_typeof(p_discounts) <> 'array' THEN RAISE EXCEPTION 'Discounts must be a list'; END IF;
    SELECT count(*) INTO v_lines FROM jsonb_array_elements(p_discounts) d
     WHERE coalesce(jsonb_typeof(d),'') <> 'object'
        OR coalesce(d->>'product_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        OR coalesce(d->>'amount','') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$';
    IF v_lines > 0 THEN RAISE EXCEPTION 'Discounts contain a bad product or amount'; END IF;
  END IF;

  SELECT * INTO st FROM public.stores WHERE id = p_store AND business_id = me.business_id;
  IF st.id IS NULL THEN RAISE EXCEPTION 'Unknown store'; END IF;
  IF me.store_id IS NOT NULL AND me.store_id <> p_store THEN RAISE EXCEPTION 'You are not assigned to this store'; END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('sale','layby') THEN RAISE EXCEPTION 'Unknown sale type'; END IF;
  IF p_kind = 'layby' AND coalesce(btrim(p_customer_name),'') = '' THEN RAISE EXCEPTION 'Layby needs a customer name'; END IF;
  IF char_length(coalesce(p_customer_name,'')) > 120 THEN RAISE EXCEPTION 'Customer name is too long (max 120 characters)'; END IF;
  IF p_customer_name ~ '[[:cntrl:]<>]' THEN RAISE EXCEPTION 'Customer name contains unsupported characters'; END IF;
  IF p_customer_phone IS NOT NULL AND btrim(p_customer_phone) <> '' AND btrim(p_customer_phone) !~ '^[+0-9()\- ]{6,32}$' THEN
    RAISE EXCEPTION 'Customer phone must be 6-32 characters of digits, + ( ) - and spaces';
  END IF;
  IF coalesce(p_note,'') <> '' AND char_length(p_note) > 500 THEN RAISE EXCEPTION 'Note is too long (max 500 characters)'; END IF;
  IF p_method IS NOT NULL AND NOT app.payment_method_allowed(p_store, p_method) THEN RAISE EXCEPTION 'Unknown payment method'; END IF;
  IF p_payment IS NOT NULL AND p_payment NOT BETWEEN 0 AND 10000000000 THEN RAISE EXCEPTION 'Payment amount must be between 0 and 10,000,000,000'; END IF;

  SELECT count(*) INTO v_matched FROM jsonb_array_elements(p_items) x
    JOIN public.products p ON p.id = (x->>'product_id')::uuid AND p.store_id = p_store AND p.active;
  IF v_matched <> jsonb_array_length(p_items) THEN RAISE EXCEPTION 'One or more items are not in your catalogue'; END IF;
  SELECT count(*) INTO v_lines FROM (
    SELECT (x->>'product_id')::uuid pid FROM jsonb_array_elements(p_items) x GROUP BY 1 HAVING count(*) > 1) d;
  IF v_lines > 0 THEN RAISE EXCEPTION 'Merge duplicate cart lines before discounting'; END IF;

  SELECT sum(public.effective_price(p.id) * (x->>'qty')::numeric) INTO v_gross
    FROM jsonb_array_elements(p_items) x JOIN public.products p ON p.id = (x->>'product_id')::uuid AND p.store_id = p_store;
  IF v_gross IS NULL OR v_gross NOT BETWEEN 0 AND 100000000000 THEN RAISE EXCEPTION 'Invalid items'; END IF;
  SELECT coalesce(sum((d->>'amount')::numeric), 0) INTO v_disc
    FROM jsonb_array_elements(coalesce(p_discounts,'[]'::jsonb)) d
    JOIN public.products p ON p.id = (d->>'product_id')::uuid AND p.store_id = p_store;
  IF v_disc < 0 OR v_disc > v_gross THEN RAISE EXCEPTION 'Discounts are larger than this sale'; END IF;
  v_sub := round(v_gross - v_disc, 2);
  IF v_sub < 0 THEN v_sub := 0; END IF;

  IF v_disc > 0 AND NOT app.has_perm(me, 'approvals') THEN
    IF (v_gross > 0 AND v_disc > round(v_gross * 0.10, 2)) OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(coalesce(p_discounts,'[]'::jsonb)) d
      JOIN public.products p ON p.id = (d->>'product_id')::uuid AND p.store_id = p_store
      JOIN jsonb_array_elements(p_items) x ON (x->>'product_id')::uuid = p.id
      WHERE (d->>'amount')::numeric > round(public.effective_price(p.id) * (x->>'qty')::numeric * 0.10, 2)) THEN
      IF p_override_pin IS NULL OR p_override_pin !~ '^[0-9]{4,8}$' THEN
        RAISE EXCEPTION 'That discount needs a manager PIN';
      END IF;
      SELECT count(*) INTO v_dc FROM public.staff
       WHERE business_id = me.business_id AND active AND (is_owner OR 'approvals' = ANY (permissions))
         AND pin_hash = extensions.crypt(p_override_pin, pin_hash);
      IF v_dc = 0 THEN RAISE EXCEPTION 'Wrong manager PIN for this discount'; END IF;
    END IF;
  END IF;

  IF st.tax_rate > 0 AND st.tax_inclusive THEN v_total := round(v_sub, 2); v_tax := round(v_sub - v_sub / (1 + st.tax_rate/100), 2);
  ELSIF st.tax_rate > 0 THEN v_tax := round(v_sub * st.tax_rate/100, 2); v_total := round(v_sub, 2) + v_tax;
  ELSE v_total := round(v_sub, 2); v_tax := 0; END IF;

  v_status := CASE WHEN st.store_type = 'approval' THEN 'pending_approval' WHEN p_kind = 'layby' THEN 'layby_open' ELSE 'completed' END;

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

  v_nm := 0; v_cash := 0; v_tsum := 0;
  IF p_tenders IS NOT NULL AND jsonb_typeof(p_tenders) = 'array' THEN
    v_n := jsonb_array_length(p_tenders);
    IF v_n > 10 THEN RAISE EXCEPTION 'Too many tenders on one sale (max 10)'; END IF;
    IF v_n > 0 THEN
      SELECT count(*) INTO v_lines FROM jsonb_array_elements(p_tenders) t
       WHERE coalesce(jsonb_typeof(t),'') <> 'object'
          OR NOT app.payment_method_allowed(p_store, coalesce(t->>'method',''))
          OR coalesce(t->>'amount','') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$'
          OR (t->>'amount')::numeric <= 0;
      IF v_lines > 0 THEN RAISE EXCEPTION 'A tender has an unknown method or a bad amount'; END IF;
    END IF;
    SELECT count(DISTINCT t->>'method'), coalesce(sum((t->>'amount')::numeric), 0),
           coalesce(sum((t->>'amount')::numeric) FILTER (WHERE t->>'method' = 'cash'), 0)
      INTO v_nm, v_tsum, v_cash FROM jsonb_array_elements(p_tenders) t;
    IF v_n > 0 THEN
      IF v_status = 'completed' THEN
        IF v_tsum < v_total THEN RAISE EXCEPTION 'Tenders do not cover the total'; END IF;
        IF v_tsum > v_total * 2 THEN RAISE EXCEPTION 'Cash tender is far above the total'; END IF;
      ELSIF v_tsum > v_total THEN
        RAISE EXCEPTION 'Tenders exceed the invoice total';
      END IF;
    END IF;
  END IF;
  IF v_nm = 0 THEN v_tsum := least(greatest(coalesce(p_payment, 0), 0), v_total); v_cash := v_tsum; END IF;

  -- The drawer that was open at v_at, matching the trigger's rule.
  SELECT id INTO v_shift FROM public.cash_shifts
   WHERE store_id = p_store
     AND opened_at <= v_at
     AND (closed_at IS NULL OR closed_at > v_at)
   ORDER BY opened_at DESC
   LIMIT 1;
  IF v_status = 'completed' THEN
    v_pay := v_total;
    IF v_cash < v_total THEN v_cash := v_total; END IF;
  ELSE
    v_pay := v_tsum;
  END IF;

  v_pm := CASE WHEN v_nm > 1 THEN 'split'
    WHEN v_nm = 1 THEN (SELECT min(t->>'method') FROM jsonb_array_elements(p_tenders) t)
    ELSE coalesce(p_method,'cash') END;

  INSERT INTO public.sales(business_id, store_id, kind, status, total, tax, discount, paid, payment_method, customer_name, customer_phone, note, created_by, shift_id, created_at)
    VALUES (me.business_id, p_store, p_kind, v_status, v_total, v_tax, v_disc,
      CASE WHEN v_status = 'pending_approval' THEN 0 ELSE v_pay END, v_pm,
      nullif(btrim(coalesce(p_customer_name,'')),''), nullif(btrim(coalesce(p_customer_phone,'')),''),
      nullif(btrim(coalesce(p_note,'')),''), me.id, v_shift, v_at)
    RETURNING id, number INTO v_sale, v_num;

  FOR ln IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT p.id, p.name, public.effective_price(p.id), coalesce(pc.cost, 0)
      INTO v_pid, v_name, v_unit, v_cost
      FROM public.products p LEFT JOIN public.product_costs pc ON pc.product_id = p.id
      WHERE p.id = (ln->>'product_id')::uuid AND p.store_id = p_store;
    v_qty := (ln->>'qty')::numeric;
    SELECT coalesce(sum((d->>'amount')::numeric), 0) INTO v_ld
      FROM jsonb_array_elements(coalesce(p_discounts,'[]'::jsonb)) d WHERE (d->>'product_id')::uuid = v_pid;
    IF v_ld > v_unit * v_qty THEN v_ld := v_unit * v_qty; END IF;
    INSERT INTO public.sale_items(sale_id, product_id, name, qty, price, discount)
      VALUES (v_sale, v_pid, v_name, v_qty,
        CASE WHEN v_qty > 0 THEN round((v_unit * v_qty - v_ld) / v_qty, 2) ELSE 0 END, v_ld)
      RETURNING id INTO v_item;
    INSERT INTO public.sale_item_costs(sale_item_id, cost) VALUES (v_item, v_cost);
  END LOOP;

  IF v_status <> 'pending_approval' THEN
    PERFORM public._move_stock(v_sale, -1);
    IF v_nm > 0 AND v_tsum > 0 THEN
      IF v_status = 'completed' AND v_cash > 0 AND v_tsum > v_total AND v_cash > v_total - (v_tsum - v_cash) THEN
        v_ovr := v_tsum - v_total;
        INSERT INTO public.payments(sale_id, amount, method, staff_id, created_at)
          SELECT v_sale, greatest(GREATEST((t->>'amount')::numeric - CASE WHEN t->>'method' = 'cash' THEN v_ovr ELSE 0 END, 0), 0), t->>'method', me.id, v_at
          FROM jsonb_array_elements(p_tenders) t
          WHERE (t->>'amount')::numeric - CASE WHEN t->>'method' = 'cash' THEN v_ovr ELSE 0 END > 0;
      ELSE
        INSERT INTO public.payments(sale_id, amount, method, staff_id, created_at)
          SELECT v_sale, (t->>'amount')::numeric, t->>'method', me.id, v_at FROM jsonb_array_elements(p_tenders) t WHERE (t->>'amount')::numeric > 0;
      END IF;
    ELSIF v_pay > 0 THEN
      INSERT INTO public.payments(sale_id, amount, method, staff_id, created_at) VALUES (v_sale, v_pay, coalesce(v_pm,'cash'), me.id, v_at);
    END IF;
    IF p_kind = 'layby' AND v_pay >= v_total THEN UPDATE public.sales SET status = 'layby_completed' WHERE id = v_sale; END IF;
  END IF;
  RETURN json_build_object('id', v_sale, 'number', v_num, 'status', (SELECT status FROM public.sales WHERE id = v_sale), 'total', v_total, 'tax', v_tax, 'discount', v_disc);
END $function$;

CREATE OR REPLACE FUNCTION app.checkout_ref(p_token uuid, p_client_ref uuid, p_store uuid, p_kind text, p_items jsonb, p_payment numeric, p_method text, p_customer_name text, p_customer_phone text, p_note text, p_tenders jsonb DEFAULT NULL::jsonb, p_discounts jsonb DEFAULT NULL::jsonb, p_override_pin text DEFAULT NULL::text, p_occurred_at timestamptz DEFAULT NULL::timestamptz)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE me public.staff; s public.sales; r json;
BEGIN
  me := app.require_perm(p_token, '{sell}'::text[]);
  IF p_client_ref IS NULL THEN RAISE EXCEPTION 'Missing sale reference'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_client_ref::text));
  SELECT * INTO s FROM public.sales WHERE client_ref = p_client_ref;
  IF s.id IS NOT NULL THEN
    IF s.business_id <> me.business_id THEN RAISE EXCEPTION 'Sale reference already used'; END IF;
    RETURN json_build_object('id', s.id, 'number', s.number, 'status', s.status, 'total', s.total, 'tax', s.tax, 'discount', s.discount, 'duplicate', true);
  END IF;
  r := app.checkout(p_token, p_store, p_kind, p_items, p_payment, p_method, p_customer_name, p_customer_phone, p_note,
    p_tenders, p_discounts, p_override_pin, p_occurred_at);
  UPDATE public.sales SET client_ref = p_client_ref WHERE id = (r->>'id')::uuid;
  RETURN r;
END $function$;

CREATE OR REPLACE FUNCTION public.checkout(p_token uuid, p_store uuid, p_kind text, p_items jsonb, p_payment numeric, p_method text, p_customer_name text, p_customer_phone text, p_note text, p_tenders jsonb DEFAULT NULL::jsonb, p_discounts jsonb DEFAULT NULL::jsonb, p_override_pin text DEFAULT NULL::text, p_occurred_at timestamptz DEFAULT NULL::timestamptz)
RETURNS json
LANGUAGE sql
SET search_path = public
AS $function$
  select app.checkout($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
$function$;

CREATE OR REPLACE FUNCTION public.checkout_ref(p_token uuid, p_client_ref uuid, p_store uuid, p_kind text, p_items jsonb, p_payment numeric, p_method text, p_customer_name text, p_customer_phone text, p_note text, p_tenders jsonb DEFAULT NULL::jsonb, p_discounts jsonb DEFAULT NULL::jsonb, p_override_pin text DEFAULT NULL::text, p_occurred_at timestamptz DEFAULT NULL::timestamptz)
RETURNS json
LANGUAGE sql
SET search_path = public
AS $function$
  select app.checkout_ref($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
$function$;

-- --- from 20261023223042_device_management_and_rpc_grants.sql -------------------
-- Signed-in tills: list them, end one — plus the grant the last migration missed.
--
-- 1. The three account-level helpers added with the lifecycle work were revoked
--    from `authenticated` while their `public` wrappers are plain SECURITY
--    INVOKER functions. A wrapper runs with the caller's privileges, so the
--    inner call died with "permission denied for function ..." before reaching
--    a single guard: sign-out only cleared the browser, the Billing sweep saw no
--    pending references, and the owner PIN reset could never run. Every other
--    app.* helper behind a wrapper is granted to `authenticated`, so this
--    restores the convention rather than inventing a second one.
--
-- 2. The business login is shared by every till, so "which devices are open and
--    who is on them" had no answer anywhere in the product: a phone left signed
--    in on a counter stayed live for eight hours with nothing able to end it.

-- ---------------------------------------------------------------------------
-- 1. Restore the grants
-- ---------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION app.lock_device(text) TO authenticated;
GRANT EXECUTE ON FUNCTION app.pending_payment_refs(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app.reset_owner_pin(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Signed-in tills
-- ---------------------------------------------------------------------------

-- One row per live PIN session in this business, whichever staff member holds
-- it, so the owner can see the shop's devices rather than just their own.
-- `is_current` marks the till asking, which the screen hides behind "this till".
CREATE OR REPLACE FUNCTION app.account_devices(p_token uuid)
RETURNS TABLE (
  device_id text,
  staff_id uuid,
  staff_name text,
  created_at timestamptz,
  expires_at timestamptz,
  is_current boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE st public.staff;
BEGIN
  -- Reading the roster is enough to read the device list; ending one needs the
  -- change grant below.
  st := app.require_perm(p_token, ARRAY['staff', 'view_staff']);

  RETURN QUERY
    SELECT s.device_id, s.staff_id, p.name, s.created_at, s.expires_at,
           (s.token = p_token)
      FROM public.staff_sessions s
      JOIN public.staff p ON p.id = s.staff_id
     WHERE s.auth_uid = auth.uid()
       AND s.expires_at > now()
       AND p.business_id = st.business_id
     ORDER BY s.created_at DESC;
END $$;

REVOKE ALL ON FUNCTION app.account_devices(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.account_devices(uuid) TO authenticated;

-- End one till. The session row is the credential, so deleting it is the whole
-- revocation: the next read or write from that device resolves no staff row and
-- falls back to the PIN pad. Throttle state is cleared with it, or a till that
-- was locked out would stay locked out after it was reset.
CREATE OR REPLACE FUNCTION app.revoke_device(p_token uuid, p_device_id text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  st public.staff;
  dev text := lower(btrim(coalesce(p_device_id, '')));
  ended integer;
BEGIN
  st := app.require_perm(p_token, ARRAY['staff']);

  IF dev = '' OR dev !~ '^[a-z0-9][a-z0-9._-]{7,63}$' THEN
    RAISE EXCEPTION 'Unknown device';
  END IF;

  -- Ending the till you are standing at is a sign-out, and it is done from the
  -- pad. Refusing it here keeps one button from locking the counter it is on.
  IF EXISTS (
    SELECT 1 FROM public.staff_sessions ss
     WHERE ss.token = p_token AND ss.device_id = dev
  ) THEN
    RAISE EXCEPTION 'That is this till — use sign out on it instead';
  END IF;

  DELETE FROM public.staff_sessions s
   USING public.staff p
   WHERE s.staff_id = p.id
     AND p.business_id = st.business_id
     AND s.auth_uid = auth.uid()
     AND s.device_id = dev;
  GET DIAGNOSTICS ended = ROW_COUNT;

  IF ended = 0 THEN
    RAISE EXCEPTION 'That till is no longer signed in';
  END IF;

  DELETE FROM public.pin_throttle
   WHERE auth_uid = auth.uid()
     AND business_id = st.business_id
     AND device_id = dev;

  RETURN json_build_object('ok', true, 'ended', ended);
END $$;

REVOKE ALL ON FUNCTION app.revoke_device(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.revoke_device(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.account_devices(p_token uuid)
RETURNS TABLE (
  device_id text,
  staff_id uuid,
  staff_name text,
  created_at timestamptz,
  expires_at timestamptz,
  is_current boolean
)
LANGUAGE sql
SET search_path = public
AS $$ SELECT * FROM app.account_devices($1) $$;

CREATE OR REPLACE FUNCTION public.revoke_device(p_token uuid, p_device_id text)
RETURNS json
LANGUAGE sql
SET search_path = public
AS $$ SELECT app.revoke_device($1, $2) $$;

-- ---------------------------------------------------------------------------
-- 3. Proof
-- ---------------------------------------------------------------------------

-- The whole point of the first section: a wrapper can reach its helper.
DO $$
BEGIN
  IF NOT has_function_privilege('authenticated', 'app.lock_device(text)', 'execute')
     OR NOT has_function_privilege('authenticated', 'app.pending_payment_refs(uuid)', 'execute')
     OR NOT has_function_privilege('authenticated', 'app.reset_owner_pin(text)', 'execute') THEN
    RAISE EXCEPTION 'A wrapper would be blocked from its own helper function';
  END IF;
  -- ...and anonymous callers still cannot touch the helpers directly.
  IF has_function_privilege('anon', 'app.reset_owner_pin(text)', 'execute')
     OR has_function_privilege('anon', 'app.revoke_device(uuid,text)', 'execute') THEN
    RAISE EXCEPTION 'anon must not execute account helpers';
  END IF;
END $$;

-- --- from 20261023223055_ops_payment_verification.sql ---------------------------
-- Operator console: see a stuck payment and settle it in place.
--
-- Every other path to activation is automatic now (the Billing sweep, the
-- provider webhook, the scheduled reconciler), but support still had no verb for
-- the one case those cannot fix: a customer paid and the reference is stuck
-- because the amount, the currency or the response disagree. The console could
-- list tenants and move entitlements, but not say "I checked this charge".
--
-- The verification itself stays in the server function that owns the PayChangu
-- secret (`verifyAndComplete`), so this adds no second way to decide a payment
-- succeeded — only the operator's name and reason beside the outcome, which is
-- what makes granting time by hand auditable.

-- ---------------------------------------------------------------------------
-- 1. The journal accepts the new verb
-- ---------------------------------------------------------------------------

ALTER TABLE public.platform_audit_log
  DROP CONSTRAINT platform_audit_log_action_check;

ALTER TABLE public.platform_audit_log
  ADD CONSTRAINT platform_audit_log_action_check
  CHECK (action = ANY (ARRAY[
    'slots', 'extend', 'until', 'trial', 'plan',
    'suspend', 'restore', 'close', 'reopen', 'purge',
    'verify_payment'
  ]));

-- ---------------------------------------------------------------------------
-- 2. What is still waiting
-- ---------------------------------------------------------------------------

-- Support may read this: the whole point is that the first responder can answer
-- "did my customer's money land?" without asking billing to look. Thirty days is
-- the same horizon the provider keeps for a reference.
CREATE OR REPLACE FUNCTION public.ops_pending_payments(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE rows_ jsonb;
BEGIN
  PERFORM public.require_platform_admin(ARRAY['support', 'billing', 'owner']);
  IF p_business_id IS NULL THEN RAISE EXCEPTION 'Tenant not found'; END IF;

  SELECT coalesce(
           jsonb_agg(
             jsonb_build_object(
               'tx_ref', p.tx_ref,
               'amount', p.amount,
               'currency', p.currency,
               'stores', p.stores,
               'billed_stores', p.billed_stores,
               'period', p.period,
               'created_at', p.created_at
             ) ORDER BY p.created_at DESC
           ),
           '[]'::jsonb
         )
    INTO rows_
    FROM public.subscription_payments p
   WHERE p.business_id = p_business_id
     AND p.status = 'pending'
     AND p.created_at > now() - interval '30 days';

  RETURN jsonb_build_object('rows', rows_);
END $$;

-- ---------------------------------------------------------------------------
-- 3. Record what the operator found
-- ---------------------------------------------------------------------------

-- Called after the verifier has run. It writes the journal row only: the time
-- and slots a paid charge buys are still granted by complete_subscription_payment
-- inside the server function, never from here, so an operator cannot credit an
-- account by calling this.
CREATE OR REPLACE FUNCTION public.ops_journal_payment_verification(
  p_business_id uuid,
  p_tx_ref text,
  p_status text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  op public.platform_admins;
  name_ text;
  before_ text;
BEGIN
  op := public.require_platform_admin(ARRAY['billing', 'owner']);

  IF p_tx_ref IS NULL OR char_length(btrim(p_tx_ref)) NOT BETWEEN 6 AND 80 THEN
    RAISE EXCEPTION 'Unknown payment reference';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('paid', 'unpaid') THEN
    RAISE EXCEPTION 'Unknown verification outcome';
  END IF;
  IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 8 AND 300 THEN
    RAISE EXCEPTION 'Say why this changed (8 to 300 characters)';
  END IF;

  SELECT b.name INTO name_ FROM public.businesses b WHERE b.id = p_business_id;
  IF name_ IS NULL THEN RAISE EXCEPTION 'Tenant not found'; END IF;

  SELECT p.status INTO before_
    FROM public.subscription_payments p
   WHERE p.tx_ref = btrim(p_tx_ref)
     AND p.business_id = p_business_id;
  IF before_ IS NULL THEN
    RAISE EXCEPTION 'That reference does not belong to this business';
  END IF;

  INSERT INTO public.platform_audit_log
    (actor_user_id, actor_label, actor_role, business_id, target_label,
     action, before_state, after_state, reason)
  VALUES
    (op.user_id, op.name, op.role, p_business_id, name_,
     'verify_payment',
     jsonb_build_object('status', before_, 'tx_ref', btrim(p_tx_ref)),
     jsonb_build_object('status', p_status, 'tx_ref', btrim(p_tx_ref)),
     btrim(p_reason));

  RETURN jsonb_build_object('ok', true, 'status', p_status);
END $$;

-- ---------------------------------------------------------------------------
-- 4. Proof
-- ---------------------------------------------------------------------------

-- A session with no operator row is refused by the guard the four functions
-- above all go through, so adding them opens no new door.
DO $$
BEGIN
  BEGIN
    PERFORM public.require_platform_admin(ARRAY['support', 'billing', 'owner']);
    RAISE EXCEPTION 'guard did not fire for a non-operator';
  EXCEPTION
    WHEN OTHERS THEN
      IF sqlerrm <> 'Not a platform operator' THEN
        RAISE EXCEPTION 'Unexpected guard: %', sqlerrm;
      END IF;
  END;
END $$;

