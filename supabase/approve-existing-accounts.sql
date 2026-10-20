-- One-time migration: mark all accounts that already exist as verified.
-- Run this manually in the Supabase SQL Editor. New accounts keep the normal review flow.
-- This does not unfreeze accounts, change subscription access, or approve listings.

begin;

-- The hardening trigger blocks verification and role changes unless an admin acts.
-- Disable it only inside this transaction, then restore it before commit.
alter table public.profiles disable trigger protect_profile_role;

update public.profiles
set verification_status = 'approved',
    rejection_reason = null,
    role = case
      when role <> 'admin' and requested_role = 'provider' then 'provider'
      else role
    end
where verification_status is distinct from 'approved'
   or rejection_reason is not null
   or (role <> 'admin' and requested_role = 'provider' and role <> 'provider');

alter table public.profiles enable trigger protect_profile_role;

-- Approve verification records that already exist, without creating fake records.
update public.verification_documents
set status = 'approved',
    rejection_reason = null,
    reviewed_at = case
      when status = 'approved' then coalesce(reviewed_at, now())
      else now()
    end,
    reviewed_by = case
      when status = 'approved' then reviewed_by
      else null
    end
where status is distinct from 'approved'
   or rejection_reason is not null;

notify pgrst, 'reload schema';

commit;
