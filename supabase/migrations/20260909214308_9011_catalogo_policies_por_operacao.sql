-- F02-T06: leitura de catálogo sem reavaliar o papel de escrita por produto.
-- SELECT já cobre toda leitura permitida pelo antigo FOR ALL. Separar comandos
-- evita recalcular o papel de escrita para cada produto durante lista/count.
-- Helpers que dependem de organization_id continuam correlacionados à linha.
drop policy if exists catalog_products_write on public.catalog_products;

drop policy if exists catalog_products_select on public.catalog_products;
create policy catalog_products_select on public.catalog_products
  for select using (
    (organization_id in (select public.fn_user_org_ids()))
    or (select public.fn_is_platform_admin())
  );

drop policy if exists catalog_products_insert on public.catalog_products;
create policy catalog_products_insert on public.catalog_products
  for insert with check (
    (select public.fn_is_platform_admin())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists catalog_products_update on public.catalog_products;
create policy catalog_products_update on public.catalog_products
  for update using (
    (select public.fn_is_platform_admin())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  ) with check (
    (select public.fn_is_platform_admin())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists catalog_products_delete on public.catalog_products;
create policy catalog_products_delete on public.catalog_products
  for delete using (
    (select public.fn_is_platform_admin())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

-- Mantém os grants existentes e não altera as três policies restritivas
-- support_write_*. Nenhuma função, papel ou privilégio novo é criado.
revoke all on public.catalog_products from anon;
grant select, insert, update, delete on public.catalog_products to authenticated;
grant all on public.catalog_products to service_role;
