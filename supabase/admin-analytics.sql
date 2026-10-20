-- Admin-only, aggregated data for the Admin Analytics dashboard.
-- Run after supabase-upgrade.sql, supabase-campus-upgrade.sql, and analytics.sql.

create or replace function public.get_admin_analytics(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  requested_days integer := least(greatest(coalesce(p_days, 30), 7), 90);
  first_day date := current_date - (least(greatest(coalesce(p_days, 30), 7), 90) - 1);
  report jsonb;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Administrator access is required';
  end if;

  select jsonb_build_object(
    'generated_at', now(),
    'period_days', requested_days,
    'metrics', jsonb_build_object(
      'total_users', (select count(*) from public.profiles),
      'new_users', (select count(*) from public.profiles where created_at >= first_day::timestamptz),
      'total_students', (select count(*) from public.profiles where coalesce(requested_role, role) = 'student'),
      'total_providers', (select count(*) from public.profiles where coalesce(requested_role, role) = 'provider'),
      'pending_verifications', (select count(*) from public.profiles where verification_status = 'pending'),
      'published_listings',
        (select count(*) from public.accommodations where status = 'published')
        + (select count(*) from public.marketplace_items where status = 'published'),
      'listing_views', (
        select count(*) from public.analytics_events
        where event_name = 'listing_view'
          and created_at >= first_day::timestamptz
          and created_at < (current_date + 1)::timestamptz
      ),
      'listing_inquiries', (
        select count(*) from public.analytics_events
        where event_name = 'listing_inquiry'
          and created_at >= first_day::timestamptz
          and created_at < (current_date + 1)::timestamptz
      ),
      'published_events', (select count(*) from public.events where status = 'published'),
      'upcoming_rsvps', (
        select count(*)
        from public.rsvps rsvp
        join public.events event on event.id = rsvp.event_id
        where event.status = 'published' and event.event_date >= now()
      )
    ),
    'daily', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'day', calendar.day::date,
          'signups', coalesce(signups.event_count, 0),
          'listing_views', coalesce(listing_views.event_count, 0),
          'listing_inquiries', coalesce(listing_inquiries.event_count, 0)
        ) order by calendar.day
      )
      from generate_series(first_day, current_date, interval '1 day') as calendar(day)
      left join (
        select created_at::date as day, count(*) as event_count
        from public.profiles
        where created_at >= first_day::timestamptz and created_at < (current_date + 1)::timestamptz
        group by created_at::date
      ) signups on signups.day = calendar.day::date
      left join (
        select created_at::date as day, count(*) as event_count
        from public.analytics_events
        where event_name = 'listing_view'
          and created_at >= first_day::timestamptz
          and created_at < (current_date + 1)::timestamptz
        group by created_at::date
      ) listing_views on listing_views.day = calendar.day::date
      left join (
        select created_at::date as day, count(*) as event_count
        from public.analytics_events
        where event_name = 'listing_inquiry'
          and created_at >= first_day::timestamptz
          and created_at < (current_date + 1)::timestamptz
        group by created_at::date
      ) listing_inquiries on listing_inquiries.day = calendar.day::date
    ), '[]'::jsonb),
    'top_listings', coalesce((
      select jsonb_agg(to_jsonb(top_listing) order by top_listing.views desc, top_listing.inquiries desc, top_listing.title)
      from (
        select listing.title, listing.entity_type, listing.views, listing.inquiries
        from (
          select
            accommodation.id,
            accommodation.title,
            'accommodation'::text as entity_type,
            count(event.id) filter (where event.event_name = 'listing_view') as views,
            count(event.id) filter (where event.event_name = 'listing_inquiry') as inquiries
          from public.accommodations accommodation
          left join public.analytics_events event
            on event.entity_type = 'accommodation'
            and event.entity_id = accommodation.id
            and event.created_at >= first_day::timestamptz
            and event.created_at < (current_date + 1)::timestamptz
            and event.event_name in ('listing_view', 'listing_inquiry')
          where accommodation.status = 'published'
          group by accommodation.id, accommodation.title
          union all
          select
            marketplace.id,
            marketplace.title,
            'marketplace'::text as entity_type,
            count(event.id) filter (where event.event_name = 'listing_view') as views,
            count(event.id) filter (where event.event_name = 'listing_inquiry') as inquiries
          from public.marketplace_items marketplace
          left join public.analytics_events event
            on event.entity_type = 'marketplace'
            and event.entity_id = marketplace.id
            and event.created_at >= first_day::timestamptz
            and event.created_at < (current_date + 1)::timestamptz
            and event.event_name in ('listing_view', 'listing_inquiry')
          where marketplace.status = 'published'
          group by marketplace.id, marketplace.title
        ) listing
        order by listing.views desc, listing.inquiries desc, listing.title
        limit 5
      ) top_listing
    ), '[]'::jsonb)
  ) into report;

  return report;
end;
$$;

revoke all on function public.get_admin_analytics(integer) from public, anon;
grant execute on function public.get_admin_analytics(integer) to authenticated;

notify pgrst, 'reload schema';
