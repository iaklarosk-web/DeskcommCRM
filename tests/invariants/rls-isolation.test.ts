import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * G1-02 — RLS isolation invariant.
 *
 * Runs against the ephemeral Postgres container started by scripts/test-db.sh
 * (baseline.sql already applied). Seeds 2 orgs + 1 user each, then proves that
 * a user of org A sees ZERO rows of org B in conversations / messages /
 * contacts / crm_leads under RLS, with JWT claims simulated via
 * set_config('request.jwt.claims', ...) — the same auth.uid() /
 * fn_user_org_ids() path production policies use.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error(
    "TEST_DB_CONTAINER not set — run this suite via `pnpm test:db` (scripts/test-db.sh)",
  );
}
const containerName: string = container;

/** Runs a SQL script in ONE psql session inside the container; returns stdout (tuples-only). */
function sql(script: string): string {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      containerName,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-tA",
      "-f",
      "-",
    ],
    { input: script, encoding: "utf8" },
  ).trim();
}

// Fixed UUIDs make the seed idempotent (on conflict do nothing).
const ORG_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG_B = "bbbbbbbb-0000-4000-8000-000000000002";
const USER_A = "aaaaaaaa-1111-4000-8000-000000000001";
const USER_B = "bbbbbbbb-1111-4000-8000-000000000002";
const SESS_A = "aaaaaaaa-2222-4000-8000-000000000001";
const SESS_B = "bbbbbbbb-2222-4000-8000-000000000002";

/**
 * Runs SELECTs as the `authenticated` role with the given user's JWT claims,
 * exactly how PostgREST/Supabase set them: session role + request.jwt.claims.
 */
function countAs(userId: string, countQuery: string): number {
  const out = sql(`
    set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
    ${countQuery}
  `);
  // Output lines: set_config echo, then the count (last line).
  const lines = out.split("\n");
  const last = lines[lines.length - 1];
  if (last === undefined || !/^\d+$/.test(last)) {
    throw new Error(`unexpected psql output: ${out}`);
  }
  return Number(last);
}

function seedOrg(org: string, user: string, sess: string, tag: string): string {
  // No real PII: synthetic emails/names only (LGPD).
  return `
    insert into auth.users (id, email) values ('${user}', 'rls-${tag}@invariant.test')
      on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${org}', 'rls-inv-${tag}', 'RLS Invariant ${tag}', 'RLS ${tag}')
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${user}', '${org}', 'agent', now())
      on conflict do nothing;
    insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
      values ('${sess}', '${org}', 'rls-inv-${tag}', '\\x00'::bytea)
      on conflict (id) do nothing;
  `;
}

beforeAll(() => {
  sql(seedOrg(ORG_A, USER_A, SESS_A, "a") + seedOrg(ORG_B, USER_B, SESS_B, "b"));
  // Contact → conversation → message + pipeline → stage → lead, per org.
  sql(`
    do $seed$
    declare
      v_org uuid;
      v_sess uuid;
      v_contact uuid;
      v_conv uuid;
      v_pipe uuid;
      v_stage uuid;
      v_agent uuid;
      v_version uuid;
      v_company uuid;
      v_product uuid;
      v_order uuid;
      v_receipt uuid;
      v_check_receipt uuid;
      v_check_item uuid;
      v_order_revision integer;
      v_linked_task uuid;
      v_task_receipt uuid;
      v_boundary jsonb;
    begin
      foreach v_org in array array['${ORG_A}'::uuid, '${ORG_B}'::uuid] loop
        select id into v_sess from public.channel_sessions where organization_id = v_org limit 1;

        select id into v_contact from public.contacts
          where organization_id = v_org and display_name = 'RLS Invariant Contact';
        if v_contact is null then
          insert into public.contacts (organization_id, display_name)
            values (v_org, 'RLS Invariant Contact') returning id into v_contact;
        end if;

        select id into v_conv from public.conversations
          where organization_id = v_org and contact_id = v_contact;
        if v_conv is null then
          insert into public.conversations (organization_id, contact_id, channel_session_id)
            values (v_org, v_contact, v_sess) returning id into v_conv;
        end if;

        if not exists (select 1 from public.messages where organization_id = v_org) then
          insert into public.messages (organization_id, conversation_id, channel_session_id, contact_id, type, direction, body)
            values (v_org, v_conv, v_sess, v_contact, 'text', 'inbound', 'rls invariant probe');
        end if;

        -- 0227: sugestões contêm texto privado da conversa. Os dois tenants
        -- recebem uma linha real, com todos os FKs e a fronteira canônica.
        -- A prova abaixo usa JWT authenticated; não é só inspeção de policy.
        if not exists (select 1 from public.ai_reply_drafts where organization_id = v_org) then
          v_boundary := public.fn_service_begin(v_org, v_contact);
          v_conv := (v_boundary->>'conversation_id')::uuid;
          insert into public.ai_agents (organization_id, name, system_prompt, operation_mode)
            values (v_org, 'RLS Invariant Assistant', 'RLS invariant private prompt', 'assisted')
            returning id into v_agent;
          insert into public.ai_agent_versions
            (organization_id, agent_id, version_number, system_prompt, provider, model, channel_session_id, status)
            values (v_org, v_agent, 1, 'RLS invariant private prompt', 'anthropic', 'rls-test-model', v_sess, 'published')
            returning id into v_version;
          update public.ai_agents set published_version_id = v_version
            where organization_id = v_org and id = v_agent;
          insert into public.ai_reply_drafts
            (organization_id, conversation_id, contact_id, agent_id, agent_version_id,
             channel_session_id, service_boundary, context_revision, operation_revision,
             status, original_body)
            values (v_org, v_conv, v_contact, v_agent, v_version, v_sess, v_boundary,
              (select reply_context_revision from public.conversations where organization_id = v_org and id = v_conv),
              (select operation_revision from public.ai_agents where organization_id = v_org and id = v_agent),
              'pending', 'RLS invariant private reply');
        end if;

        select id into v_pipe from public.crm_pipelines
          where organization_id = v_org and slug = 'rls-inv';
        if v_pipe is null then
          insert into public.crm_pipelines (organization_id, name, slug)
            values (v_org, 'RLS Invariant', 'rls-inv') returning id into v_pipe;
        end if;

        select id into v_stage from public.crm_stages
          where organization_id = v_org and pipeline_id = v_pipe and slug = 'novo';
        if v_stage is null then
          insert into public.crm_stages (organization_id, pipeline_id, name, slug, position)
            values (v_org, v_pipe, 'Novo', 'novo', 1000) returning id into v_stage;
        end if;

        if not exists (select 1 from public.crm_leads where organization_id = v_org) then
          insert into public.crm_leads (organization_id, pipeline_id, stage_id, title)
            values (v_org, v_pipe, v_stage, 'RLS invariant lead');
        end if;

        if not exists (select 1 from public.org_guardrail_layers where organization_id = v_org) then
          insert into public.org_guardrail_layers (organization_id, layer, enabled)
            values (v_org, 'jailbreak', true);
        end if;

        if not exists (select 1 from public.org_memory_versions where organization_id = v_org) then
          insert into public.org_memory_versions (organization_id, version_number, content)
            values (v_org, 1, 'RLS invariant memory doc');
        end if;

        if not exists (select 1 from public.org_memory_entries where organization_id = v_org) then
          insert into public.org_memory_entries (organization_id, title, body, source)
            values (v_org, 'RLS invariant entry', 'RLS invariant body', 'manual');
        end if;

        if not exists (select 1 from public.skill_activations where organization_id = v_org) then
          insert into public.skill_activations (organization_id, skill_name, trigger)
            values (v_org, 's', 'hard');
        end if;

        if not exists (select 1 from public.ai_routers where organization_id = v_org) then
          insert into public.ai_routers (organization_id, name, channel_session_id)
            values (v_org, 'RLS Invariant Router', v_sess);
        end if;

        if not exists (select 1 from public.ai_router_decisions where organization_id = v_org) then
          insert into public.ai_router_decisions (organization_id, outcome)
            values (v_org, 'no_match');
        end if;

        if not exists (select 1 from public.knowledge_searches where organization_id = v_org) then
          insert into public.knowledge_searches (organization_id, hits, top_score, threshold)
            values (v_org, 1, 0.81, 0.72);
        end if;

        -- contact_field_proposals (migration 0123): a fila guarda e-mail e
        -- telefone que o cliente DITOU na conversa — PII crua, e a tabela nasce
        -- com CRUD inteiro para "authenticated" (o ALTER DEFAULT PRIVILEGES do
        -- baseline vale para todo objeto criado no apêndice). A única coisa
        -- entre o tenant A e o e-mail do cliente do tenant B é a policy.
        if not exists (select 1 from public.contact_field_proposals where organization_id = v_org) then
          insert into public.contact_field_proposals
            (organization_id, contact_id, campo, valor_proposto, expires_at)
            values (v_org, v_contact, 'email', 'rls-invariant@exemplo.test', now() + interval '7 days');
        end if;

        -- channel_accounts (migration 0219): o mapa provider+account_key da
        -- resolucao de webhook. account_key derivada da org para nao colidir
        -- no unique (provider, account_key) entre os dois tenants do seed.
        if not exists (select 1 from public.channel_accounts where organization_id = v_org) then
          insert into public.channel_accounts (organization_id, provider, account_key)
            values (v_org, 'mock', 'rls-inv-' || v_org::text);
        end if;

        -- tenant_settings (migration 0221): a configuracao por tenant (§5.2).
        if not exists (select 1 from public.tenant_settings where organization_id = v_org) then
          insert into public.tenant_settings (organization_id, key, value)
            values (v_org, 'branding.name', '"RLS Invariant"'::jsonb);
        end if;

        if not exists (select 1 from public.catalog_products where organization_id = v_org) then
          insert into public.catalog_products
            (organization_id, codigo, nome, preco_cents)
            values (v_org, 'RLS-' || v_org::text, 'Produto de invariante', 100);
        end if;

        if not exists (select 1 from public.crm_companies where organization_id = v_org) then
          insert into public.crm_companies (organization_id, legal_name)
            values (v_org, 'Empresa de invariante ' || v_org::text);
        end if;

        select id into v_company from public.crm_companies
          where organization_id = v_org limit 1;
        select id into v_product from public.catalog_products
          where organization_id = v_org limit 1;

        -- F02-T02: pedido, item e journal são tabelas de domínio legíveis por
        -- membro. O recibo que ancora a idempotência é privado e tem prova
        -- dedicada em f02-t02-order-schema.test.ts.
        select id into v_order from public.crm_orders
          where organization_id = v_org limit 1;
        if v_order is null then
          insert into public.crm_orders
            (organization_id, contact_id, company_id, company_name_snapshot,
             source, status, created_by_actor_type)
            values (v_org, v_contact, v_company, 'Empresa no momento do pedido',
                    'ui', 'draft', 'user')
            returning id into v_order;
        end if;
        if not exists (select 1 from public.crm_order_items where organization_id = v_org) then
          insert into public.crm_order_items
            (organization_id, order_id, position, requested_text, product_id,
             product_name_snapshot, sale_unit_snapshot, quantity,
             unit_price_cents, currency_snapshot, line_total_cents)
            values (v_org, v_order, 1, 'Item sintético do invariante', v_product,
                    'Produto no momento do pedido', 'un', 1.000,
                    100, 'BRL', 100);
        end if;
        select id into v_receipt from public.crm_order_command_receipts
          where organization_id = v_org and order_id = v_order limit 1;
        if v_receipt is null then
          insert into public.crm_order_command_receipts
            (organization_id, operation, idempotency_key, request_hash,
             actor_type, order_id, response_body, completed_at)
            values (v_org, 'create_draft', 'rls-invariant-' || v_org::text,
                    decode(repeat('00', 32), 'hex'), 'user', v_order,
                    '{}'::jsonb, now())
            returning id into v_receipt;
        end if;
        if not exists (select 1 from public.crm_order_events where organization_id = v_org) then
          insert into public.crm_order_events
            (organization_id, receipt_id, order_id, contact_id, order_revision,
             event_type, changes, actor_type)
            values (v_org, v_receipt, v_order, v_contact, 1,
                    'draft_created', '{}'::jsonb, 'user');
        end if;

        -- F02-T12: evento de conferência legível e recibo privado.
        if not exists(select 1 from public.crm_order_check_events where organization_id=v_org) then
          select id into v_check_item from public.crm_order_items
            where organization_id=v_org and order_id=v_order order by position,id limit 1;
          if v_check_item is null then
            insert into public.crm_order_items
              (organization_id,order_id,position,requested_text,product_id,
               product_name_snapshot,sale_unit_snapshot,quantity,unit_price_cents,
               currency_snapshot,line_total_cents)
            values(v_org,v_order,1,'Item sintético de conferência',v_product,
                   'Produto sintético de conferência','un',1.000,100,'BRL',100)
            returning id into v_check_item;
          end if;
          select revision into v_order_revision from public.crm_orders
            where organization_id=v_org and id=v_order;
          insert into public.crm_order_check_command_receipts
            (organization_id,operation,idempotency_key,request_hash,actor_user_id,order_id,
             response_body,completed_at)
          values(v_org,'record_check',gen_random_uuid(),decode(repeat('12',32),'hex'),
            case when v_org='${ORG_A}'::uuid then '${USER_A}'::uuid else '${USER_B}'::uuid end,
            v_order,'{}'::jsonb,now()) returning id into v_check_receipt;
          insert into public.crm_order_check_events
            (organization_id,receipt_id,order_id,order_revision,event_no,item_id,
             ordered_quantity_snapshot,checked_quantity,sale_unit_snapshot,check_state,actor_user_id)
          select v_org,v_check_receipt,v_order,v_order_revision,1,v_check_item,
                 i.quantity,
                 case when i.quantity is null or i.sale_unit_snapshot is null then 0 else i.quantity end,
                 i.sale_unit_snapshot,
                 case when i.quantity is null or i.sale_unit_snapshot is null then 'pending' else 'checked' end,
                 case when v_org='${ORG_A}'::uuid then '${USER_A}'::uuid else '${USER_B}'::uuid end
            from public.crm_order_items i where i.organization_id=v_org and i.id=v_check_item;
        end if;

        -- F02-T03: journal de tarefa e nota são domínio legível pelo membro.
        -- O receipt de comando permanece privado e tem prova própria dedicada.
        select id into v_linked_task from public.crm_tasks
          where organization_id = v_org and order_id = v_order limit 1;
        if v_linked_task is null then
          insert into public.crm_tasks
            (organization_id,title,contact_id,order_id,created_by,revision)
          values (
            v_org,'RLS invariant linked task',v_contact,v_order,
            case when v_org='${ORG_A}'::uuid then '${USER_A}'::uuid else '${USER_B}'::uuid end,1
          ) returning id into v_linked_task;
        end if;
        select id into v_task_receipt from public.crm_task_command_receipts
          where organization_id = v_org and result_task_id = v_linked_task limit 1;
        if v_task_receipt is null then
          v_task_receipt := gen_random_uuid();
          insert into public.crm_task_command_receipts
            (id,organization_id,command_type,request_hash,actor_type,actor_id,
             result_task_id,result_task_revision,result_status)
          values (
            v_task_receipt,v_org,'create_linked_task',decode(repeat('03',32),'hex'),'user',
            case when v_org='${ORG_A}'::uuid then '${USER_A}'::uuid else '${USER_B}'::uuid end,
            v_linked_task,1,'pending'
          );
          insert into public.crm_task_events
            (id,organization_id,task_id,order_id,contact_id,task_revision,event_type,
             from_status,to_status,actor_type,actor_id)
          values (
            v_task_receipt,v_org,v_linked_task,v_order,v_contact,1,'created',null,'pending','user',
            case when v_org='${ORG_A}'::uuid then '${USER_A}'::uuid else '${USER_B}'::uuid end
          );
        end if;
        if not exists (select 1 from public.crm_notes where organization_id = v_org) then
          insert into public.crm_notes
            (id,organization_id,contact_id,order_id,body,actor_user_id)
          values (
            gen_random_uuid(),v_org,v_contact,v_order,'RLS invariant note',
            case when v_org='${ORG_A}'::uuid then '${USER_A}'::uuid else '${USER_B}'::uuid end
          );
        end if;

        -- crm_tasks (migration 0210): o que o time combinou fazer, com prazo.
        -- Entra COM o vínculo de lead porque a tarefa presa a um negócio é o
        -- caso que cruza duas tabelas tenant-aware — se a policy vazasse, o
        -- vizinho leria o combinado E o ponteiro para o funil dele.
        -- (sem crase nesta prosa: o bloco inteiro é um template literal de JS.)
        if not exists (
          select 1 from public.crm_tasks
            where organization_id = v_org and order_id is null
        ) then
          insert into public.crm_tasks (organization_id, title, lead_id)
            values (v_org, 'RLS invariant task',
                    (select id from public.crm_leads where organization_id = v_org limit 1));
        end if;

        if not exists (select 1 from public.push_subscriptions where organization_id = v_org) then
          insert into public.push_subscriptions
            (organization_id, user_id, endpoint, p256dh, auth)
            values (
              v_org,
              case when v_org = '${ORG_A}'::uuid then '${USER_A}'::uuid else '${USER_B}'::uuid end,
              'https://push.example.test/rls-' || v_org::text,
              'p256dh-rls',
              'auth-rls'
            );
        end if;
      end loop;
    end
    $seed$;
  `);
});

/**
 * ⚠️ LISTA FIXA — tabela tenant-aware nova que NÃO entrar aqui passa verde sem
 * RLS. Não existe varredura genérica do tipo "toda tabela com organization_id
 * tem relrowsecurity = true"; quem cria tabela nova acrescenta a linha aqui, no
 * MESMO commit da migration.
 *
 * E conferir o catálogo (`relrowsecurity`, `pg_policy` contendo o nome da
 * função) NÃO substitui este percurso: policy que diga
 * `organization_id in (select fn_user_org_ids()) or true` satisfaz as duas
 * checagens de catálogo e devolve a org inteira do vizinho. Medido — ver o
 * cabeçalho do caso de `contact_field_proposals` abaixo.
 */
export const TABLES = [
  "conversations",
  "messages",
  "contacts",
  "crm_leads",
  "org_memory_versions",
  "org_memory_entries",
  "skill_activations",
  "ai_routers",
  "ai_router_decisions",
  "knowledge_searches",
  // migration 0123 (spec 17 §4b) — guarda e-mail/telefone ditos na conversa.
  "contact_field_proposals",
  // migration 0142 — a escolha de camadas de segurança da organização. Entrou aqui
  // depois de uma auditoria medir que ela NÃO tinha prova comportamental nenhuma:
  // o teste de schema dela conecta como `postgres` (rolbypassrls = t), e com a policy
  // sabotada para `... or true` a suíte seguia 31/31 verde num banco em que o vizinho
  // lia e escrevia. É o modo de falha que o aviso acima descreve, encontrado vivo.
  "org_guardrail_layers",
  "push_subscriptions",
  // migration 0204 — o catálogo de produtos da loja. A leitura é org-scoped sem
  // gate de papel (o `agent` semeado aqui precisa ler para atender), e a ESCRITA
  // exige `manager` — esse segundo eixo é medido em
  // `tests/invariants/catalogo-so-gestor-muda-preco.test.ts`, não aqui.
  "catalog_products",
  // F02-T01 — empresa cliente, separada de organizations (o tenant).
  "crm_companies",
  // F02-T02 — domínio operacional somente leitura para membros. O recibo de
  // comando fica fora desta lista porque authenticated não possui SELECT.
  "crm_orders",
  "crm_order_items",
  "crm_order_events",
  // F02-T12 — journal de conferência; receipt privado fica em PROVA_PROPRIA.
  "crm_order_check_events",
  // F02-T03 — domínios de leitura do membro. Receipt privado fica em PROVA_PROPRIA.
  "crm_task_events",
  "crm_notes",
  // migration 0210 — as tarefas do CRM. A leitura é org-scoped sem gate de papel
  // (o `viewer` precisa ver o que o time combinou); a ESCRITA exige `agent`, e
  // esse segundo eixo NÃO é medido aqui — o usuário semeado é `agent`, então o
  // controle positivo passaria por acerto. Quem mede a escrita é a rota, em
  // `tests/unit/tarefas-rota-nao-tem-porta-dos-fundos.test.ts`.
  "crm_tasks",
  // F01 20260907150000_0219 — o mapa (provider, account_key) → organization_id que o
  // TenantContext consulta para resolver webhook. A leitura é org-scoped sem
  // gate de papel (o atendente vê os canais da própria org); a ESCRITA não tem
  // policy nenhuma de propósito — só service role grava, e o controle disso é
  // o grant (revoke de authenticated + grant select), não predicado.
  "channel_accounts",
  // F01 20260907190000_0221 — a configuração por tenant (§5.2). A leitura é org-scoped
  // sem gate de papel (a UI de configuração lê pelo membro); a ESCRITA não tem
  // policy de propósito — só setSetting (service role) grava, e o controle é
  // o grant, não predicado.
  "tenant_settings",
  // 0227 — texto de sugestões: org + visibilidade da conversa por authenticated.
  "ai_reply_drafts",
  // ⚠️ `webhook_lead_captures` (migration 0174) NÃO entra nesta lista, e a
  // ausência é deliberada: a policy dela exige `manager`, e o usuário semeado
  // aqui é `agent` — o controle positivo falharia por ACERTO, e a "correção"
  // natural seria afrouxar a policy para caber no molde. A prova dela vive em
  // `tests/invariants/historico-de-captacao-rls.test.ts`, que mede as duas
  // direções MAIS o gate de papel (o `viewer` que não lê o formulário).
] as const;

describe("RLS tenant isolation (fn_user_org_ids pattern)", () => {
  for (const table of TABLES) {
    it(`user of org A reads 0 rows of org B in ${table}`, () => {
      const crossTenant = countAs(
        USER_A,
        `select count(*) from public.${table} where organization_id = '${ORG_B}';`,
      );
      expect(crossTenant).toBe(0);
    });

    it(`user of org A still reads their own org rows in ${table} (positive control)`, () => {
      const ownRows = countAs(
        USER_A,
        `select count(*) from public.${table} where organization_id = '${ORG_A}';`,
      );
      expect(ownRows).toBeGreaterThanOrEqual(1);
    });
  }

  it("ai_reply_drafts: org B lê sua sugestão e não lê a de A (direção inversa)", () => {
    expect(
      countAs(
        USER_B,
        `select count(*) from public.ai_reply_drafts where organization_id = '${ORG_B}';`,
      ),
    ).toBeGreaterThanOrEqual(1);
    expect(
      countAs(
        USER_B,
        `select count(*) from public.ai_reply_drafts where organization_id = '${ORG_A}';`,
      ),
    ).toBe(0);
  });

  it("ai_reply_drafts: os dois tenants têm linhas antes de testar as cercas", () => {
    expect(
      Number(
        sql(
          `select count(distinct organization_id) from public.ai_reply_drafts where organization_id in ('${ORG_A}','${ORG_B}');`,
        ),
      ),
    ).toBe(2);
  });

  it("superuser sees both orgs (seed sanity: cross-tenant rows really exist)", () => {
    const total = Number(
      sql(
        `select count(distinct organization_id) from public.contacts where organization_id in ('${ORG_A}','${ORG_B}');`,
      ),
    );
    expect(total).toBe(2);
  });
});
