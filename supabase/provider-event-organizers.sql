-- Run after admin-dashboard-controls.sql.
-- Enables approved event organizers to submit events for administrator review
-- without granting them accommodation or marketplace listing access.

begin;

alter table public.profiles
  drop constraint if exists profiles_provider_listing_access_check;

alter table public.profiles
  add constraint profiles_provider_listing_access_check
  check (
    provider_listing_access is null
    or (
      cardinality(provider_listing_access) between 1 and 3
      and provider_listing_access <@ array['accommodation', 'marketplace', 'events']::text[]
      and cardinality(provider_listing_access) =
        (case when 'accommodation' = any(provider_listing_access) then 1 else 0 end)
        + (case when 'marketplace' = any(provider_listing_access) then 1 else 0 end)
        + (case when 'events' = any(provider_listing_access) then 1 else 0 end)
    )
  );

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  provider_access text[];
begin
  if new.raw_user_meta_data ->> 'requested_role' = 'provider' then
    provider_access := array[
      case
        when new.raw_user_meta_data ->> 'provider_listing_type' = 'marketplace' then 'marketplace'
        when new.raw_user_meta_data ->> 'provider_listing_type' = 'events' then 'events'
        else 'accommodation'
      end
    ];
  end if;

  insert into public.profiles (
    id, full_name, email, phone, requested_role, verification_status, provider_listing_access
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    lower(btrim(new.email)),
    new.raw_user_meta_data ->> 'phone',
    case
      when new.raw_user_meta_data ->> 'requested_role' = 'provider' then 'provider'
      else 'student'
    end,
    'pending',
    provider_access
  )
  on conflict (id) do update set
    full_name = excluded.full_name,
    email = excluded.email,
    phone = excluded.phone,
    requested_role = excluded.requested_role;
  return new;
end;
$$;

create or replace function public.has_provider_listing_access(p_section text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_section in ('accommodation', 'marketplace', 'events')
    and (
      public.is_admin()
      or (
        public.has_provider_access()
        and exists (
          select 1
          from public.profiles
          where id = auth.uid()
            and (
              (provider_listing_access is null and p_section in ('accommodation', 'marketplace'))
              or p_section = any(provider_listing_access)
            )
        )
      )
    );
$$;

alter table public.events
  add column if not exists organizer_name text;

drop policy if exists "Users can create events" on public.events;
create policy "Users can create events"
  on public.events for insert
  to authenticated
  with check (
    organizer_id = auth.uid()
    and (
      public.is_admin()
      or (public.has_provider_listing_access('events') and status = 'draft')
    )
  );

drop policy if exists "Organizers can update events" on public.events;
create policy "Organizers can update events"
  on public.events for update
  to authenticated
  using (
    (organizer_id = auth.uid() and public.has_provider_listing_access('events'))
    or public.is_admin()
  )
  with check (
    (organizer_id = auth.uid() and public.has_provider_listing_access('events'))
    or public.is_admin()
  );

drop policy if exists "Organizers can delete events" on public.events;
create policy "Organizers can delete events"
  on public.events for delete
  to authenticated
  using (
    (organizer_id = auth.uid() and public.has_provider_listing_access('events'))
    or public.is_admin()
  );

notify pgrst, 'reload schema';

commit;
