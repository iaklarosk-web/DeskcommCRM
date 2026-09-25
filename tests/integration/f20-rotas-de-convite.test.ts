/**
 * F20-T03 — as rotas de convite respeitam a matriz de papéis (ADR-045 §4; D61 c).
 *
 * Quem vê pendentes e revoga: `tenant_admin` e `manager` da própria organização
 * (o `manager` já cuida de equipe e fila desde a F13). `agent` e `viewer` não —
 * um atendente não cancela o acesso de um colega. E nada atravessa organização:
 * revogar convite de outro tenant responde como se ele não existisse.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { podeGerirConvites, revogarConviteDaOrganizacao } from "@/src/convites/politica";
import { emitirConvite, listarPendentes } from "@/src/convites/repositorio";

const rawPort = process.env.TEST_DB_PORT;
if (!rawPort) throw new Error("TEST_DB_PORT obrigatório: rode com pnpm test:integration");
const port = Number(rawPort);

const ORG = "f2000004-0000-4000-8000-000000000001";
const ORG_B = "f2000004-0000-4000-8000-000000000002";
const DONO = "f2000004-9000-4000-8000-000000000001";
let pool: pg.Pool;

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`, max: 4 });
  await pool.query(`insert into auth.users (id, email) values ($1,'dono4@f20.test')`, [DONO]);
  await pool.query(
    `insert into public.organizations (id, slug, legal_name, display_name, status) values
       ($1,'f20-rotas','F20 Rotas','F20 Rotas','active'), ($2,'f20-rotas-b','F20 Rotas B','F20 Rotas B','active')`,
    [ORG, ORG_B],
  );
});
afterAll(async () => {
  await pool.end();
});

describe("F20-T03 — quem pode gerir convites", () => {
  it("tenant_admin e manager podem; agent e viewer não (roles_negados=2/2)", () => {
    expect(podeGerirConvites("admin")).toBe(true);
    expect(podeGerirConvites("manager")).toBe(true);
    expect(podeGerirConvites("agent")).toBe(false);
    expect(podeGerirConvites("viewer")).toBe(false);
    console.info("f20-politica: admin=ok manager=ok agent=negado viewer=negado roles_negados=2/2");
  });

  it("revogar convite de OUTRA organização não funciona, e o convite continua vivo lá (cross_org_denied=1/1)", async () => {
    const { convite } = await emitirConvite(
      { organization_id: ORG_B, email: "alvo@f20.test", role: "agent", invited_by: DONO, app_url: "https://x.test" },
      { pool },
    );
    const tentativa = await revogarConviteDaOrganizacao(
      { organization_id: ORG, invite_id: convite.id, papel: "admin", revoked_by: DONO },
      { pool },
    );
    expect(tentativa).toEqual({ ok: false, motivo: "nao_encontrado" });
    expect((await listarPendentes(ORG_B, { pool })).map((c) => c.id)).toContain(convite.id);

    const semPapel = await revogarConviteDaOrganizacao(
      { organization_id: ORG_B, invite_id: convite.id, papel: "agent", revoked_by: DONO },
      { pool },
    );
    expect(semPapel).toEqual({ ok: false, motivo: "sem_permissao" });
    expect((await listarPendentes(ORG_B, { pool })).map((c) => c.id)).toContain(convite.id);

    const certo = await revogarConviteDaOrganizacao(
      { organization_id: ORG_B, invite_id: convite.id, papel: "manager", revoked_by: DONO },
      { pool },
    );
    expect(certo).toEqual({ ok: true });
    expect((await listarPendentes(ORG_B, { pool })).map((c) => c.id)).not.toContain(convite.id);
    console.info("f20-rotas: cross_org_denied=1/1 sem_permissao=1/1 manager_revoga=1/1");
  });
});
