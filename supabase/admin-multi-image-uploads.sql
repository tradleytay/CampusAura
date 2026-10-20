-- Add gallery support for accommodation, marketplace, and event listings.
-- Run this migration in the Supabase SQL Editor before using multi-image uploads.

begin;

alter table public.accommodations
  add column if not exists image_urls text[] not null default '{}'::text[];
alter table public.marketplace_items
  add column if not exists image_urls text[] not null default '{}'::text[];
alter table public.events
  add column if not exists image_urls text[] not null default '{}'::text[];

-- Preserve each existing cover image as the first image in its gallery.
update public.accommodations
set image_urls = array[image_url]
where image_url is not null and cardinality(image_urls) = 0;

update public.marketplace_items
set image_urls = array[image_url]
where image_url is not null and cardinality(image_urls) = 0;

update public.events
set image_urls = array[image_url]
where image_url is not null and cardinality(image_urls) = 0;

notify pgrst, 'reload schema';

commit;
