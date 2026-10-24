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
