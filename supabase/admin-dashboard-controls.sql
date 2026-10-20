-- Run after launch-hardening.sql, account-freeze-controls.sql, and provider-listing-access.sql.
-- Adds account deletion, explicit listing suspension, and an administrator email outbox.

begin;

alter table public.accommodations
  drop constraint if exists accommodations_status_check;
alter table public.accommodations
  add constraint accommodations_status_check
  check (status in ('pending', 'published', 'rejected', 'suspended'));

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

alter table public.marketplace_items
  drop constraint if exists marketplace_items_status_check;
alter table public.marketplace_items
  add constraint marketplace_items_status_check
  check (status in ('pending', 'published', 'sold', 'removed', 'rejected', 'suspended'));

alter table public.events
  drop constraint if exists events_status_check;
alter table public.events
  add constraint events_status_check
  check (status in ('draft', 'published', 'cancelled', 'suspended'));

create or replace function public.prevent_unreviewed_marketplace_changes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin()
    and old.status is distinct from new.status
    and (
      old.status in ('pending', 'rejected', 'suspended')
      or new.status in ('pending', 'published', 'rejected', 'suspended')
    ) then
    raise exception 'Only an administrator can change marketplace review or suspension status';
  end if;
  return new;
end;
$$;

create or replace function public.admin_delete_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  target_role text;
begin
  if not public.is_admin() then
    raise exception 'Administrator access is required';
  end if;

  select role into target_role
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'Account profile not found';
  end if;
  if target_role = 'admin' then
    raise exception 'Administrator accounts cannot be deleted here';
  end if;

  delete from auth.users where id = p_user_id;
  if not found then
    raise exception 'Authentication account not found';
  end if;
end;
$$;

revoke all on function public.admin_delete_user(uuid) from public;
grant execute on function public.admin_delete_user(uuid) to authenticated;

create table if not exists public.admin_outbox (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid references public.profiles(id) on delete set null,
  recipient_name text not null,
  recipient_email text not null,
  subject text not null,
  body text not null,
  sent_by uuid references public.profiles(id) on delete set null,
  provider_message_id text,
  sent_at timestamptz not null default now()
);

create index if not exists admin_outbox_sent_at_idx
  on public.admin_outbox (sent_at desc);

alter table public.admin_outbox enable row level security;

drop policy if exists "Admins can read email outbox" on public.admin_outbox;
create policy "Admins can read email outbox"
  on public.admin_outbox for select
  to authenticated
  using (public.is_admin());

grant select on public.admin_outbox to authenticated;
grant insert on public.admin_outbox to service_role;

notify pgrst, 'reload schema';

commit;
