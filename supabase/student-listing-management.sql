-- Run after launch-hardening.sql and account-freeze-controls.sql.
-- Allow active account owners to manage their own marketplace listings;
-- marketplace review status remains protected by the launch-hardening trigger.
begin;

drop policy if exists "Owners can update marketplace items" on public.marketplace_items;
create policy "Owners can update marketplace items"
  on public.marketplace_items for update to authenticated
  using (
    (seller_id = auth.uid() and public.has_active_account_access())
    or public.is_admin()
  )
  with check (
    (seller_id = auth.uid() and public.has_active_account_access())
    or public.is_admin()
  );

drop policy if exists "Owners can delete marketplace items" on public.marketplace_items;
create policy "Owners can delete marketplace items"
  on public.marketplace_items for delete to authenticated
  using (
    (seller_id = auth.uid() and public.has_active_account_access())
    or public.is_admin()
  );

commit;
