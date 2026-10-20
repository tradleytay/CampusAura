-- Run after supabase-schema.sql.
-- Adds role-safe policies for provider and admin workflows.

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
    where id = auth.uid() and role = 'provider' and verification_status = 'approved'
  );
$$;

create table if not exists public.saved_listings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  accommodation_id uuid not null references public.accommodations(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, accommodation_id)
);

alter table public.profiles
  add column if not exists email text,
  add column if not exists rejection_reason text,
  add column if not exists phone text;

insert into storage.buckets (id, name, public)
values ('listing-images', 'listing-images', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "Providers can upload listing images" on storage.objects;
create policy "Providers can upload listing images"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'listing-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Anyone can read listing images" on storage.objects;
create policy "Anyone can read listing images"
  on storage.objects for select
  to public
  using (bucket_id = 'listing-images');

drop policy if exists "Providers can update listing images" on storage.objects;
create policy "Providers can update listing images"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'listing-images' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'listing-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Providers can delete listing images" on storage.objects;
create policy "Providers can delete listing images"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'listing-images' and (storage.foldername(name))[1] = auth.uid()::text);

alter table public.marketplace_items
  add column if not exists listing_type text not null default 'product';

alter table public.marketplace_items
  drop constraint if exists marketplace_items_listing_type_check;

alter table public.marketplace_items
  add constraint marketplace_items_listing_type_check
  check (listing_type in ('product', 'service'));

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
    'pending'
  );
  return new;
end;
$$;

alter table public.profiles
  add column if not exists requested_role text not null default 'student'
    check (requested_role in ('student', 'provider')),
  add column if not exists verification_status text not null default 'pending'
    check (verification_status in ('pending', 'approved', 'rejected'));

create table if not exists public.verification_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  requested_role text not null check (requested_role in ('student', 'provider')),
  identity_document_path text not null,
  student_document_path text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  rejection_reason text,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint student_documents_required check (
    requested_role = 'provider' or student_document_path is not null
  )
);

alter table public.verification_documents enable row level security;

drop policy if exists "Users can submit verification documents" on public.verification_documents;
create policy "Users can submit verification documents"
  on public.verification_documents for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Users can read their verification status" on public.verification_documents;
create policy "Users can read their verification status"
  on public.verification_documents for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "Admins can update verification documents" on public.verification_documents;
create policy "Admins can update verification documents"
  on public.verification_documents for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

insert into storage.buckets (id, name, public)
values ('verification-documents', 'verification-documents', false)
on conflict (id) do update set public = false;

drop policy if exists "Users can upload their verification documents" on storage.objects;
create policy "Users can upload their verification documents"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'verification-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can read their verification documents" on storage.objects;
create policy "Users can read their verification documents"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'verification-documents'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

alter table public.saved_listings enable row level security;

drop policy if exists "Users can read their saved listings" on public.saved_listings;
create policy "Users can read their saved listings"
  on public.saved_listings for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can save listings" on public.saved_listings;
create policy "Users can save listings"
  on public.saved_listings for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Users can remove saved listings" on public.saved_listings;
create policy "Users can remove saved listings"
  on public.saved_listings for delete
  to authenticated
  using (user_id = auth.uid());

create or replace function public.prevent_role_escalation()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if old.role is distinct from new.role and not public.is_admin() then
    raise exception 'Only an administrator can change account roles';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_role on public.profiles;
create trigger protect_profile_role
  before update on public.profiles
  for each row execute procedure public.prevent_role_escalation();

drop policy if exists "Users can update their profile" on public.profiles;
create policy "Users can update their profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id or public.is_admin())
  with check (auth.uid() = id or public.is_admin());

drop policy if exists "Owners can read their accommodations" on public.accommodations;
create policy "Owners can read their accommodations"
  on public.accommodations for select
  to authenticated
  using (owner_id = auth.uid() or public.is_admin());

drop policy if exists "Admins can read all accommodations" on public.accommodations;
create policy "Admins can read all accommodations"
  on public.accommodations for select
  to authenticated
  using (public.is_admin());

drop policy if exists "Providers can create accommodations" on public.accommodations;
create policy "Providers can create accommodations"
  on public.accommodations for insert
  to authenticated
  with check (owner_id = auth.uid() and public.has_provider_access());

drop policy if exists "Owners can update accommodations" on public.accommodations;
create policy "Owners can update accommodations"
  on public.accommodations for update
  to authenticated
  using ((owner_id = auth.uid() and public.has_provider_access()) or public.is_admin())
  with check ((owner_id = auth.uid() and public.has_provider_access()) or public.is_admin());

drop policy if exists "Owners can delete accommodations" on public.accommodations;
create policy "Owners can delete accommodations"
  on public.accommodations for delete
  to authenticated
  using ((owner_id = auth.uid() and public.has_provider_access()) or public.is_admin());

drop policy if exists "Owners can read marketplace items" on public.marketplace_items;
create policy "Owners can read marketplace items"
  on public.marketplace_items for select
  to authenticated
  using (seller_id = auth.uid() or public.is_admin());

drop policy if exists "Admins can read all marketplace items" on public.marketplace_items;
create policy "Admins can read all marketplace items"
  on public.marketplace_items for select
  to authenticated
  using (public.is_admin());

drop policy if exists "Users can create marketplace items" on public.marketplace_items;
create policy "Users can create marketplace items"
  on public.marketplace_items for insert
  to authenticated
  with check (seller_id = auth.uid() and public.has_provider_access());

drop policy if exists "Owners can update marketplace items" on public.marketplace_items;
create policy "Owners can update marketplace items"
  on public.marketplace_items for update
  to authenticated
  using ((seller_id = auth.uid() and public.has_provider_access()) or public.is_admin())
  with check ((seller_id = auth.uid() and public.has_provider_access()) or public.is_admin());

drop policy if exists "Owners can delete marketplace items" on public.marketplace_items;
create policy "Owners can delete marketplace items"
  on public.marketplace_items for delete
  to authenticated
  using ((seller_id = auth.uid() and public.has_provider_access()) or public.is_admin());

drop policy if exists "Organizers can read their events" on public.events;
create policy "Organizers can read their events"
  on public.events for select
  to authenticated
  using (organizer_id = auth.uid() or public.is_admin());

drop policy if exists "Admins can read all events" on public.events;
create policy "Admins can read all events"
  on public.events for select
  to authenticated
  using (public.is_admin());

drop policy if exists "Users can create events" on public.events;
create policy "Users can create events"
  on public.events for insert
  to authenticated
  with check (organizer_id = auth.uid());

drop policy if exists "Organizers can update events" on public.events;
create policy "Organizers can update events"
  on public.events for update
  to authenticated
  using (organizer_id = auth.uid() or public.is_admin())
  with check (organizer_id = auth.uid() or public.is_admin());

drop policy if exists "Organizers can delete events" on public.events;
create policy "Organizers can delete events"
  on public.events for delete
  to authenticated
  using (organizer_id = auth.uid() or public.is_admin());

drop policy if exists "Admins can read contact messages" on public.contact_submissions;
create policy "Admins can read contact messages"
  on public.contact_submissions for select
  to authenticated
  using (public.is_admin());

drop policy if exists "Admins can read newsletter subscribers" on public.newsletter_subscribers;
create policy "Admins can read newsletter subscribers"
  on public.newsletter_subscribers for select
  to authenticated
  using (public.is_admin());