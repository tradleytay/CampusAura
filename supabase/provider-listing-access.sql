-- Run after launch-hardening.sql and account-freeze-controls.sql.
-- New provider accounts receive one listing section. Existing providers retain
-- legacy access (NULL) until an administrator reviews and assigns their sections.

begin;

alter table public.profiles
  add column if not exists provider_listing_access text[];

alter table public.profiles
  drop constraint if exists profiles_provider_listing_access_check;

alter table public.profiles
  add constraint profiles_provider_listing_access_check
  check (
    provider_listing_access is null
    or (
      cardinality(provider_listing_access) between 1 and 2
      and provider_listing_access <@ array['accommodation', 'marketplace']::text[]
      and cardinality(provider_listing_access) =
        (case when 'accommodation' = any(provider_listing_access) then 1 else 0 end)
        + (case when 'marketplace' = any(provider_listing_access) then 1 else 0 end)
    )
  );

alter table public.marketplace_items
  add column if not exists seller_display_name text;

alter table public.marketplace_items
  drop constraint if exists marketplace_items_seller_display_name_check;

alter table public.marketplace_items
  add constraint marketplace_items_seller_display_name_check
  check (
    seller_display_name is null
    or (length(btrim(seller_display_name)) between 1 and 100)
  );

do $$
begin
  if exists (
    select 1
    from public.profiles
    where email is not null and btrim(email) <> ''
    group by lower(btrim(email))
    having count(*) > 1
  ) then
    raise exception 'Duplicate profile email addresses exist. Reconcile those profiles before applying the unique email index; no accounts were deleted.';
  end if;
end;
$$;

create unique index if not exists profiles_email_normalized_uidx
  on public.profiles (lower(btrim(email)))
  where email is not null and btrim(email) <> '';

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
  select p_section in ('accommodation', 'marketplace')
    and (
      public.is_admin()
      or (
        public.has_provider_access()
        and exists (
          select 1
          from public.profiles
          where id = auth.uid()
            and (
              provider_listing_access is null
              or p_section = any(provider_listing_access)
            )
        )
      )
    );
$$;

revoke all on function public.has_provider_listing_access(text) from public;
grant execute on function public.has_provider_listing_access(text) to anon, authenticated;

create or replace function public.prevent_self_provider_listing_access_changes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.provider_listing_access is distinct from new.provider_listing_access
    and not public.is_admin() then
    raise exception 'Only an administrator can change provider listing access';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_provider_listing_access on public.profiles;
create trigger protect_provider_listing_access
  before update on public.profiles
  for each row execute procedure public.prevent_self_provider_listing_access_changes();

drop policy if exists "Providers can create accommodations" on public.accommodations;
create policy "Providers can create accommodations"
  on public.accommodations for insert
  to authenticated
  with check (
    owner_id = auth.uid()
    and (
      public.is_admin()
      or (
        public.has_provider_listing_access('accommodation')
        and status = 'pending'
        and not verified
      )
    )
  );

drop policy if exists "Owners can update accommodations" on public.accommodations;
create policy "Owners can update accommodations"
  on public.accommodations for update
  to authenticated
  using (
    (owner_id = auth.uid() and public.has_provider_listing_access('accommodation'))
    or public.is_admin()
  )
  with check (
    (owner_id = auth.uid() and public.has_provider_listing_access('accommodation'))
    or public.is_admin()
  );

drop policy if exists "Owners can delete accommodations" on public.accommodations;
create policy "Owners can delete accommodations"
  on public.accommodations for delete
  to authenticated
  using (
    (owner_id = auth.uid() and public.has_provider_listing_access('accommodation'))
    or public.is_admin()
  );

drop policy if exists "Users can create marketplace items" on public.marketplace_items;
create policy "Users can create marketplace items"
  on public.marketplace_items for insert
  to authenticated
  with check (
    seller_id = auth.uid()
    and (
      public.is_admin()
      or (
        public.has_provider_listing_access('marketplace')
        and status = 'pending'
      )
    )
  );

drop policy if exists "Owners can update marketplace items" on public.marketplace_items;
create policy "Owners can update marketplace items"
  on public.marketplace_items for update
  to authenticated
  using (
    (seller_id = auth.uid() and public.has_provider_listing_access('marketplace'))
    or public.is_admin()
  )
  with check (
    (seller_id = auth.uid() and public.has_provider_listing_access('marketplace'))
    or public.is_admin()
  );

drop policy if exists "Owners can delete marketplace items" on public.marketplace_items;
create policy "Owners can delete marketplace items"
  on public.marketplace_items for delete
  to authenticated
  using (
    (seller_id = auth.uid() and public.has_provider_listing_access('marketplace'))
    or public.is_admin()
  );

notify pgrst, 'reload schema';

commit;
