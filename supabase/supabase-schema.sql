-- CampusAura initial Supabase schema.
-- Run this once in Supabase Dashboard -> SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  phone text,
  role text not null default 'student' check (role in ('student', 'provider', 'admin')),
  requested_role text not null default 'student' check (requested_role in ('student', 'provider')),
  verification_status text not null default 'pending' check (verification_status in ('pending', 'approved', 'rejected')),
  rejection_reason text,
  avatar_url text,
  created_at timestamptz not null default now()
);

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

create table if not exists public.accommodations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id) on delete set null,
  title text not null,
  location text not null,
  price numeric(12, 2) not null check (price >= 0),
  description text,
  image_url text,
  verified boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'published', 'rejected')),
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.marketplace_items (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid references public.profiles(id) on delete set null,
  title text not null,
  price numeric(12, 2) not null check (price >= 0),
  listing_type text not null default 'product' check (listing_type in ('product', 'service')),
  category text not null,
  description text,
  image_url text,
  status text not null default 'published' check (status in ('published', 'sold', 'removed')),
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid references public.profiles(id) on delete set null,
  title text not null,
  event_date timestamptz not null,
  location text not null,
  description text,
  image_url text,
  event_type text not null default 'social',
  status text not null default 'published' check (status in ('draft', 'published', 'cancelled')),
  created_at timestamptz not null default now()
);

create table if not exists public.rsvps (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (event_id, user_id)
);

create table if not exists public.contact_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  name text not null,
  email text not null,
  topic text,
  campus text,
  message text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now()
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
      when new.raw_user_meta_data ->> 'requested_role' = 'provider' then 'provider'
      else 'student'
    end,
    'pending'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.verification_documents enable row level security;
alter table public.accommodations enable row level security;
alter table public.marketplace_items enable row level security;
alter table public.events enable row level security;
alter table public.rsvps enable row level security;
alter table public.contact_submissions enable row level security;
alter table public.newsletter_subscribers enable row level security;

create policy "Published accommodations are public"
  on public.accommodations for select
  using (status = 'published');

create policy "Published marketplace items are public"
  on public.marketplace_items for select
  using (status = 'published');

create policy "Published events are public"
  on public.events for select
  using (status = 'published');

create policy "Users can read their profile"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

create policy "Users can update their profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "Users can submit verification documents"
  on public.verification_documents for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Users can read their verification status"
  on public.verification_documents for select
  to authenticated
  using (user_id = auth.uid());

create policy "Users can read their RSVPs"
  on public.rsvps for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can create their RSVPs"
  on public.rsvps for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can delete their RSVPs"
  on public.rsvps for delete
  to authenticated
  using (auth.uid() = user_id);

create policy "Anyone can submit contact messages"
  on public.contact_submissions for insert
  to anon, authenticated
  with check (true);

create policy "Anyone can subscribe to the newsletter"
  on public.newsletter_subscribers for insert
  to anon, authenticated
  with check (true);

create index if not exists accommodations_location_idx on public.accommodations (location);
create index if not exists marketplace_items_category_idx on public.marketplace_items (category);
create index if not exists events_event_date_idx on public.events (event_date);
create index if not exists rsvps_user_id_idx on public.rsvps (user_id);