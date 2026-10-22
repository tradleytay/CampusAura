-- Run this migration to store the structured property details submitted by providers.
alter table public.accommodations
  add column if not exists room_type text not null default 'Other',
  add column if not exists distance_km numeric(7,2),
  add column if not exists deposit numeric(12,2) not null default 0,
  add column if not exists furnishing text not null default 'unfurnished',
  add column if not exists bathroom_type text not null default 'not specified',
  add column if not exists kitchen_type text not null default 'not specified',
  add column if not exists utilities_included text[] not null default '{}',
  add column if not exists amenities text[] not null default '{}',
  add column if not exists transport_details text not null default '',
  add column if not exists available_from date,
  add column if not exists max_occupants integer not null default 1;
