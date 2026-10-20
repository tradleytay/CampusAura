-- Admin account freeze controls.
-- Run after the CampusAura schema, hardening, and student-onboarding migrations.

begin;

alter table public.profiles
  add column if not exists account_status text not null default 'active',
  add column if not exists frozen_at timestamptz,
  add column if not exists frozen_reason text;

alter table public.profiles drop constraint if exists profiles_account_status_check;
alter table public.profiles add constraint profiles_account_status_check
  check (account_status in ('active', 'frozen'));

alter table public.accommodations
  add column if not exists account_freeze_hidden boolean not null default false;
alter table public.marketplace_items
  add column if not exists account_freeze_hidden boolean not null default false;

create or replace function public.has_active_account_access()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.is_admin() or exists (
    select 1 from public.profiles
    where id = auth.uid() and account_status = 'active'
  );
$$;
revoke all on function public.has_active_account_access() from public;
grant execute on function public.has_active_account_access() to anon, authenticated;

create or replace function public.has_provider_access()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.is_admin() or exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role = 'provider'
      and verification_status = 'approved'
      and account_status = 'active'
  );
$$;

create or replace function public.prevent_self_account_freeze_changes()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() = old.id and not public.is_admin()
    and (
      old.account_status is distinct from new.account_status
      or old.frozen_at is distinct from new.frozen_at
      or old.frozen_reason is distinct from new.frozen_reason
    ) then
    raise exception 'Only an administrator can change account access status';
  end if;
  return new;
end;
$$;
drop trigger if exists protect_account_freeze_status on public.profiles;
create trigger protect_account_freeze_status
  before update on public.profiles
  for each row execute procedure public.prevent_self_account_freeze_changes();

create or replace function public.admin_set_account_status(
  p_user_id uuid,
  p_status text,
  p_reason text default null
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  reason text := nullif(trim(p_reason), '');
  target_role text;
begin
  if not public.is_admin() then raise exception 'Administrator access is required'; end if;
  if p_status is null or p_status not in ('active', 'frozen') then
    raise exception 'Account status must be active or frozen';
  end if;
  if p_status = 'frozen' and reason is null then
    raise exception 'A reason is required when freezing an account';
  end if;

  select role into target_role from public.profiles where id = p_user_id for update;
  if not found then raise exception 'Account profile not found'; end if;
  if target_role = 'admin' then raise exception 'Administrator accounts cannot be frozen here'; end if;

  update public.profiles
  set account_status = p_status,
      frozen_at = case when p_status = 'frozen' then now() else null end,
      frozen_reason = case when p_status = 'frozen' then reason else null end
  where id = p_user_id;

  update public.accommodations
  set account_freeze_hidden = (p_status = 'frozen')
  where owner_id = p_user_id;
  update public.marketplace_items
  set account_freeze_hidden = (p_status = 'frozen')
  where seller_id = p_user_id;
end;
$$;
revoke all on function public.admin_set_account_status(uuid, text, text) from public;
grant execute on function public.admin_set_account_status(uuid, text, text) to authenticated;

-- Remove a frozen provider's own listings from public feeds without deleting them.
drop policy if exists "Published accommodations are public" on public.accommodations;
drop policy if exists "Owners can read their accommodations" on public.accommodations;
drop policy if exists "Admins can read all accommodations" on public.accommodations;
drop policy if exists "Active accounts can read published accommodations" on public.accommodations;
create policy "Active accounts can read published accommodations"
  on public.accommodations for select
  using (
    public.is_admin()
    or (owner_id = auth.uid() and public.has_active_account_access())
    or (status = 'published' and not account_freeze_hidden)
  );

drop policy if exists "Published marketplace items are public" on public.marketplace_items;
drop policy if exists "Owners can read marketplace items" on public.marketplace_items;
drop policy if exists "Admins can read all marketplace items" on public.marketplace_items;
drop policy if exists "Active accounts can read published marketplace items" on public.marketplace_items;
create policy "Active accounts can read published marketplace items"
  on public.marketplace_items for select
  using (
    public.is_admin()
    or (seller_id = auth.uid() and public.has_active_account_access())
    or (status = 'published' and not account_freeze_hidden)
  );

drop policy if exists "Users can read their saved listings" on public.saved_listings;
drop policy if exists "Active users can read their saved listings" on public.saved_listings;
create policy "Active users can read their saved listings"
  on public.saved_listings for select to authenticated
  using (user_id = auth.uid() and public.has_active_account_access());
drop policy if exists "Users can save listings" on public.saved_listings;
drop policy if exists "Active users can save listings" on public.saved_listings;
create policy "Active users can save listings"
  on public.saved_listings for insert to authenticated
  with check (user_id = auth.uid() and public.has_active_account_access());
drop policy if exists "Users can remove saved listings" on public.saved_listings;
drop policy if exists "Active users can remove saved listings" on public.saved_listings;
create policy "Active users can remove saved listings"
  on public.saved_listings for delete to authenticated
  using (user_id = auth.uid() and public.has_active_account_access());

drop policy if exists "Users can read their RSVPs" on public.rsvps;
drop policy if exists "Active users can read their RSVPs" on public.rsvps;
create policy "Active users can read their RSVPs"
  on public.rsvps for select to authenticated
  using (user_id = auth.uid() and public.has_active_account_access());
drop policy if exists "Users can create their RSVPs" on public.rsvps;
drop policy if exists "Active users can create RSVPs" on public.rsvps;
create policy "Active users can create RSVPs"
  on public.rsvps for insert to authenticated
  with check (user_id = auth.uid() and public.has_active_account_access());
drop policy if exists "Users can delete their RSVPs" on public.rsvps;
drop policy if exists "Active users can delete their RSVPs" on public.rsvps;
create policy "Active users can delete their RSVPs"
  on public.rsvps for delete to authenticated
  using (user_id = auth.uid() and public.has_active_account_access());

-- Preserve the strict ownership, document-path, and storage-object checks while
-- requiring an active account to submit a verification document.
drop policy if exists "Users can submit account verification documents" on public.verification_documents;
drop policy if exists "Users can submit verification documents" on public.verification_documents;
drop policy if exists "Users can submit provider verification documents" on public.verification_documents;
drop policy if exists "Active users can submit account verification documents" on public.verification_documents;
create policy "Active users can submit account verification documents"
  on public.verification_documents for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.has_active_account_access()
    and status = 'pending'
    and reviewed_at is null
    and reviewed_by is null
    and rejection_reason is null
    and requested_role = (select profile.requested_role from public.profiles profile where profile.id = auth.uid())
    and (
      (
        requested_role = 'provider'
        and identity_document_path is not null
        and (storage.foldername(identity_document_path))[1] = auth.uid()::text
        and exists (select 1 from storage.objects object where object.bucket_id = 'verification-documents' and object.name = identity_document_path)
      )
      or
      (
        requested_role = 'student'
        and identity_document_path is null
        and student_document_path is not null
        and (storage.foldername(student_document_path))[1] = auth.uid()::text
        and exists (select 1 from storage.objects object where object.bucket_id = 'verification-documents' and object.name = student_document_path)
      )
    )
  );

drop policy if exists "Users can read their verification status" on public.verification_documents;
drop policy if exists "Active users can read their verification status" on public.verification_documents;
create policy "Active users can read their verification status"
  on public.verification_documents for select to authenticated
  using ((user_id = auth.uid() and public.has_active_account_access()) or public.is_admin());

drop policy if exists "Users can upload their verification documents" on storage.objects;
drop policy if exists "Active users can upload verification documents" on storage.objects;
create policy "Active users can upload verification documents"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'verification-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.has_active_account_access()
  );
drop policy if exists "Users can read their verification documents" on storage.objects;
drop policy if exists "Active users can read their verification documents" on storage.objects;
create policy "Active users can read their verification documents"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'verification-documents'
    and ((storage.foldername(name))[1] = auth.uid()::text and public.has_active_account_access() or public.is_admin())
  );

drop policy if exists "Providers can upload listing images" on storage.objects;
drop policy if exists "Active providers can upload listing images" on storage.objects;
create policy "Active providers can upload listing images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'listing-images' and (storage.foldername(name))[1] = auth.uid()::text and public.has_provider_access());
drop policy if exists "Providers can update listing images" on storage.objects;
drop policy if exists "Active providers can update listing images" on storage.objects;
create policy "Active providers can update listing images"
  on storage.objects for update to authenticated
  using (bucket_id = 'listing-images' and (storage.foldername(name))[1] = auth.uid()::text and public.has_provider_access())
  with check (bucket_id = 'listing-images' and (storage.foldername(name))[1] = auth.uid()::text and public.has_provider_access());
drop policy if exists "Providers can delete listing images" on storage.objects;
drop policy if exists "Active providers can delete listing images" on storage.objects;
create policy "Active providers can delete listing images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'listing-images' and (storage.foldername(name))[1] = auth.uid()::text and public.has_provider_access());

create or replace function public.get_listing_contacts(p_profile_ids uuid[])
returns table (id uuid, full_name text, phone text)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_active_account_access() or not exists (
    select 1 from public.profiles viewer
    where viewer.id = auth.uid()
      and (viewer.role = 'admin' or viewer.role = 'student' or (viewer.role = 'provider' and viewer.verification_status = 'approved'))
  ) then
    raise exception 'An active student, approved provider, or administrator account is required to view listing contact details';
  end if;

  return query
  select profile.id, profile.full_name, profile.phone
  from public.profiles profile
  where profile.id = any(coalesce(p_profile_ids, array[]::uuid[]))
    and profile.account_status = 'active'
    and (
      exists (select 1 from public.accommodations listing where listing.owner_id = profile.id and listing.status = 'published')
      or exists (select 1 from public.marketplace_items listing where listing.seller_id = profile.id and listing.status = 'published')
    );
end;
$$;
revoke all on function public.get_listing_contacts(uuid[]) from public;
grant execute on function public.get_listing_contacts(uuid[]) to authenticated;

create or replace function public.get_provider_listing_analytics()
returns table (entity_type text, entity_id uuid, view_count bigint, inquiry_count bigint)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  requesting_role text;
  requesting_requested_role text;
begin
  select role, requested_role into requesting_role, requesting_requested_role
  from public.profiles where id = auth.uid();

  if not public.has_active_account_access() then
    raise exception 'An active account is required to view provider analytics';
  end if;
  if requesting_role is distinct from 'admin'
    and requesting_role is distinct from 'provider'
    and requesting_requested_role is distinct from 'provider' then
    raise exception 'Provider account access is required';
  end if;

  return query
  select 'accommodation'::text, listing.id,
    count(event.id) filter (where event.event_name = 'listing_view'),
    count(event.id) filter (where event.event_name = 'listing_inquiry')
  from public.accommodations listing
  left join public.analytics_events event on event.entity_type = 'accommodation' and event.entity_id = listing.id
  where listing.owner_id = auth.uid() or requesting_role = 'admin'
  group by listing.id
  union all
  select 'marketplace'::text, listing.id,
    count(event.id) filter (where event.event_name = 'listing_view'),
    count(event.id) filter (where event.event_name = 'listing_inquiry')
  from public.marketplace_items listing
  left join public.analytics_events event on event.entity_type = 'marketplace' and event.entity_id = listing.id
  where listing.seller_id = auth.uid() or requesting_role = 'admin'
  group by listing.id;
end;
$$;
revoke all on function public.get_provider_listing_analytics() from public;
grant execute on function public.get_provider_listing_analytics() to authenticated;

commit;
