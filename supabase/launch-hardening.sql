-- Run after the schema, provider, final, and analytics migrations.
-- Prevent self-service changes to verification and account privilege fields.

create or replace function public.prevent_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() and (
    old.id is distinct from new.id
    or old.role is distinct from new.role
    or old.requested_role is distinct from new.requested_role
    or old.verification_status is distinct from new.verification_status
    or old.rejection_reason is distinct from new.rejection_reason
    or old.reference_code is distinct from new.reference_code
    or old.email is distinct from new.email
    or old.created_at is distinct from new.created_at
  ) then
    raise exception 'Only an administrator can change protected account fields';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_role on public.profiles;
create trigger protect_profile_role
  before update on public.profiles
  for each row execute procedure public.prevent_role_escalation();

create or replace function public.prevent_unreviewed_accommodation_changes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() and (
    old.status is distinct from new.status
    or old.verified is distinct from new.verified
  ) then
    raise exception 'Only an administrator can change accommodation review status';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_accommodation_review_status on public.accommodations;
create trigger protect_accommodation_review_status
  before update on public.accommodations
  for each row execute procedure public.prevent_unreviewed_accommodation_changes();

create or replace function public.prevent_unreviewed_marketplace_changes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() and (
    old.status in ('pending', 'rejected')
    or new.status in ('pending', 'published', 'rejected')
  ) and old.status is distinct from new.status then
    raise exception 'Only an administrator can change marketplace review status';
  end if;
  return new;
end;
$$;

alter table public.marketplace_items
  drop constraint if exists marketplace_items_status_check;
alter table public.marketplace_items
  add constraint marketplace_items_status_check
  check (status in ('pending', 'published', 'sold', 'removed', 'rejected'));

drop trigger if exists protect_marketplace_review_status on public.marketplace_items;
create trigger protect_marketplace_review_status
  before update on public.marketplace_items
  for each row execute procedure public.prevent_unreviewed_marketplace_changes();

drop policy if exists "Users can create marketplace items" on public.marketplace_items;
create policy "Users can create marketplace items"
  on public.marketplace_items for insert
  to authenticated
  with check (
    seller_id = auth.uid()
    and (
      public.is_admin()
      or (public.has_provider_access() and status = 'pending')
    )
  );

drop policy if exists "Providers can create accommodations" on public.accommodations;
create policy "Providers can create accommodations"
  on public.accommodations for insert
  to authenticated
  with check (
    owner_id = auth.uid()
    and (
      public.is_admin()
      or (public.has_provider_access() and status = 'pending' and not verified)
    )
  );

create or replace function public.admin_review_user(
  p_user_id uuid,
  p_status text,
  p_rejection_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  reason text := nullif(trim(p_rejection_reason), '');
begin
  if not public.is_admin() then
    raise exception 'Administrator access is required';
  end if;
  if p_status is null or p_status not in ('approved', 'rejected') then
    raise exception 'Review status must be approved or rejected';
  end if;
  if p_status = 'rejected' and reason is null then
    raise exception 'A rejection reason is required';
  end if;

  perform 1 from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'Account profile not found';
  end if;
  perform 1
  from public.verification_documents
  where user_id = p_user_id and status = 'pending'
  for update;
  if not found then
    raise exception 'No pending verification documents were found';
  end if;

  update public.profiles
  set verification_status = p_status,
      rejection_reason = case when p_status = 'rejected' then reason else null end,
      role = case when p_status = 'approved' then requested_role else role end
  where id = p_user_id;

  update public.verification_documents
  set status = p_status,
      rejection_reason = case when p_status = 'rejected' then reason else null end,
      reviewed_at = now(),
      reviewed_by = auth.uid()
  where user_id = p_user_id and status = 'pending';
end;
$$;

revoke all on function public.admin_review_user(uuid, text, text) from public;
grant execute on function public.admin_review_user(uuid, text, text) to authenticated;

-- Apply the same server-side limits as the verification form.
update storage.buckets
set public = false,
    file_size_limit = 5242880,
    allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png']
where id = 'verification-documents';

drop policy if exists "Users can submit verification documents" on public.verification_documents;
create policy "Users can submit verification documents"
  on public.verification_documents for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and status = 'pending'
    and reviewed_at is null
    and reviewed_by is null
    and rejection_reason is null
    and requested_role = (
      select profile.requested_role
      from public.profiles profile
      where profile.id = auth.uid()
    )
    and (storage.foldername(identity_document_path))[1] = auth.uid()::text
    and exists (
      select 1 from storage.objects object
      where object.bucket_id = 'verification-documents'
        and object.name = identity_document_path
    )
    and (
      requested_role = 'provider'
      or (
        student_document_path is not null
        and (storage.foldername(student_document_path))[1] = auth.uid()::text
        and exists (
          select 1 from storage.objects object
          where object.bucket_id = 'verification-documents'
            and object.name = student_document_path
        )
      )
    )
  );

drop policy if exists "Users can delete their verification uploads" on storage.objects;
create policy "Users can delete their verification uploads"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'verification-documents'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

create or replace function public.get_listing_contacts(p_profile_ids uuid[])
returns table (id uuid, full_name text, phone text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.profiles viewer
    where viewer.id = auth.uid()
      and (viewer.role = 'admin' or viewer.verification_status = 'approved')
  ) then
    raise exception 'An approved account is required to view listing contact details';
  end if;

  return query
  select profile.id, profile.full_name, profile.phone
  from public.profiles profile
  where profile.id = any(coalesce(p_profile_ids, array[]::uuid[]))
    and (
      exists (
        select 1 from public.accommodations listing
        where listing.owner_id = profile.id and listing.status = 'published'
      )
      or exists (
        select 1 from public.marketplace_items listing
        where listing.seller_id = profile.id and listing.status = 'published'
      )
    );
end;
$$;

revoke all on function public.get_listing_contacts(uuid[]) from public;
grant execute on function public.get_listing_contacts(uuid[]) to authenticated;

drop policy if exists "Users can create events" on public.events;
create policy "Users can create events"
  on public.events for insert
  to authenticated
  with check (public.is_admin() and organizer_id = auth.uid());

create or replace function public.prevent_non_admin_event_status_changes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() and old.status is distinct from new.status then
    raise exception 'Only an administrator can change event publication status';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_event_publication_status on public.events;
create trigger protect_event_publication_status
  before update on public.events
  for each row execute procedure public.prevent_non_admin_event_status_changes();

notify pgrst, 'reload schema';
