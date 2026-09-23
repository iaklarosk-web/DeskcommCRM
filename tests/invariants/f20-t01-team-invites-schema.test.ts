/**
 * F20-T01 — o convite de equipe vira LINHA, com ciclo de vida (ADR-045 §1; D59/D61).
 *
 * O que esta prova trava:
 *   1. `team_invites` é `service_only` (D35): RLS ligada, zero policies, nenhum
 *      privilégio a anon/authenticated — o `token` da linha É a credencial do
 *      convite e não pode ser legível pelo PostgREST com a anon key.
 *   2. **Um convite VIVO por pessoa por organização**, garantido pelo índice
 *      único PARCIAL (`where accepted_at is null and revoked_at is null`) — é
 *      ele que faz "reenviar revoga o anterior" (D61 b) ser garantia do banco e
 *      não promessa da aplicação. Aceito ou revogado sai do caminho do índice, e
 *      a mesma pessoa pode ser convidada de novo.
 *   3. O vocabulário é fechado: `role` só os quatro papéis de D15, e
 *      `revoked_reason` só `manual`/`reenviado` — enum, nunca frase (G-78).
 *   4. Coerência de estado: `accepted_at` exige `accepted_by`; `revoked_at`
 *      exige `revoked_reason`; um convite não pode estar aceito E revogado.
 *   5. O token tem forma e tamanho (16 chars base64url = 96 bits) — token curto
 *      demais é convite adivinhável numa rota pública.
 *
 * Prova COMPORTAMENTAL (RETOMADA regra 6), com contagem e denominador (G-14).
 */
import { beforeAll, describe, expect, it } from "vitest";

import { motivoDoErro, sql } from "@/tests/invariants/psql-transporte";

const ORG = "f2000001-0000-4000-8000-000000000001";
const ORG_B = "f2000001-0000-4000-8000-000000000002";
const USER = "f2000001-9000-4000-8000-000000000001";
const USER_B = "f2000001-9000-4000-8000-000000000002";
const OPERACOES = ["select", "insert", "update", "delete"] as const;
const SEM_ERRO = "<o comando PASSOU: o papel alcançou a tabela>";

function erroDe(script: string): string | null {
  try {
    sql(script);
    return null;
  } catch (erro) {
    return motivoDoErro(erro);
  }
}
const claims = (userId: string) => `select set_config('request.jwt.claims','{"sub":"${userId}"}',true);`;
function erroSob(papel: "anon" | "authenticated", comando: string, usuario?: string): string | null {
  return erroDe(`begin; set local role ${papel}; ${usuario ? claims(usuario) : ""} ${comando}; rollback;`);
}
function comandoDe(op: (typeof OPERACOES)[number]): string {
  switch (op) {
    case "select":
      return "select count(*) from public.team_invites";
    case "insert":
      return `insert into public.team_invites (organization_id, token, email, role, expires_at)
              values ('${ORG}','aaaaaaaaaaaaaaaa','x@y.z','agent', now() + interval '7 days')`;
    case "update":
      return "update public.team_invites set email = 'z@z.z'";
    case "delete":
      return "delete from public.team_invites";
  }
}
const convite = (token: string, email: string, org = ORG, extra = "") =>
  `insert into public.team_invites (organization_id, token, email, role, invited_by, expires_at${extra ? ", " + extra.split("=")[0] : ""})
   values ('${org}','${token}','${email}','agent','${USER}', now() + interval '7 days'${extra ? ", " + extra.split("=")[1] : ""})`;

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values ('${USER}','f20-a@invariant.test'), ('${USER_B}','f20-b@invariant.test');
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG}','f20-convites','F20 Convites','F20'),
      ('${ORG_B}','f20-convites-b','F20 Convites B','F20 B');
    insert into public.user_organizations (organization_id, user_id, role, accepted_at) values
      ('${ORG}','${USER}','admin',now()), ('${ORG_B}','${USER_B}','admin',now());
  `);
});

describe("F20-T01 — team_invites: ciclo de vida e isolamento", () => {
  it("é service_only: anon e authenticated negados nas 4 operações; service_role escreve e lê de volta (rls=8/8)", () => {
    const negadas: string[] = [];
    for (const papel of ["anon", "authenticated"] as const) {
      for (const op of OPERACOES) {
        const erro = erroSob(papel, comandoDe(op), papel === "authenticated" ? USER : undefined) ?? SEM_ERRO;
        negadas.push(/permission denied|violates row-level security/i.test(erro) ? `${papel}:${op}` : `${papel}:${op}:PASSOU(${erro})`);
      }
    }
    expect(negadas.filter((n) => n.includes(":PASSOU")), "papel de cliente alcançou team_invites").toEqual([]);
    const policies = sql(`select count(*) from pg_policies where tablename = 'team_invites'`).trim();
    const rls = sql(`select relrowsecurity::text from pg_class where oid = 'public.team_invites'::regclass`).trim();
    expect(policies).toBe("0");
    expect(["t", "true"]).toContain(rls);
    const lido = sql(`begin; set local role service_role; ${convite("bbbbbbbbbbbbbbbb", "servico@x.test")}; select count(*) from public.team_invites where token = 'bbbbbbbbbbbbbbbb'; rollback;`)
      .split("\n").map((l) => l.trim());
    expect(lido, "service_role não conseguiu escrever/ler (guarda de vacuidade)").toContain("1");
    console.info(`f20-t01-rls: negadas=${negadas.length}/8 policies=0 rls=on service_role_le=1/1`);
  });

  it("um convite VIVO por pessoa por organização; aceito ou revogado libera novo convite (indice_parcial=4/4)", () => {
    // A asserção é o EFEITO no banco, não o texto do erro: o que importa é
    // quantos convites VIVOS sobraram para aquela pessoa naquela organização.
    const vivos = (email: string, org = ORG) =>
      sql(`select count(*) from public.team_invites where organization_id = '${org}' and lower(email) = lower('${email}') and accepted_at is null and revoked_at is null`)
        .trim().split("\n").map((l) => l.trim()).at(-1);

    expect(erroDe(convite("cccccccccccccccc", "dup@x.test")), "o primeiro convite foi recusado").toBeNull();
    const segundo = erroDe(convite("dddddddddddddddd", "dup@x.test"));
    const caixaAlta = erroDe(convite("eeeeeeeeeeeeeeee", "DUP@X.TEST"));
    expect(segundo, "o segundo convite VIVO para a mesma pessoa passou").not.toBeNull();
    expect(caixaAlta, "caixa alta abriu um segundo convite vivo").not.toBeNull();
    expect(vivos("dup@x.test"), "sobrou mais de um convite vivo").toBe("1");

    // Outra organização convida a mesma pessoa sem esbarrar no índice.
    expect(erroDe(convite("ffffffffffffffff", "dup@x.test", ORG_B)), "outra organização foi barrada").toBeNull();
    expect(vivos("dup@x.test", ORG_B)).toBe("1");

    // Revogar libera o caminho: é assim que "reenviar" funciona (D61 b).
    sql(`update public.team_invites set revoked_at = now(), revoked_by = '${USER}', revoked_reason = 'reenviado' where token = 'cccccccccccccccc'`);
    expect(erroDe(convite("gggggggggggggggg", "dup@x.test")), "revogar não liberou convite novo").toBeNull();
    expect(vivos("dup@x.test"), "o revogado continuou contando como vivo").toBe("1");

    // Aceitar também libera (a pessoa pode ser reconvidada depois de sair).
    sql(`update public.team_invites set accepted_at = now(), accepted_by = '${USER}' where token = 'gggggggggggggggg'`);
    expect(erroDe(convite("hhhhhhhhhhhhhhhh", "dup@x.test")), "aceitar não liberou convite novo").toBeNull();
    expect(vivos("dup@x.test")).toBe("1");
    console.info("f20-t01-indice: segundo_recusado=1/1 caixa_alta_recusada=1/1 outra_org=1/1 apos_revogar=1/1 apos_aceitar=1/1 vivos=1");
  });

  it("vocabulário fechado e coerência de estado: role, revoked_reason, aceito×revogado, token com forma (checks=5/5)", () => {
    const papelInvalido = erroDe(convite("pppppppppppppppp", "p@x.test").replace("'agent'", "'dono'"));
    const motivoInvalido = erroDe(`insert into public.team_invites (organization_id, token, email, role, expires_at, revoked_at, revoked_by, revoked_reason)
      values ('${ORG}','iiiiiiiiiiiiiiii','m@x.test','agent', now()+interval '7 days', now(), '${USER}', 'porque sim')`);
    const aceitoSemQuem = erroDe(`insert into public.team_invites (organization_id, token, email, role, expires_at, accepted_at)
      values ('${ORG}','jjjjjjjjjjjjjjjj','a@x.test','agent', now()+interval '7 days', now())`);
    const aceitoERevogado = erroDe(`insert into public.team_invites (organization_id, token, email, role, expires_at, accepted_at, accepted_by, revoked_at, revoked_by, revoked_reason)
      values ('${ORG}','kkkkkkkkkkkkkkkk','ar@x.test','agent', now()+interval '7 days', now(), '${USER}', now(), '${USER}', 'manual')`);
    const tokenCurto = erroDe(convite("curto", "t@x.test"));
    expect(papelInvalido ?? SEM_ERRO).toContain("team_invites_role_check");
    expect(motivoInvalido ?? SEM_ERRO).toContain("team_invites_revoked_reason_check");
    expect(aceitoSemQuem ?? SEM_ERRO).toContain("team_invites_aceite_coerente");
    expect(aceitoERevogado ?? SEM_ERRO).toContain("team_invites_nao_aceito_e_revogado");
    expect(tokenCurto ?? SEM_ERRO).toContain("team_invites_token_check");
    console.info("f20-t01-vocabulario: role=1/1 motivo=1/1 aceite_coerente=1/1 aceito_x_revogado=1/1 token_forma=1/1");
  });
});
