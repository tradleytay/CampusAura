-- Let provider applicants view their own listings and analytics while pending.
-- Listing insert, update, and delete policies remain approval-gated.
-- Apply after analytics.sql and the provider/profile upgrade scripts.

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
  requesting_requested_role text;
begin
  select role, requested_role
    into requesting_role, requesting_requested_role
  from public.profiles
  where id = auth.uid();

  if requesting_role is distinct from 'admin'
    and requesting_role is distinct from 'provider'
    and requesting_requested_role is distinct from 'provider' then
    raise exception 'Provider account access is required';
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
