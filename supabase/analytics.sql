-- Listing analytics and live provider dashboard updates.
-- Run after supabase-schema.sql and the provider/profile upgrade scripts.

create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles(id) on delete set null,
  event_name text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_listing_idx
  on public.analytics_events(entity_type, entity_id, event_name);

alter table public.analytics_events enable row level security;
grant select on public.analytics_events to authenticated;
grant usage, select on sequence public.analytics_events_id_seq to authenticated;

drop policy if exists "Providers can read analytics for their listings" on public.analytics_events;
create policy "Providers can read analytics for their listings"
  on public.analytics_events for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles profile
      where profile.id = auth.uid() and profile.role = 'admin'
    )
    or (
      entity_type = 'accommodation'
      and exists (
        select 1 from public.accommodations listing
        where listing.id = entity_id and listing.owner_id = auth.uid()
      )
    )
    or (
      entity_type = 'marketplace'
      and exists (
        select 1 from public.marketplace_items listing
        where listing.id = entity_id and listing.seller_id = auth.uid()
      )
    )
  );

drop policy if exists "Admins can read analytics events" on public.analytics_events;
create policy "Admins can read analytics events"
  on public.analytics_events for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles profile
      where profile.id = auth.uid() and profile.role = 'admin'
    )
  );

create or replace function public.record_listing_analytics_event(
  p_event_name text,
  p_entity_type text,
  p_entity_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  listing_owner_id uuid;
begin
  if p_event_name is null
    or p_event_name not in ('listing_view', 'listing_inquiry')
    or p_entity_type is null
    or p_entity_type not in ('accommodation', 'marketplace')
    or p_entity_id is null then
    raise exception 'Invalid listing analytics event';
  end if;

  if p_entity_type = 'accommodation' then
    select owner_id into listing_owner_id
    from public.accommodations
    where id = p_entity_id and status = 'published';
  else
    select seller_id into listing_owner_id
    from public.marketplace_items
    where id = p_entity_id and status = 'published';
  end if;

  if not found then
    raise exception 'Published listing not found';
  end if;

  if listing_owner_id is not distinct from auth.uid() then
    return;
  end if;

  insert into public.analytics_events (user_id, event_name, entity_type, entity_id)
  values (auth.uid(), p_event_name, p_entity_type, p_entity_id);
end;
$$;

revoke all on function public.record_listing_analytics_event(text, text, uuid) from public;
grant execute on function public.record_listing_analytics_event(text, text, uuid) to anon, authenticated;

create or replace function public.get_provider_listing_analytics()
returns table (
  entity_type text,
  entity_id uuid,
  view_count bigint,
  inquiry_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  requesting_role text;
  requesting_status text;
begin
  select role, verification_status into requesting_role, requesting_status
  from public.profiles
  where id = auth.uid();

  if requesting_role is distinct from 'admin'
    and (requesting_role is distinct from 'provider' or requesting_status is distinct from 'approved') then
    raise exception 'Approved provider access is required';
  end if;

  return query
  select
    'accommodation'::text,
    listing.id,
    count(event.id) filter (where event.event_name = 'listing_view'),
    count(event.id) filter (where event.event_name = 'listing_inquiry')
  from public.accommodations listing
  left join public.analytics_events event
    on event.entity_type = 'accommodation' and event.entity_id = listing.id
  where listing.owner_id = auth.uid() or requesting_role = 'admin'
  group by listing.id

  union all

  select
    'marketplace'::text,
    listing.id,
    count(event.id) filter (where event.event_name = 'listing_view'),
    count(event.id) filter (where event.event_name = 'listing_inquiry')
  from public.marketplace_items listing
  left join public.analytics_events event
    on event.entity_type = 'marketplace' and event.entity_id = listing.id
  where listing.seller_id = auth.uid() or requesting_role = 'admin'
  group by listing.id;
end;
$$;

revoke all on function public.get_provider_listing_analytics() from public;
grant execute on function public.get_provider_listing_analytics() to authenticated;

do $$
declare
  realtime_table text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'Supabase Realtime publication is missing';
  end if;

  foreach realtime_table in array array['accommodations', 'marketplace_items', 'analytics_events']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = realtime_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', realtime_table);
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
