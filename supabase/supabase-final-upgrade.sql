-- CampusAura final upgrade.
-- Run after supabase-schema.sql and supabase-upgrade.sql.
-- This keeps Supabase Auth as the identity provider while adding admin review
-- and readable reference codes alongside the existing UUID primary keys.

alter table public.profiles
  add column if not exists email text;

alter table public.profiles
  add column if not exists rejection_reason text;

alter table public.verification_documents
  add column if not exists rejection_reason text;

alter table public.profiles
  add column if not exists reference_code text unique;

alter table public.accommodations
  add column if not exists reference_code text unique;

alter table public.marketplace_items
  add column if not exists reference_code text unique;

create table if not exists public.reference_counters (
  code_type text primary key,
  next_value bigint not null default 1
);

insert into public.reference_counters (code_type, next_value)
values
  ('product', 1),
  ('service', 1),
  ('property', 1),
  ('provider', 1),
  ('admin', 1),
  ('student', 1)
on conflict (code_type) do nothing;

create or replace function public.next_reference_code(p_code_type text)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  prefix text;
  width integer;
  value bigint;
begin
  prefix := case p_code_type
    when 'product' then 'prod'
    when 'service' then 'serv'
    when 'property' then 'prop'
    when 'provider' then 'cam'
    when 'admin' then 'adm'
    when 'student' then 'user'
    else null
  end;
  width := case p_code_type
    when 'admin' then 4
    else 6
  end;

  if prefix is null then
    raise exception 'Unsupported reference code type: %', p_code_type;
  end if;

  insert into public.reference_counters as counters (code_type, next_value)
  values (p_code_type, 2)
  on conflict (code_type)
  do update set next_value = counters.next_value + 1
  returning counters.next_value - 1 into value;

  return prefix || lpad(value::text, width, '0');
end;
$$;

revoke all on function public.next_reference_code(text) from public;

create or replace function public.assign_profile_reference_code()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.reference_code is null
     or (new.role = 'admin' and new.reference_code not like 'adm%')
     or (new.role <> 'admin' and new.role = 'provider' and new.reference_code not like 'cam%')
     or (new.role <> 'admin' and new.role <> 'provider' and new.requested_role <> 'provider' and new.reference_code not like 'user%')
  then
    new.reference_code := public.next_reference_code(
      case
        when new.role = 'admin' then 'admin'
        when new.role = 'provider' or new.requested_role = 'provider' then 'provider'
        else 'student'
      end
    );
  end if;
  return new;
end;
$$;

drop trigger if exists assign_profile_reference_code on public.profiles;
create trigger assign_profile_reference_code
before insert or update of role, requested_role on public.profiles
for each row execute procedure public.assign_profile_reference_code();

create or replace function public.assign_listing_reference_code()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.reference_code is null then
    new.reference_code := public.next_reference_code(
      case
        when tg_table_name = 'accommodations' then 'property'
        when new.listing_type = 'service' then 'service'
        else 'product'
      end
    );
  end if;
  return new;
end;
$$;

drop trigger if exists assign_accommodation_reference_code on public.accommodations;
create trigger assign_accommodation_reference_code
before insert on public.accommodations
for each row execute procedure public.assign_listing_reference_code();

drop trigger if exists assign_marketplace_reference_code on public.marketplace_items;
create trigger assign_marketplace_reference_code
before insert on public.marketplace_items
for each row execute procedure public.assign_listing_reference_code();

-- Backfill existing rows once, without changing their UUID primary keys.
update public.profiles
set reference_code = public.next_reference_code(
  case
    when role = 'admin' then 'admin'
    when role = 'provider' or requested_role = 'provider' then 'provider'
    else 'student'
  end
)
where reference_code is null;

update public.accommodations
set reference_code = public.next_reference_code('property')
where reference_code is null;

update public.marketplace_items
set reference_code = public.next_reference_code(
  case when listing_type = 'service' then 'service' else 'product' end
)
where reference_code is null;

-- Admins need to see the directory and review records, but normal users do not.
drop policy if exists "Admins can read all profiles" on public.profiles;
create policy "Admins can read all profiles"
  on public.profiles for select
  to authenticated
  using (public.is_admin());

drop policy if exists "Admins can review profiles" on public.profiles;
create policy "Admins can review profiles"
  on public.profiles for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can read verification documents" on public.verification_documents;
create policy "Admins can read verification documents"
  on public.verification_documents for select
  to authenticated
  using (public.is_admin());

drop policy if exists "Admins can review verification documents" on public.verification_documents;
create policy "Admins can review verification documents"
  on public.verification_documents for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create index if not exists profiles_reference_code_idx
  on public.profiles(reference_code);

create index if not exists verification_documents_status_idx
  on public.verification_documents(status, created_at desc);
