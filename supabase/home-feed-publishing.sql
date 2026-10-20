-- Run after the existing schema, upgrade, final, analytics, and hardening SQL.
-- Record the moment a listing becomes public so newly approved content sorts first.

alter table public.accommodations
  add column if not exists published_at timestamptz;

alter table public.marketplace_items
  add column if not exists published_at timestamptz;

update public.accommodations
set published_at = created_at
where status = 'published' and published_at is null;

update public.marketplace_items
set published_at = created_at
where status = 'published' and published_at is null;

create or replace function public.set_listing_published_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'published' then
    if tg_op = 'INSERT' then
      new.published_at := now();
    elsif old.status is distinct from 'published' then
      new.published_at := now();
    elsif new.published_at is null then
      new.published_at := coalesce(old.created_at, now());
    end if;
  else
    new.published_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists set_accommodation_published_at on public.accommodations;
create trigger set_accommodation_published_at
  before insert or update of status on public.accommodations
  for each row execute function public.set_listing_published_at();

drop trigger if exists set_marketplace_item_published_at on public.marketplace_items;
create trigger set_marketplace_item_published_at
  before insert or update of status on public.marketplace_items
  for each row execute function public.set_listing_published_at();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'accommodations'
    ) then
      alter publication supabase_realtime add table public.accommodations;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'marketplace_items'
    ) then
      alter publication supabase_realtime add table public.marketplace_items;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'events'
    ) then
      alter publication supabase_realtime add table public.events;
    end if;
  end if;
end;
$$;
