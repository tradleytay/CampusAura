-- Run this migration to fix accommodation inserts failing in the shared
-- listing reference-code trigger.
create or replace function public.assign_listing_reference_code()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  code_type text;
begin
  if new.reference_code is null then
    if tg_table_name = 'accommodations' then
      code_type := 'property';
    elsif tg_table_name = 'marketplace_items' then
      code_type := case when new.listing_type = 'service' then 'service' else 'product' end;
    else
      raise exception 'Unsupported listing table: %', tg_table_name;
    end if;
    new.reference_code := public.next_reference_code(code_type);
  end if;
  return new;
end;
$$;
