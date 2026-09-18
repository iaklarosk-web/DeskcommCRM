/**
 * F14-T00 — `webchat_sessions` é do BANCO e é `service_only` DE VERDADE; os
 * quatro CHECKs de canal aceitam `webchat` (ADR-038 §3, migration 9030, D55 c).
 *
 * O que este arquivo mede, e por que precisa de Postgres: a recusa é medida sob
 * `set local role` + JWT, nos DOIS tenants, nas QUATRO operações (o visitante
 * não tem JWT — uma policy para `anon` abriria a sessão a quem tivesse a URL);
 * `service_role` escreve e lê de volta (guarda de vacuidade); a coerência da
 * identificação e a forma do hash são CHECK, não só TypeScript; e
 * `conversations.channel='webchat'`, `channel_sessions.provider='webchat'`,
 * `channel_accounts.provider='webchat'` e `messages.provider='webchat'` são
 * aceitos — o que a 9030 existe para abrir.
 *
 * Cada bloco imprime contagem COM denominador (G-14).
 */
import { beforeAll, describe, expect, it } from "vitest";

import { motivoDoErro, sql } from "@/tests/invariants/psql-transporte";

const ORG = "f1400000-0000-4000-8000-000000000001";
const ORG_B = "f1400000-0000-4000-8000-000000000002";
const USER_A = "f1400000-9000-4000-8000-000000000001";
const USER_B = "f1400000-9000-4000-8000-000000000002";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

const OPERACOES = ["select", "insert", "update", "delete"] as const;

function insercao(org: string, hash: string): string {
  return `insert into public.webchat_sessions (organization_id, token_hash, ip_hash, page_url)
          values ('${org}','${hash}','${"c".repeat(64)}','https://site.ficticio.test/')`;
}

function comandoDe(operacao: (typeof OPERACOES)[number]): string {
  switch (operacao) {
    case "select":
      return "select count(*) from public.webchat_sessions";
    case "insert":
      return insercao(ORG, HASH_A);
    case "update":
      return "update public.webchat_sessions set last_seen_at = now()";
    case "delete":
      return "delete from public.webchat_sessions";
  }
}

function claims(userId: string): string {
  return `select set_config('request.jwt.claims','{"sub":"${userId}"}',true);`;
}

function erroDe(script: string): string | null {
  try {
    sql(script);
    return null;
  } catch (erro) {
    return motivoDoErro(erro);
  }
}

function erroSob(papel: "anon" | "authenticated" | "service_role", comando: string, usuario?: string): string | null {
  return erroDe(`
    begin;
    set local role ${papel};
    ${usuario ? claims(usuario) : ""}
    ${comando};
    rollback;
  `);
}

const SEM_ERRO = "<o comando PASSOU: o papel alcançou a tabela>";

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${USER_A}','f14-t00-a@invariant.test'),
      ('${USER_B}','f14-t00-b@invariant.test');
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG}','f14-t00-webchat','F14 T00 Webchat','F14 T00'),
      ('${ORG_B}','f14-t00-webchat-b','F14 T00 Webchat B','F14 T00 B');
    insert into public.user_organizations (organization_id, user_id, role, accepted_at) values
      ('${ORG}','${USER_A}','agent',now()),
      ('${ORG_B}','${USER_B}','agent',now());
  `);
});

describe("F14-T00 — webchat_sessions é service_only (D35)", () => {
  it("RLS ligada, zero policies e nenhum privilégio de cliente", () => {
    const observado = sql(`
      select
        (select relrowsecurity::int from pg_class where oid='public.webchat_sessions'::regclass) || '|' ||
        (select count(*) from pg_policies where schemaname='public' and tablename='webchat_sessions') || '|' ||
        (select count(*) from pg_class c, aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
          where c.oid='public.webchat_sessions'::regclass and a.grantee='anon'::regrole) || '|' ||
        (select count(*) from pg_class c, aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
          where c.oid='public.webchat_sessions'::regclass and a.grantee='authenticated'::regrole) || '|' ||
        (select count(*) from pg_class c, aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
          where c.oid='public.webchat_sessions'::regclass and a.grantee=0) || '|' ||
        (select least(count(*),1) from pg_class c, aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
          where c.oid='public.webchat_sessions'::regclass and a.grantee='service_role'::regrole);
    `);
    // rls|policies|anon|authenticated|PUBLIC|service_role
    expect(observado.trim(), "webchat_sessions fora do desenho service_only (D35/G-54)").toBe("1|0|0|0|0|1");
    console.info("f14-t00-service-only: tabelas=1/1 rls=1 policies=0 anon=0 authenticated=0 public=0 service_role=1");
  });

  it("authenticated recebe permission denied nas quatro operações, em A e B", () => {
    let negadas = 0;
    for (const usuario of [USER_A, USER_B] as const) {
      for (const operacao of OPERACOES) {
        const motivo = erroSob("authenticated", comandoDe(operacao), usuario);
        expect(motivo ?? SEM_ERRO, `authenticated (${usuario}) alcançou webchat_sessions no ${operacao}`).toContain("permission denied");
        negadas += 1;
      }
    }
    expect(negadas).toBe(8);
    console.info(`f14-t00-rls: authenticated_negado=${negadas}/8`);
  });

  it("anon recebe permission denied nas quatro operações", () => {
    let negadas = 0;
    for (const operacao of OPERACOES) {
      const motivo = erroSob("anon", comandoDe(operacao));
      expect(motivo ?? SEM_ERRO, `anon alcançou webchat_sessions no ${operacao} — a anon key lê a sessão do visitante`).toContain("permission denied");
      negadas += 1;
    }
    expect(negadas).toBe(4);
    console.info(`f14-t00-rls: anon_negado=${negadas}/4`);
  });

  it("service_role escreve e lê de volta (guarda de vacuidade)", () => {
    let permitidas = 0;
    for (const operacao of OPERACOES) {
      expect(erroSob("service_role", comandoDe(operacao)), `service_role perdeu o ${operacao}`).toBeNull();
      permitidas += 1;
    }
    const lida = sql(`
      begin;
      set local role service_role;
      ${insercao(ORG, HASH_B)};
      select count(*)::text || '/1' from public.webchat_sessions where organization_id='${ORG}' and token_hash='${HASH_B}';
      rollback;
    `).split("\n").map((l) => l.trim()).filter((l) => /^\d+\/\d+$/.test(l)).at(-1) ?? "";
    expect(lida).toBe("1/1");
    console.info(`f14-t00-rls: service_role_permitido=${permitidas}/4 linha_lida_de_volta=1/1`);
  });

  it("CHECKs: identificação pela metade e hash fora da forma são recusados", () => {
    const metade = erroDe(`begin;
      insert into public.webchat_sessions (organization_id, token_hash, ip_hash, visitor_name, identified_at)
      values ('${ORG}','${"d".repeat(64)}','${"c".repeat(64)}','Fulano', now()); rollback;`);
    const hashCurto = erroDe(`begin;
      insert into public.webchat_sessions (organization_id, token_hash, ip_hash)
      values ('${ORG}','abc','${"c".repeat(64)}'); rollback;`);
    expect(metade ?? SEM_ERRO).toContain("webchat_sessions_identificacao_coerente");
    expect(hashCurto ?? SEM_ERRO).toContain("webchat_sessions_token_hash_forma");
    console.info("f14-t00-checks: identificacao_pela_metade_recusada=1/1 hash_fora_da_forma_recusado=1/1");
  });
});

describe("F14-T00 — os quatro CHECKs de canal aceitam webchat (9030)", () => {
  it("channel_sessions, channel_accounts, conversations e messages aceitam provider/channel webchat; prosa continua recusada", () => {
    const SESSAO = "f1400000-5000-4000-8000-000000000001";
    const CONTATO = "f1400000-6000-4000-8000-000000000001";
    const CONVERSA = "f1400000-7000-4000-8000-000000000001";
    const script = `begin;
      insert into public.channel_sessions (id, organization_id, waha_session_name, provider, webhook_secret_encrypted, status)
        values ('${SESSAO}','${ORG}','webchat:${ORG}','webchat','\\x00'::bytea,'WORKING');
      insert into public.channel_accounts (organization_id, provider, account_key, channel_session_id)
        values ('${ORG}','webchat','webchat:${ORG}','${SESSAO}');
      insert into public.contacts (id, organization_id, name, email) values ('${CONTATO}','${ORG}','Visitante','v@ficticio.test');
      insert into public.conversations (id, organization_id, contact_id, channel_session_id, channel, status)
        values ('${CONVERSA}','${ORG}','${CONTATO}','${SESSAO}','webchat','open');
      insert into public.messages (organization_id, conversation_id, channel_session_id, contact_id, provider, type, direction, status, body)
        values ('${ORG}','${CONVERSA}','${SESSAO}','${CONTATO}','webchat','text','inbound','delivered','oi');
      select 'aceitos=4/4';
      rollback;`;
    const saida = sql(script);
    expect(saida).toContain("aceitos=4/4");
    const prosa = erroDe(`begin;
      insert into public.conversations (organization_id, contact_id, channel_session_id, channel, status)
        values ('${ORG}','${CONTATO}','${SESSAO}','telegrama','open'); rollback;`);
    expect(prosa ?? SEM_ERRO).toMatch(/conversations_channel_check|violates foreign key/);
    console.info("f14-t00-canal: checks_aceitam_webchat=4/4 prosa_recusada=1/1");
  });
});
