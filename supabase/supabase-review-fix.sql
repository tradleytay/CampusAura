-- Repair verification-review columns in an existing Supabase project.
-- Run in Supabase Dashboard -> SQL Editor, then retry the admin action.

alter table public.profiles
  add column if not exists rejection_reason text;

alter table public.verification_documents
  add column if not exists rejection_reason text;

notify pgrst, 'reload schema';
