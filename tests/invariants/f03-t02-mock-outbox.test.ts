/**
 * F03-T02 — `mock_outbox` no banco (migration 9014, ADR-017 decisão 1).
 *
 * Mede o que o TypeScript não alcança. A prova do contrato
 * (`tests/unit/f03-t02-channel-adapter-contract.test.ts`) roda contra um pool
 * falso que IMITA o índice único; aqui o índice é o de verdade, e é ele — não o
 * código do adapter — que faz o reenvio da mesma chave não virar uma segunda
 * mensagem.
 *
 * Mede também a postura `service_only` de D35: RLS ligada com ZERO policies e
 * privilégio NENHUM para `anon`/`authenticated`. Nessas tabelas o controle É o
 * grant, então a ausência dele é o invariante — não um detalhe de configuração.
 */
import { describe, expect, it, beforeAll } from "vitest";

import { motivoDoErro, sql } from "@/tests/invariants/psql-transporte";

const ORG = "f0300002-0000-4000-8000-000000000001";
const CONVERSA = "f0300002-1000-4000-8000-000000000001";
const CHAVE = "f03-t02-chave-repetida";

/** Papéis de cliente que NÃO podem ter privilégio nenhum nesta tabela. */
const PAPEIS_DE_CLIENTE = ["anon", "authenticated"] as const;

function ultimaLinha(saida: string): string {
  const linhas = saida
    .split("\n")
    .map((linha) => linha.trim())
    .filter((linha) => linha.length > 0);
  const ultima = linhas.at(-1);
  if (ultima === undefined) throw new Error(`psql não devolveu linha nenhuma: ${saida}`);
  return ultima;
}

function erroDe(script: string): string | null {
  try {
    sql(script);
    return null;
  } catch (error) {
    return motivoDoErro(error);
  }
}

beforeAll(() => {
  sql(`
    insert into public.organizations(id,slug,legal_name,display_name)
      values('${ORG}','f03-t02','F03 T02','F03 T02');
  `);
});

describe("F03-T02 — a tabela existe e é service_only (D35)", () => {
  it("mock_outbox existe com as colunas do contrato e a FK de organização", () => {
    // Arrange — as colunas vêm da lista do contrato; a contagem tem denominador.
    const colunas = [
      "id",
      "organization_id",
      "conversation_id",
      "to_e164",
      "body",
      "idempotency_key",
      "created_at",
    ];

    // Act
    const observado = ultimaLinha(
      sql(`
        select
          (select count(*) from information_schema.columns
            where table_schema='public' and table_name='mock_outbox'
              and column_name in (${colunas.map((c) => `'${c}'`).join(",")})),
          (select count(*) from information_schema.columns
            where table_schema='public' and table_name='mock_outbox'),
          (select count(*) from information_schema.columns
            where table_schema='public' and table_name='mock_outbox'
              and column_name='organization_id' and is_nullable='NO'),
          (select count(*) from pg_constraint
            where conrelid='public.mock_outbox'::regclass
              and contype='f' and confrelid='public.organizations'::regclass
              and confdeltype='c' and convalidated);
      `),
    );

    // Assert — as sete do contrato E sete no total: coluna a mais reprova aqui.
    expect(observado, "mock_outbox fora do desenho da F03-T02").toBe(
      `${colunas.length}|${colunas.length}|1|1`,
    );
    console.info(
      `f03-t02: mock_outbox_colunas=${colunas.length}/${colunas.length} org_not_null=1/1 fk_cascade=1/1`,
    );
  });

  it("RLS está ligada e a tabela tem ZERO policies", () => {
    // Arrange + Act
    const observado = ultimaLinha(
      sql(`
        select
          (select relrowsecurity::int from pg_class where oid='public.mock_outbox'::regclass),
          (select count(*) from pg_policies
            where schemaname='public' and tablename='mock_outbox');
      `),
    );

    // Assert
    expect(observado, "service_only exige RLS ligada e nenhuma policy (D35)").toBe("1|0");
    console.info("f03-t02: rls_ligada=1/1 policies=0/0");
  });

  it("anon e authenticated não têm privilégio nenhum e service_role tem", () => {
    // Arrange + Act — `aclexplode` mede o grant DIRETO, que é o que o revoke
    // remove; `has_table_privilege` sozinho confundiria herança de PUBLIC.
    // PUBLIC entra como `grantee = 0` (não existe `'public'::regrole`), e ele
    // importa: um grant a PUBLIC alcança anon e authenticated sem aparecer no
    // nome de nenhum dos dois.
    const observado = ultimaLinha(
      sql(`
        select
          ${PAPEIS_DE_CLIENTE.map(
            (papel) => `(select count(*) from pg_class c,
              aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
             where c.oid='public.mock_outbox'::regclass and a.grantee='${papel}'::regrole)`,
          ).join(",\n          ")},
          (select count(*) from pg_class c,
            aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
           where c.oid='public.mock_outbox'::regclass and a.grantee=0),
          (select (count(*) > 0)::int from pg_class c,
            aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
           where c.oid='public.mock_outbox'::regclass and a.grantee='service_role'::regrole);
      `),
    );

    // Assert
    const zeros = PAPEIS_DE_CLIENTE.map(() => "0").join("|");
    expect(observado, "mock_outbox exposta a papel de cliente (G-54)").toBe(`${zeros}|0|1`);
    console.info(
      `f03-t02: papeis_fechados=${PAPEIS_DE_CLIENTE.length + 1}/${PAPEIS_DE_CLIENTE.length + 1} service_role_mantido=1/1`,
    );
  });
});

describe("F03-T02 — a idempotência é do índice, não do código", () => {
  it("o índice único recusa a segunda linha com a mesma (organization_id, idempotency_key)", () => {
    // Arrange — a primeira linha entra; a segunda é o reenvio.
    const primeira = erroDe(`
      begin;
      insert into public.mock_outbox(organization_id,conversation_id,to_e164,body,idempotency_key)
        values('${ORG}','${CONVERSA}','+5511900000001','primeiro envio','${CHAVE}');
      rollback;
    `);

    // Act
    const segunda = erroDe(`
      begin;
      insert into public.mock_outbox(organization_id,conversation_id,to_e164,body,idempotency_key)
        values('${ORG}','${CONVERSA}','+5511900000001','primeiro envio','${CHAVE}');
      insert into public.mock_outbox(organization_id,conversation_id,to_e164,body,idempotency_key)
        values('${ORG}','${CONVERSA}','+5511900000001','reenvio da mesma chave','${CHAVE}');
      rollback;
    `);

    // Assert
    expect(primeira, "o primeiro envio foi recusado").toBeNull();
    expect(segunda, "o índice único aceitou a segunda linha da mesma chave").not.toBeNull();
    expect(segunda).toMatch(/mock_outbox_org_idempotency_unique/);
    console.info("f03-t02: primeiro_envio_aceito=1/1 reenvio_recusado=1/1");
  });

  it("`on conflict do nothing` — o caminho do adapter — deixa UMA linha", () => {
    // Arrange + Act — é literalmente o INSERT de src/channels/mock.ts, duas vezes.
    const contagem = ultimaLinha(
      sql(`
        begin;
        insert into public.mock_outbox(organization_id,conversation_id,to_e164,body,idempotency_key)
          values('${ORG}','${CONVERSA}','+5511900000001','envio','${CHAVE}')
          on conflict (organization_id, idempotency_key) do nothing;
        insert into public.mock_outbox(organization_id,conversation_id,to_e164,body,idempotency_key)
          values('${ORG}','${CONVERSA}','+5511900000001','reenvio','${CHAVE}')
          on conflict (organization_id, idempotency_key) do nothing;
        select count(*)::text || '/' || 1::text from public.mock_outbox
          where organization_id='${ORG}' and idempotency_key='${CHAVE}';
        rollback;
      `)
        .split("\n")
        .map((linha) => linha.trim())
        .filter((linha) => /^\d+\/\d+$/.test(linha))
        .at(-1) ?? "",
    );

    // Assert — e o corpo é o do PRIMEIRO envio: `do nothing` não reescreve.
    expect(contagem, "o mock duplicou a linha do reenvio").toBe("1/1");
    console.info(`f03-t02: linhas_apos_reenvio=${contagem}`);
  });
});

describe("F03-T02 — o tenant é obrigatório", () => {
  it("linha sem organização é recusada", () => {
    // Arrange + Act
    const erro = erroDe(`
      begin;
      insert into public.mock_outbox(conversation_id,to_e164,body,idempotency_key)
        values('${CONVERSA}','+5511900000001','sem tenant','f03-t02-sem-tenant');
      rollback;
    `);

    // Assert
    expect(erro, "mock_outbox aceitou linha sem organization_id (D06/D20)").not.toBeNull();
    expect(erro).toMatch(/organization_id/);
    console.info("f03-t02: escrita_sem_tenant_recusada=1/1");
  });
});
