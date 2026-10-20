-- CampusAura student onboarding update.
-- Run in Supabase SQL Editor after all existing CampusAura schema, upgrade, and hardening scripts.
-- Students can access CampusAura immediately and may optionally submit a student ID for review.
-- Provider identity review remains required before provider access.

begin;

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
      when new.raw_user_meta_data ->> 'requested_role' = 'provider' then 'provider'
      else 'student'
    end,
    case
      when new.raw_user_meta_data ->> 'requested_role' = 'provider' then 'pending'
      else 'approved'
    end
  );
  return new;
end;
$$;

-- Backfill existing student accounts out of the old manual review queue.
alter table public.profiles disable trigger protect_profile_role;
update public.profiles
set verification_status = 'approved',
    rejection_reason = null
where role = 'student'
  and requested_role = 'student'
  and verification_status <> 'approved';
alter table public.profiles enable trigger protect_profile_role;

-- Students may view listing contact details without an approval status check.
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
      and (
        viewer.role = 'admin'
        or viewer.role = 'student'
        or (viewer.role = 'provider' and viewer.verification_status = 'approved')
      )
  ) then
    raise exception 'An active student, approved provider, or administrator account is required to view listing contact details';
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


-- Allow provider identity documents and optional student ID submissions only.
alter table public.verification_documents
  alter column identity_document_path drop not null;

drop policy if exists "Users can submit verification documents" on public.verification_documents;
drop policy if exists "Users can submit provider verification documents" on public.verification_documents;
drop policy if exists "Users can submit account verification documents" on public.verification_documents;
create policy "Users can submit account verification documents"
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
    and (
      (
        requested_role = 'provider'
        and identity_document_path is not null
        and (storage.foldername(identity_document_path))[1] = auth.uid()::text
        and exists (
          select 1 from storage.objects object
          where object.bucket_id = 'verification-documents'
            and object.name = identity_document_path
        )
      )
      or
      (
        requested_role = 'student'
        and identity_document_path is null
        and student_document_path is not null
        and (storage.foldername(student_document_path))[1] = auth.uid()::text
        and exists (
          select 1 from storage.objects object
          where object.bucket_id = 'verification-documents'
            and object.name = student_document_path
        )
      )
    )
  );

-- Review provider access as before; student reviews update only the document status.
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
  submission_role text;
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

  select requested_role into submission_role
  from public.verification_documents
  where user_id = p_user_id and status = 'pending'
  order by created_at desc
  limit 1
  for update;
  if not found then
    raise exception 'No pending verification documents were found';
  end if;

  if submission_role = 'provider' then
    update public.profiles
    set verification_status = p_status,
        rejection_reason = case when p_status = 'rejected' then reason else null end,
        role = case when p_status = 'approved' then requested_role else role end
    where id = p_user_id;
  end if;

  update public.verification_documents
  set status = p_status,
      rejection_reason = case when p_status = 'rejected' then reason else null end,
      reviewed_at = now(),
      reviewed_by = auth.uid()
  where user_id = p_user_id
    and requested_role = submission_role
    and status = 'pending';
end;
$$;

revoke all on function public.admin_review_user(uuid, text, text) from public;
grant execute on function public.admin_review_user(uuid, text, text) to authenticated;
commit;