-- F02-T02: a anonimização existente cobre também os pedidos operacionais.
-- Única exceção à imutabilidade do journal: remover conteúdo pessoal, mantendo
-- IDs, autoria, revisão, valores comerciais e a existência da operação.
create or replace function public.fn_crm_orders_redact_contact()
returns trigger language plpgsql security definer set search_path='' as $f02_redact$
declare
  v_orders uuid[];
  v_order_count integer;
  v_item_count integer;
  v_event_count integer;
  v_receipt_count integer;
begin
  -- A origem é a linha de contacts; não há RPC com org/contato fornecidos pelo cliente.
  new.company_id := null;
  new.recurring := false;
  select coalesce(array_agg(id),array[]::uuid[]) into v_orders
    from public.crm_orders where organization_id=new.organization_id and contact_id=new.id;

  update public.crm_orders set company_id=null,company_name_snapshot=null,channel=null
    where organization_id=new.organization_id and id=any(v_orders)
      and (company_id is not null or company_name_snapshot is not null or channel is not null);
  get diagnostics v_order_count=row_count;
  update public.crm_order_items set requested_text='[conteúdo anonimizado]',product_name_snapshot=null
    where organization_id=new.organization_id and order_id=any(v_orders)
      and (requested_text<>'[conteúdo anonimizado]' or product_name_snapshot is not null);
  get diagnostics v_item_count=row_count;

  -- Troca de contato pode deixar snapshots históricos associados a outro evento.
  update public.crm_order_events set changes='{"redacted":true}'::jsonb
    where organization_id=new.organization_id
      and (contact_id=new.id or order_id=any(v_orders)
        or changes#>>'{before,contact_id}'=new.id::text
        or changes#>>'{after,contact_id}'=new.id::text)
      and changes<>'{"redacted":true}'::jsonb;
  get diagnostics v_event_count=row_count;
  update public.crm_order_command_receipts set response_body='{"redacted":true}'::jsonb
    where organization_id=new.organization_id and completed_at is not null
      and (order_id=any(v_orders) or response_body->>'contact_id'=new.id::text)
      and response_body<>'{"redacted":true}'::jsonb;
  get diagnostics v_receipt_count=row_count;

  if v_order_count+v_item_count+v_event_count+v_receipt_count>0 then
    insert into public.api_audit_log
      (organization_id,actor_user_id,action,resource_type,resource_id,metadata,bypassed_rls)
    values(new.organization_id,auth.uid(),'crm_order.redacted','contacts',new.id,
      jsonb_build_object('orders',v_order_count,'items',v_item_count,
        'events',v_event_count,'receipts',v_receipt_count),true);
  end if;
  return new;
end
$f02_redact$;

alter function public.fn_crm_orders_redact_contact() owner to postgres;
revoke all on function public.fn_crm_orders_redact_contact() from public,anon,authenticated,service_role;
drop trigger if exists trg_crm_orders_redact_contact on public.contacts;
-- BEFORE permite limpar os campos novos do próprio contato sem UPDATE recursivo.
-- True→true também limpa resíduos; o mutex legado roda antes deste trigger.
create trigger trg_crm_orders_redact_contact before update of is_anonymized on public.contacts
  for each row when(new.is_anonymized is true)
  execute function public.fn_crm_orders_redact_contact();
comment on function public.fn_crm_orders_redact_contact() is
  'Trigger privado de anonimização dos pedidos operacionais, na transação de contacts. Não é RPC.';
