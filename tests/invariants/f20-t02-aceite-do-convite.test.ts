/**
 * F20-T02 — o aceite do convite curto é ATÔMICO (ADR-045 §2; D61 b/d).
 *
 * `fn_aceitar_convite_de_equipe(token, user)` faz numa transação só o que a
 * aplicação faria em três escritas: valida a linha, cria/renova a membership
 * (pela `fn_accept_team_invite` que já existia) e marca o convite como aceito,
 * APAGANDO o e-mail — o vínculo passa a ser `accepted_by` (D61 d).
 *
 * O defeito que isto impede: com o aceite em passos separados, duas abas ou um
 * duplo clique criariam duas aceitações do mesmo convite — e, pior, um convite
 * revogado ou vencido continuaria aceitável enquanto a aplicação não olhasse.
 * Aqui quem decide é o banco, com `for update` na linha.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { motivoDoErro, sql } from "@/tests/invariants/psql-transporte";

const ORG = "f2000002-0000-4000-8000-000000000001";
const USER = "f2000002-9000-4000-8000-000000000001";
const OUTRO = "f2000002-9000-4000-8000-000000000002";
const EMAIL = "convidado@f20.test";

function erroDe(script: string): string | null {
  try {
    sql(script);
    return null;
  } catch (erro) {
    return motivoDoErro(erro);
  }
}
const aceitar = (token: string, user = USER) =>
  `select public.fn_aceitar_convite_de_equipe('${token}', '${user}')`;
const novoConvite = (token: string, email = EMAIL, extra = "") =>
  sql(`insert into public.team_invites (organization_id, token, email, role, expires_at${extra ? ", " + extra.split("=")[0] : ""})
       values ('${ORG}','${token}','${email}','agent', now() + interval '7 days'${extra ? ", " + extra.split("=")[1] : ""})`);
const linha = (token: string, campo: string) =>
  sql(`select coalesce(${campo}::text, 'NULO') from public.team_invites where token = '${token}'`).trim().split("\n").map((l) => l.trim()).at(-1);
const membros = () =>
  sql(`select count(*) from public.user_organizations where organization_id = '${ORG}' and user_id = '${USER}' and accepted_at is not null`)
    .trim().split("\n").map((l) => l.trim()).at(-1);

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values ('${USER}','${EMAIL}'), ('${OUTRO}','outro@f20.test');
    insert into public.organizations (id, slug, legal_name, display_name, status) values ('${ORG}','f20-aceite','F20 Aceite','F20 Aceite','active');
  `);
});

describe("F20-T02 — aceite atômico do convite curto", () => {
  it("aceitar cria a membership, marca o convite e APAGA o e-mail (aceite=4/4)", () => {
    novoConvite("aceite0000000001");
    const antes = membros();
    const erro = erroDe(aceitar("aceite0000000001"));
    expect(erro, "o aceite falhou").toBeNull();
    expect(antes).toBe("0");
    expect(membros(), "a membership não foi criada").toBe("1");
    expect(linha("aceite0000000001", "accepted_by")).toBe(USER);
    expect(linha("aceite0000000001", "email"), "o e-mail ficou guardado depois do aceite (D61 d)").toBe("NULO");
    console.info("f20-t02-aceite: membership=1/1 accepted_by=1/1 email_apagado=1/1 atomico=1/1");
  });

  it("o mesmo convite não é aceito duas vezes, e convite revogado, vencido ou de outra pessoa é recusado (recusas=4/4)", () => {
    const segunda = erroDe(aceitar("aceite0000000001"));
    novoConvite("aceite0000000002", "revogado@f20.test");
    sql(`update public.team_invites set revoked_at = now(), revoked_by = '${USER}', revoked_reason = 'manual' where token = 'aceite0000000002'`);
    const revogado = erroDe(aceitar("aceite0000000002"));
    sql(`insert into public.team_invites (organization_id, token, email, role, expires_at)
         values ('${ORG}','aceite0000000003','vencido@f20.test','agent', now() - interval '1 day')`);
    const vencido = erroDe(aceitar("aceite0000000003"));
    novoConvite("aceite0000000004", "denovo@f20.test");
    const outraPessoa = erroDe(aceitar("aceite0000000004"));
    const inexistente = erroDe(aceitar("naoexisteestetk1"));

    expect(segunda ?? "<passou>", "o convite foi aceito duas vezes").toMatch(/invite_already_accepted|invite_not_found/);
    expect(revogado ?? "<passou>", "convite revogado foi aceito").toMatch(/invite_revoked|invite_not_found/);
    expect(vencido ?? "<passou>", "convite vencido foi aceito").toMatch(/invite_expired|invite_not_found/);
    expect(outraPessoa ?? "<passou>", "aceitou com e-mail diferente do convite").toMatch(/invite_email_mismatch/);
    expect(inexistente ?? "<passou>").toMatch(/invite_not_found/);
    expect(membros(), "uma recusa criou membership").toBe("1");
    console.info("f20-t02-recusas: segunda_aceitacao=1/1 revogado=1/1 vencido=1/1 email_diferente=1/1 inexistente=1/1");
  });

  it("a função é service_only: anon e authenticated não a executam (execute=2/2)", () => {
    const anon = erroDe(`begin; set local role anon; ${aceitar("aceite0000000004")}; rollback;`);
    const auth = erroDe(`begin; set local role authenticated; ${aceitar("aceite0000000004")}; rollback;`);
    expect(anon ?? "<passou>").toMatch(/permission denied/i);
    expect(auth ?? "<passou>").toMatch(/permission denied/i);
    console.info("f20-t02-execute: anon_negado=1/1 authenticated_negado=1/1");
  });
});
