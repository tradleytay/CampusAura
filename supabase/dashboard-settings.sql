-- Run after supabase/launch-hardening.sql and supabase/admin-dashboard-controls.sql.
-- Persists account preferences and administrator-managed platform settings.

begin;

alter table public.profiles
  add column if not exists campus_preference text,
  add column if not exists notification_preferences jsonb not null default '{}'::jsonb,
  add column if not exists content_preferences jsonb not null default '{}'::jsonb;

update public.profiles profile
set campus_preference = nullif(trim(auth_user.raw_user_meta_data ->> 'university'), '')
from auth.users auth_user
where auth_user.id = profile.id
  and profile.campus_preference is null
  and nullif(trim(auth_user.raw_user_meta_data ->> 'university'), '') is not null;

create table if not exists public.platform_settings (
  id integer primary key default 1 check (id = 1),
  platform_name text not null default 'CampusAura' check (length(trim(platform_name)) between 1 and 80),
  logo_url text not null default '',
  contact_email text not null default 'hello@campusaura.com',
  contact_phone text not null default '',
  support_url text not null default 'contact.html',
  maintenance_mode boolean not null default false,
  maintenance_message text not null default 'CampusAura is undergoing scheduled maintenance. Please check back soon.',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

insert into public.platform_settings (id)
values (1)
on conflict (id) do nothing;

create table if not exists public.platform_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 120),
  message text not null check (length(trim(message)) between 1 and 2000),
  is_published boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_announcements_valid_schedule check (
    starts_at is null or ends_at is null or ends_at > starts_at
  )
);

create index if not exists platform_announcements_active_idx
  on public.platform_announcements (is_published, starts_at, ends_at);

create table if not exists public.admin_audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  table_name text not null,
  record_id text,
  changed_fields text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_logs_created_at_idx
  on public.admin_audit_logs (created_at desc);

alter table public.platform_settings enable row level security;
alter table public.platform_announcements enable row level security;
alter table public.admin_audit_logs enable row level security;

drop policy if exists "Platform settings are publicly readable" on public.platform_settings;
create policy "Platform settings are publicly readable"
  on public.platform_settings for select
  to anon, authenticated
  using (id = 1);

drop policy if exists "Admins can update platform settings" on public.platform_settings;
create policy "Admins can update platform settings"
  on public.platform_settings for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Published announcements are publicly readable" on public.platform_announcements;
create policy "Published announcements are publicly readable"
  on public.platform_announcements for select
  to anon, authenticated
  using (
    is_published
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
  );

drop policy if exists "Admins can read all announcements" on public.platform_announcements;
create policy "Admins can read all announcements"
  on public.platform_announcements for select
  to authenticated
  using (public.is_admin());

drop policy if exists "Admins can create announcements" on public.platform_announcements;
create policy "Admins can create announcements"
  on public.platform_announcements for insert
  to authenticated
  with check (public.is_admin() and created_by = auth.uid());

drop policy if exists "Admins can update announcements" on public.platform_announcements;
create policy "Admins can update announcements"
  on public.platform_announcements for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can delete announcements" on public.platform_announcements;
create policy "Admins can delete announcements"
  on public.platform_announcements for delete
  to authenticated
  using (public.is_admin());

drop policy if exists "Admins can read audit logs" on public.admin_audit_logs;
create policy "Admins can read audit logs"
  on public.admin_audit_logs for select
  to authenticated
  using (public.is_admin());

create or replace function public.log_admin_dashboard_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  old_data jsonb;
  new_data jsonb;
  row_identifier text;
  changed text[];
begin
  if not public.is_admin() then
    return coalesce(new, old);
  end if;

  if tg_op <> 'INSERT' then old_data := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then new_data := to_jsonb(new); end if;

  row_identifier := coalesce(new_data ->> 'id', old_data ->> 'id');
  if tg_table_name = 'profiles' then
    row_identifier := coalesce(new_data ->> 'id', old_data ->> 'id');
  end if;

  if tg_op = 'INSERT' then
    select coalesce(array_agg(key order by key), '{}')
      into changed
      from jsonb_object_keys(new_data) as keys(key);
  elsif tg_op = 'DELETE' then
    select coalesce(array_agg(key order by key), '{}')
      into changed
      from jsonb_object_keys(old_data) as keys(key);
  else
    select coalesce(array_agg(keys.key order by keys.key), '{}')
      into changed
      from (
        select jsonb_object_keys(old_data) as key
        union
        select jsonb_object_keys(new_data) as key
      ) keys
      where old_data -> keys.key is distinct from new_data -> keys.key;
  end if;

  insert into public.admin_audit_logs (actor_id, action, table_name, record_id, changed_fields)
  values (
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    row_identifier,
    changed
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists audit_admin_profile_changes on public.profiles;
create trigger audit_admin_profile_changes
  after insert or update or delete on public.profiles
  for each row execute procedure public.log_admin_dashboard_change();

drop trigger if exists audit_admin_verification_changes on public.verification_documents;
create trigger audit_admin_verification_changes
  after insert or update or delete on public.verification_documents
  for each row execute procedure public.log_admin_dashboard_change();

drop trigger if exists audit_admin_accommodation_changes on public.accommodations;
create trigger audit_admin_accommodation_changes
  after insert or update or delete on public.accommodations
  for each row execute procedure public.log_admin_dashboard_change();

drop trigger if exists audit_admin_marketplace_changes on public.marketplace_items;
create trigger audit_admin_marketplace_changes
  after insert or update or delete on public.marketplace_items
  for each row execute procedure public.log_admin_dashboard_change();

drop trigger if exists audit_admin_event_changes on public.events;
create trigger audit_admin_event_changes
  after insert or update or delete on public.events
  for each row execute procedure public.log_admin_dashboard_change();

drop trigger if exists audit_admin_platform_settings_changes on public.platform_settings;
create trigger audit_admin_platform_settings_changes
  after insert or update or delete on public.platform_settings
  for each row execute procedure public.log_admin_dashboard_change();

drop trigger if exists audit_admin_announcement_changes on public.platform_announcements;
create trigger audit_admin_announcement_changes
  after insert or update or delete on public.platform_announcements
  for each row execute procedure public.log_admin_dashboard_change();

grant select on public.platform_settings, public.platform_announcements to anon, authenticated;
grant update on public.platform_settings to authenticated;
grant insert, update, delete on public.platform_announcements to authenticated;
grant select on public.admin_audit_logs to authenticated;

create or replace function public.admin_set_admin_access(p_user_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_role text;
  admin_count integer;
begin
  if not public.is_admin() then
    raise exception 'Administrator access is required';
  end if;
  if p_user_id is null or p_enabled is null then
    raise exception 'A user and access choice are required';
  end if;
  if p_user_id = auth.uid() and not p_enabled then
    raise exception 'You cannot remove your own administrator access';
  end if;

  select role into target_role
  from public.profiles
  where id = p_user_id
  for update;
  if not found then
    raise exception 'Account profile not found';
  end if;

  if p_enabled then
    update public.profiles set role = 'admin' where id = p_user_id;
  elsif target_role = 'admin' then
    select count(*) into admin_count from public.profiles where role = 'admin';
    if admin_count <= 1 then
      raise exception 'The last administrator cannot be removed';
    end if;
    update public.profiles
    set role = case
      when requested_role = 'provider' and verification_status = 'approved' then 'provider'
      else 'student'
    end
    where id = p_user_id;
  end if;
end;
$$;

revoke all on function public.admin_set_admin_access(uuid, boolean) from public;
grant execute on function public.admin_set_admin_access(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';

commit;
