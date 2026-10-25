-- CampusAura consolidated upgrade
-- Run this file after supabase-schema.sql.
-- It includes provider/admin policies, verification review, reference codes,
-- and analytics support. It is safe to run more than once.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Shared access helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.has_provider_access()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select public.is_admin() or exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role = 'provider'
      and verification_status = 'approved'
  );
$$;

alter table public.profiles
  add column if not exists email text,
  add column if not exists phone text,
  add column if not exists rejection_reason text,
  add column if not exists requested_role text not null default 'student',
  add column if not exists verification_status text not null default 'pending';

alter table public.marketplace_items
  add column if not exists listing_type text not null default 'product';

alter table public.accommodations
  add column if not exists published_at timestamptz;

alter table public.marketplace_items
  add column if not exists published_at timestamptz;

alter table public.profiles
  drop constraint if exists profiles_requested_role_check;

alter table public.profiles
  add constraint profiles_requested_role_check
  check (requested_role in ('student', 'provider'));

alter table public.profiles
  drop constraint if exists profiles_verification_status_check;

alter table public.profiles
  add constraint profiles_verification_status_check
  check (verification_status in ('pending', 'approved', 'rejected'));

alter table public.marketplace_items
  drop constraint if exists marketplace_items_listing_type_check;

alter table public.marketplace_items
  add constraint marketplace_items_listing_type_check
  check (listing_type in ('product', 'service'));

create table if not exists public.verification_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  requested_role text not null check (requested_role in ('student', 'provider')),
  identity_document_path text not null,
  student_document_path text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  rejection_reason text,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint student_documents_required check (
    requested_role = 'provider' or student_document_path is not null
  )
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, phone, requested_role, verification_status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    new.email,
    new.raw_user_meta_data ->> 'phone',
    case
      when new.raw_user_meta_data ->> 'requested_role' = 'provider'
        then 'provider'
      else 'student'
    end,
    'pending'
  )
  on conflict (id) do update set
    full_name = excluded.full_name,
    email = excluded.email,
    phone = excluded.phone,
    requested_role = excluded.requested_role;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Read/write policies
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.verification_documents enable row level security;
alter table public.accommodations enable row level security;
alter table public.marketplace_items enable row level security;
alter table public.events enable row level security;
alter table public.contact_submissions enable row level security;

drop policy if exists "Users can read their profile" on public.profiles;
create policy "Users can read their profile"
  on public.profiles for select to authenticated
  using (auth.uid() = id);

drop policy if exists "Admins can read all profiles" on public.profiles;
create policy "Admins can read all profiles"
  on public.profiles for select to authenticated
  using (public.is_admin());

drop policy if exists "Users can update their profile" on public.profiles;
create policy "Users can update their profile"
  on public.profiles for update to authenticated
  using (auth.uid() = id or public.is_admin())
  with check (auth.uid() = id or public.is_admin());

drop policy if exists "Admins can review profiles" on public.profiles;
create policy "Admins can review profiles"
  on public.profiles for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Users can submit verification documents" on public.verification_documents;
create policy "Users can submit verification documents"
  on public.verification_documents for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Users can read their verification status" on public.verification_documents;
create policy "Users can read their verification status"
  on public.verification_documents for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "Admins can review verification documents" on public.verification_documents;
create policy "Admins can review verification documents"
  on public.verification_documents for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Published accommodations are public" on public.accommodations;
create policy "Published accommodations are public"
  on public.accommodations for select
  using (status = 'published' or owner_id = auth.uid() or public.is_admin());

drop policy if exists "Admins can read all accommodations" on public.accommodations;
create policy "Admins can read all accommodations"
  on public.accommodations for select to authenticated
  using (public.is_admin());

drop policy if exists "Providers can create accommodations" on public.accommodations;
create policy "Providers can create accommodations"
  on public.accommodations for insert to authenticated
  with check (owner_id = auth.uid() and public.has_provider_access());

drop policy if exists "Owners can update accommodations" on public.accommodations;
create policy "Owners can update accommodations"
  on public.accommodations for update to authenticated
  using ((owner_id = auth.uid() and public.has_provider_access()) or public.is_admin())
  with check ((owner_id = auth.uid() and public.has_provider_access()) or public.is_admin());

drop policy if exists "Owners can delete accommodations" on public.accommodations;
create policy "Owners can delete accommodations"
  on public.accommodations for delete to authenticated
  using ((owner_id = auth.uid() and public.has_provider_access()) or public.is_admin());

drop policy if exists "Published marketplace items are public" on public.marketplace_items;
create policy "Published marketplace items are public"
  on public.marketplace_items for select
  using (status = 'published' or seller_id = auth.uid() or public.is_admin());

drop policy if exists "Users can create marketplace items" on public.marketplace_items;
create policy "Users can create marketplace items"
  on public.marketplace_items for insert to authenticated
  with check (seller_id = auth.uid() and public.has_provider_access());

drop policy if exists "Owners can update marketplace items" on public.marketplace_items;
create policy "Owners can update marketplace items"
  on public.marketplace_items for update to authenticated
  using ((seller_id = auth.uid() and public.has_provider_access()) or public.is_admin())
  with check ((seller_id = auth.uid() and public.has_provider_access()) or public.is_admin());

drop policy if exists "Owners can delete marketplace items" on public.marketplace_items;
create policy "Owners can delete marketplace items"
  on public.marketplace_items for delete to authenticated
  using ((seller_id = auth.uid() and public.has_provider_access()) or public.is_admin());

drop policy if exists "Published events are public" on public.events;
create policy "Published events are public"
  on public.events for select
  using (status = 'published' or organizer_id = auth.uid() or public.is_admin());

drop policy if exists "Users can create events" on public.events;
create policy "Users can create events"
  on public.events for insert to authenticated
  with check (organizer_id = auth.uid());

drop policy if exists "Organizers can update events" on public.events;
create policy "Organizers can update events"
  on public.events for update to authenticated
  using (organizer_id = auth.uid() or public.is_admin())
  with check (organizer_id = auth.uid() or public.is_admin());

drop policy if exists "Organizers can delete events" on public.events;
create policy "Organizers can delete events"
  on public.events for delete to authenticated
  using (organizer_id = auth.uid() or public.is_admin());

drop policy if exists "Anyone can submit contact messages" on public.contact_submissions;
create policy "Anyone can submit contact messages"
  on public.contact_submissions for insert to anon, authenticated
  with check (true);

drop policy if exists "Admins can read contact messages" on public.contact_submissions;
create policy "Admins can read contact messages"
  on public.contact_submissions for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Human-readable reference codes
-- ---------------------------------------------------------------------------

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
  width := case when p_code_type = 'admin' then 4 else 6 end;

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
  if new.reference_code is null then
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
declare
  code_type text;
begin
  if new.reference_code is null then
    if tg_table_name = 'accommodations' then
      code_type := 'property';
    elsif tg_table_name = 'marketplace_items' then
      code_type := case when new.listing_type = 'service' then 'service' else 'product' end;
    else
      raise exception 'Unsupported listing table: %', tg_table_name;
    end if;
    new.reference_code := public.next_reference_code(code_type);
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

-- ---------------------------------------------------------------------------
-- Analytics
-- ---------------------------------------------------------------------------

create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles(id) on delete set null,
  event_name text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_name_date_idx
  on public.analytics_events(event_name, created_at desc);

create index if not exists analytics_events_user_date_idx
  on public.analytics_events(user_id, created_at desc);

alter table public.analytics_events enable row level security;

drop policy if exists "Users can create analytics events" on public.analytics_events;
create policy "Users can create analytics events"
  on public.analytics_events for insert
  to anon, authenticated
  with check (user_id is null or user_id = auth.uid());

drop policy if exists "Admins can read analytics events" on public.analytics_events;
create policy "Admins can read analytics events"
  on public.analytics_events for select
  to authenticated
  using (public.is_admin());

create or replace function public.record_analytics_event(
  p_event_name text,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if nullif(trim(p_event_name), '') is null then
    raise exception 'Analytics event name is required';
  end if;

  insert into public.analytics_events (
    user_id, event_name, entity_type, entity_id, metadata
  )
  values (
    auth.uid(), trim(p_event_name), p_entity_type, p_entity_id,
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.record_analytics_event(text, text, uuid, jsonb) from public;
grant execute on function public.record_analytics_event(text, text, uuid, jsonb) to anon, authenticated;

create or replace view public.admin_analytics_summary
with (security_invoker = true)
as
select
  (select count(*) from public.profiles) as total_users,
  (select count(*) from public.profiles where role = 'student') as total_students,
  (select count(*) from public.profiles where role = 'provider') as total_providers,
  (select count(*) from public.profiles where verification_status = 'pending') as pending_verifications,
  (select count(*) from public.accommodations where status = 'published') as published_properties,
  (select count(*) from public.marketplace_items where status = 'published') as published_marketplace_items,
  (select count(*) from public.events where status = 'published') as published_events,
  (select count(*) from public.analytics_events where created_at >= now() - interval '30 days') as events_last_30_days;

create or replace view public.admin_analytics_daily
with (security_invoker = true)
as
select
  date_trunc('day', created_at)::date as day,
  event_name,
  count(*) as event_count
from public.analytics_events
where created_at >= now() - interval '30 days'
group by date_trunc('day', created_at)::date, event_name;

create index if not exists profiles_reference_code_idx
  on public.profiles(reference_code);

create index if not exists verification_documents_status_idx
  on public.verification_documents(status, created_at desc);
