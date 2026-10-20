-- Run in Supabase SQL Editor to ensure new profiles default to pending review.
-- This changes the column default only; it does not alter existing profile statuses.

alter table public.profiles
  alter column verification_status set default 'pending';
