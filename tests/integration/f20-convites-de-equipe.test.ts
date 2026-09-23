/**
 * F20 — o ciclo de vida do convite contra o banco de verdade (ADR-045 §2; D61).
 *
 * Mede o que a unit não alcança: reenviar revoga o anterior (e o link antigo
 * para de funcionar na hora), aceitar apaga o e-mail, o convite aceito não é
 * aceito de novo, e a lista de pendentes mostra o que ainda vale.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  aceitarConvitePorToken,
  emitirConvite,
  lerConvitePorToken,
  listarPendentes,
  revogarConvite,
} from "@/src/convites/repositorio";
import { gravarLinhaDoVerify } from "@/tests/lib/verify-metrics";

const ORG = "f2000003-0000-4000-8000-000000000001";
const DONO = "f2000003-9000-4000-8000-000000000001";
const CONVIDADO = "f2000003-9000-4000-8000-000000000002";
const OUTRO = "f2000003-9000-4000-8000-000000000003";
const EMAIL = "novo.membro@f20.test";
const APP = "https://crm.kntecnologia.app";

const rawPort = process.env.TEST_DB_PORT;
if (!rawPort) throw new Error("TEST_DB_PORT obrigatório: rode com pnpm test:integration");
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("TEST_DB_PORT inválido");

let pool: pg.Pool;
const medidas = { link_len: 0, reenvio_revoga: 0, aceite: 0, email_apagado: 0, duas_aceitacoes: 0, revogado_recusado: 0, pendentes: 0 };

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`, max: 4 });
  await pool.query(`insert into auth.users (id, email) values ($1,'dono@f20.test'), ($2,$4), ($3,'terceiro@f20.test')`, [DONO, CONVIDADO, OUTRO, EMAIL]);
  await pool.query(`insert into public.organizations (id, slug, legal_name, display_name, status) values ($1,'f20-ciclo','F20 Ciclo','F20 Ciclo','active')`, [ORG]);
  await pool.query(`insert into public.user_organizations (organization_id, user_id, role, accepted_at) values ($1,$2,'admin',now())`, [ORG, DONO]);
});

afterAll(async () => {
  await pool.end();
});

describe("F20 — convite curto: emitir, reenviar, aceitar, revogar", () => {
  it("o link cabe no WhatsApp e o convite nasce vivo (link_len<=64=1/1)", async () => {
    const { convite, link, revogados } = await emitirConvite(
      { organization_id: ORG, email: EMAIL, role: "agent", invited_by: DONO, app_url: APP },
      { pool },
    );
    expect(link.length).toBeLessThanOrEqual(64);
    expect(link).toBe(`${APP}/i/${convite.token}`);
    expect(revogados).toBe(0);
    const lido = await lerConvitePorToken(convite.token, { pool });
    expect(lido).toMatchObject({ convite: { organization_id: ORG, email: EMAIL, role: "agent" } });
    medidas.link_len = link.length;
    console.info(`f20-emissao: link_len=${link.length}/64 vivo=1/1 revogados=0`);
  });

  it("reenviar revoga o anterior e o link antigo para de valer na hora", async () => {
    const primeiro = await emitirConvite({ organization_id: ORG, email: "reenvio@f20.test", role: "viewer", invited_by: DONO, app_url: APP }, { pool });
    const segundo = await emitirConvite({ organization_id: ORG, email: "REENVIO@f20.test", role: "agent", invited_by: DONO, app_url: APP }, { pool });
    expect(segundo.revogados, "o reenvio não revogou o convite anterior").toBe(1);
    expect(await lerConvitePorToken(primeiro.convite.token, { pool })).toEqual({ recusa: "invite_revoked" });
    expect(await lerConvitePorToken(segundo.convite.token, { pool })).toMatchObject({ convite: { role: "agent" } });
    const pendentes = await listarPendentes(ORG, { pool });
    expect(pendentes.filter((p) => p.email === "reenvio@f20.test")).toHaveLength(1);
    medidas.reenvio_revoga = 1;
    console.info("f20-reenvio: revogados=1/1 link_antigo_recusado=1/1 pendente_unico=1/1");
  });

  it("aceitar cria a membership, apaga o e-mail e não acontece duas vezes (aceite=1/1 duas_aceitacoes=1/1)", async () => {
    const { convite } = await emitirConvite({ organization_id: ORG, email: EMAIL, role: "manager", invited_by: DONO, app_url: APP }, { pool });
    const r = await aceitarConvitePorToken({ token: convite.token, user_id: CONVIDADO }, { pool });
    expect(r).toMatchObject({ ok: true, organization_id: ORG });
    const { rows: membro } = await pool.query<{ role: string }>(
      `select role from public.user_organizations where organization_id=$1 and user_id=$2 and accepted_at is not null`, [ORG, CONVIDADO],
    );
    expect(membro.map((m) => m.role)).toEqual(["manager"]);
    const { rows: linha } = await pool.query<{ email: string | null; accepted_by: string | null }>(
      `select email, accepted_by from public.team_invites where token=$1`, [convite.token],
    );
    expect(linha[0]!.email, "o e-mail ficou guardado depois do aceite (D61 d)").toBeNull();
    expect(linha[0]!.accepted_by).toBe(CONVIDADO);
    expect(await aceitarConvitePorToken({ token: convite.token, user_id: CONVIDADO }, { pool })).toEqual({ ok: false, recusa: "invite_already_accepted" });
    medidas.aceite = 1; medidas.email_apagado = 1; medidas.duas_aceitacoes = 1;
    console.info("f20-aceite: membership=1/1 email_apagado=1/1 segunda_recusada=1/1");
  });

  it("convite de outra pessoa e convite revogado à mão são recusados com motivo (recusas=2/2)", async () => {
    const { convite } = await emitirConvite({ organization_id: ORG, email: "alheio@f20.test", role: "agent", invited_by: DONO, app_url: APP }, { pool });
    expect(await aceitarConvitePorToken({ token: convite.token, user_id: OUTRO }, { pool })).toEqual({ ok: false, recusa: "invite_email_mismatch" });
    expect(await revogarConvite({ organization_id: ORG, invite_id: convite.id, revoked_by: DONO }, { pool })).toBe(true);
    expect(await revogarConvite({ organization_id: ORG, invite_id: convite.id, revoked_by: DONO }, { pool }), "revogou duas vezes o mesmo convite").toBe(false);
    expect(await aceitarConvitePorToken({ token: convite.token, user_id: OUTRO }, { pool })).toEqual({ ok: false, recusa: "invite_revoked" });
    medidas.revogado_recusado = 1;
    console.info("f20-recusas: email_diferente=1/1 revogado=1/1 revogar_duas_vezes=false");
  });

  it("repetir a criação idempotente reaproveita o convite vivo, em vez de revogar o link já enviado (idempotencia=1/1)", async () => {
    const primeiro = await emitirConvite(
      { organization_id: ORG, email: "idempotente@f20.test", role: "admin", invited_by: DONO, app_url: APP },
      { pool },
    );
    const repetido = await emitirConvite(
      { organization_id: ORG, email: "idempotente@f20.test", role: "admin", invited_by: DONO, app_url: APP, reaproveitar_vivo: true },
      { pool },
    );
    expect(repetido.convite.token, "a repetição emitiu um convite novo").toBe(primeiro.convite.token);
    expect(repetido.revogados).toBe(0);
    expect(await lerConvitePorToken(primeiro.convite.token, { pool })).toMatchObject({ convite: { role: "admin" } });
    // Já uma emissão NORMAL (reenviar) continua revogando.
    const reenvio = await emitirConvite(
      { organization_id: ORG, email: "idempotente@f20.test", role: "admin", invited_by: DONO, app_url: APP },
      { pool },
    );
    expect(reenvio.convite.token).not.toBe(primeiro.convite.token);
    expect(reenvio.revogados).toBe(1);
    console.info("f20-idempotencia: repeticao_reaproveita=1/1 reenvio_revoga=1/1");
  });

  it("grava a linha invites: do bloco", async () => {
    const pendentes = await listarPendentes(ORG, { pool });
    medidas.pendentes = pendentes.length;
    const linha =
      `invites: link_len=${medidas.link_len}/64 reenvio_revoga=${medidas.reenvio_revoga}/1 aceite=${medidas.aceite}/1 ` +
      `email_apagado_no_aceite=${medidas.email_apagado}/1 duas_aceitacoes=${medidas.duas_aceitacoes}/1 ` +
      `revogado_recusado=${medidas.revogado_recusado}/1 pendentes_listados=${medidas.pendentes}`;
    gravarLinhaDoVerify("invites", linha);
    expect(linha).toContain("link_len=");
    console.info(linha);
  });
});
