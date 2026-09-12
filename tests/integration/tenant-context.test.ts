/**
 * F01-T02 — tenant-context contra banco REAL (Postgres efêmero com o baseline).
 *
 * Prova os invariantes de §5.1 que teste unitário não alcança:
 *  - withTenant grava com o GUC app.organization_id aplicado na transação;
 *  - fromJob rejeita payload sem organization_id e CONTA a rejeição;
 *  - fromWebhook resolve tenant por channel_accounts; sem match grava
 *    webhook_quarantine (1 linha, 0 em messages) e conta;
 *  - tenant_ctx_rejected=2 após exatamente 1 job ruim + 1 webhook desconhecido;
 *  - forEachEligibleTenant: 2 elegíveis + 1 inelegível = exatamente 2 runs,
 *    em série.
 */
import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  counterTotal,
  resetCounters,
} from "@/src/obs/counters";
import { forEachEligibleTenant } from "@/src/tenant-context/for-each-eligible-tenant";
import { fromJob } from "@/src/tenant-context/from-job";
import { fromWebhook } from "@/src/tenant-context/from-webhook";
import { TenantResolutionError } from "@/src/tenant-context/types";
import { withTenant } from "@/src/tenant-context/with-tenant";

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 2,
});
const deps = { pool };

const ORG_A = "f0100000-0000-4000-8000-00000000000a";
const ORG_B = "f0100000-0000-4000-8000-00000000000b";
const ORG_C = "f0100000-0000-4000-8000-00000000000c";

async function seedOrgs(): Promise<void> {
  await pool.query(
    `insert into public.organizations (id, slug, display_name, legal_name)
     values ($1, 'tc-org-a', 'TC Org A', 'TC Org A Ltda'),
            ($2, 'tc-org-b', 'TC Org B', 'TC Org B Ltda'),
            ($3, 'tc-org-c', 'TC Org C', 'TC Org C Ltda')
     on conflict (id) do nothing`,
    [ORG_A, ORG_B, ORG_C],
  );
}

describe("tenant-context", () => {
  beforeEach(async () => {
    resetCounters();
    await seedOrgs();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("withTenant aplica o GUC app.organization_id dentro da transação", async () => {
    // Act — lê o GUC de dentro e de fora da transação
    const dentro = await withTenant(
      { organization_id: ORG_A, source: "job" },
      async (db) => {
        const r = await db.query<{ guc: string }>(
          "select current_setting('app.organization_id', true) as guc",
        );
        return r.rows[0]?.guc;
      },
      deps,
    );
    const fora = await pool.query<{ guc: string | null }>(
      "select current_setting('app.organization_id', true) as guc",
    );

    // Assert — transaction-local: dentro é a org; fora, a conexão não herda nada
    expect(dentro).toBe(ORG_A);
    expect(fora.rows[0]?.guc ?? "").toBe("");
  });

  it("fromJob devolve ctx para payload com organization_id UUID", async () => {
    // Act
    const ctx = fromJob({ organization_id: ORG_A, tipo: "teste" });

    // Assert
    expect(ctx).toEqual({ organization_id: ORG_A, source: "job" });
  });

  it("fromJob sem organization_id rejeita e incrementa tenant_ctx_rejected{source=job}", () => {
    // Act + Assert
    expect(() => fromJob({ tipo: "sem-tenant" })).toThrow(TenantResolutionError);
    expect(counterTotal("tenant_ctx_rejected")).toBe(1);
  });

  it("fromWebhook resolve organization_id por channel_accounts", async () => {
    // Arrange
    await pool.query(
      `insert into public.channel_accounts (organization_id, provider, account_key)
       values ($1, 'mock', 'conta-tc-a') on conflict do nothing`,
      [ORG_A],
    );

    // Act
    const ctx = await fromWebhook("mock", "conta-tc-a", undefined, deps);

    // Assert
    expect(ctx).toEqual({ organization_id: ORG_A, source: "webhook" });
  });

  it("webhook sem match: quarentena=1, messages=0, e tenant_ctx_rejected=2 com 1 job ruim + 1 webhook", async () => {
    // Arrange — contadores zerados no beforeEach

    // Act — exatamente as duas rejeições do DoD da F01-T02
    expect(() => fromJob({})).toThrow(TenantResolutionError);
    await expect(
      fromWebhook("mock", "conta-que-nao-existe", { evento: "ping" }, deps),
    ).rejects.toMatchObject({ source: "webhook", reason: "unknown_account" });

    // Assert — 1 linha na quarentena com o payload, 0 em messages, contador = 2
    const quarentena = await pool.query(
      "select provider, account_key, payload, reason from public.webhook_quarantine",
    );
    expect(quarentena.rows).toEqual([
      {
        provider: "mock",
        account_key: "conta-que-nao-existe",
        payload: { evento: "ping" },
        reason: "unknown_account",
      },
    ]);
    const mensagens = await pool.query("select count(*)::int as n from public.messages");
    expect(mensagens.rows[0]?.n).toBe(0);
    expect(counterTotal("tenant_ctx_rejected")).toBe(2);
  });

  it("forEachEligibleTenant: 2 elegíveis + 1 inelegível = exatamente 2 runs, em série", async () => {
    // Arrange — elegibilidade injetada (a fonte real do Setting chega na F01-T05)
    const ordem: string[] = [];
    let simultaneos = 0;
    let picoSimultaneos = 0;

    // Act
    const resultado = await forEachEligibleTenant(
      "orders.recurring_reminder",
      async (ctx) => {
        simultaneos += 1;
        picoSimultaneos = Math.max(picoSimultaneos, simultaneos);
        await new Promise((r) => setTimeout(r, 10));
        ordem.push(ctx.organization_id);
        simultaneos -= 1;
      },
      { ...deps, listEligible: async () => [ORG_A, ORG_B] },
    );

    // Assert — um run por elegível, nenhum para o inelegível, e nunca em paralelo
    expect(ordem).toEqual([ORG_A, ORG_B]);
    expect(ordem).not.toContain(ORG_C);
    expect(picoSimultaneos).toBe(1);
    expect(resultado).toEqual([
      { organization_id: ORG_A, ok: true },
      { organization_id: ORG_B, ok: true },
    ]);
  });
});
