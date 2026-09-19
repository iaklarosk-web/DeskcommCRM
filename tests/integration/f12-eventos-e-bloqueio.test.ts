/**
 * F12-T03/T06 — dois invariantes AUTOCONTIDOS, um por caso, para os mutantes
 * 63 e 64 (G-38): cada caso semeia a própria organização e assinatura, então
 * pode rodar sozinho por `-t` sem depender da ordem de `f12-assinatura.test.ts`
 * (que percorre o ciclo inteiro numa organização só).
 *
 *  - Duplicata (G-57): a segunda entrega do MESMO `(gateway, event_ref)` não
 *    ativa de novo — `applied=false, ignored_reason=duplicate`, 1 evento
 *    gravado, 1 fatura paga.
 *  - Bloqueio (D44): `blocked` é `read_only` — escrita negada, leitura e
 *    cobrança permitidas, capability negada sem chamar o provedor.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { aplicarEventoDoGateway, criarAssinatura, escritaPermitida, estadoDeAcesso, iniciarCheckout } from "@/src/billing";
import { withEntitlement, EntitlementDenied } from "@/src/entitlement";
import type { TenantCtx } from "@/src/tenant-context";

const rawPort = process.env.TEST_DB_PORT;
if (!rawPort) throw new Error("TEST_DB_PORT obrigatório: rode com pnpm test:integration");
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("TEST_DB_PORT inválido");
const pool = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`, max: 4 });

const ORG_DUP = "f1200004-0000-4000-8000-00000000000a";
const ORG_BLQ = "f1200004-0000-4000-8000-00000000000b";
const ADMIN = "f1200004-1001-4000-8000-00000000000a";
const ctxDup: TenantCtx = { organization_id: ORG_DUP, source: "session", user_id: ADMIN };
const ctxBlq: TenantCtx = { organization_id: ORG_BLQ, source: "session", user_id: ADMIN };
const deps = { pool, graceDays: 7 };
const T0 = new Date("2026-09-13T12:00:00.000Z");

async function conta(sql: string, params: unknown[]): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(sql, params);
  return Number(rows[0]?.n ?? 0);
}

beforeAll(async () => {
  await pool.query(`insert into auth.users (id, email) values ('${ADMIN}','f12-eventos@integration.test')`);
  await pool.query(`
    insert into public.organizations (id, slug, legal_name, display_name, onboarded_at) values
      ('${ORG_DUP}','f12-eventos-dup','F12 Eventos Dup','F12 Dup', now()),
      ('${ORG_BLQ}','f12-eventos-blq','F12 Eventos Blq','F12 Blq', now())`);
  await pool.query(`
    insert into public.user_organizations (organization_id, user_id, role, accepted_at) values
      ('${ORG_DUP}','${ADMIN}','admin',now()), ('${ORG_BLQ}','${ADMIN}','admin',now())`);
});

afterAll(async () => {
  await pool.end();
});

describe("F12 — eventos do gateway e bloqueio, autocontidos", () => {
  it("a segunda entrega do mesmo evento é duplicate: nada ativa de novo, um evento gravado, uma fatura paga", async () => {
    // Arrange — contratação pendente com fatura aberta.
    await iniciarCheckout(ctxDup, { plan_code: "PLAN_A" }, { ...deps, agora: () => T0 });
    const evento = { gateway: "mock" as const, event_ref: "evt-dup-1", event_type: "payment_confirmed" as const, occurred_at: new Date(T0.getTime() + 3_600_000).toISOString() };

    // Act — a mesma entrega duas vezes.
    const primeira = await aplicarEventoDoGateway(ctxDup, evento, deps);
    const segunda = await aplicarEventoDoGateway(ctxDup, evento, deps);

    // Assert
    expect(primeira.applied).toBe(true);
    // A mensagem nomeia o invariante: o mutante 63 procura "duplicate" na falha, e o
    // vitest abrevia o objeto esperado quando a assinatura tem muitos campos (F19).
    expect(segunda, "a segunda entrega do mesmo evento não foi recusada como duplicate").toMatchObject({ applied: false, ignored_reason: "duplicate" });
    expect(await conta(`select count(*)::text as n from public.billing_events where organization_id = $1`, [ORG_DUP])).toBe(1);
    expect(await conta(`select count(*)::text as n from public.invoices where organization_id = $1 and status = 'paid'`, [ORG_DUP])).toBe(1);
    expect(await conta(`select count(*)::text as n from public.notifications where organization_id = $1 and event = 'subscription.activated'`, [ORG_DUP])).toBe(1);
    console.info("f12-duplicata: applied=1/1 duplicate=1/1 events_stored=1/1 invoices_paid=1/1 activations=1/1");
  });

  it("bloqueada por atraso é read_only: escrita negada, leitura e cobrança permitidas, capability negada sem provedor", async () => {
    // Arrange — ativa, falha o pagamento, vence a carência.
    await criarAssinatura(ctxBlq, { plan_code: "PLAN_A", origin: "operator", status: "active" }, deps);
    const falhou = await aplicarEventoDoGateway(ctxBlq, { gateway: "mock", event_ref: "evt-blq-fail", event_type: "payment_failed", occurred_at: T0.toISOString() }, deps);
    expect(falhou.applied).toBe(true);
    await pool.query(`update public.subscriptions set status = 'blocked', blocked_at = now() where organization_id = $1`, [ORG_BLQ]);

    // Act
    const acesso = await estadoDeAcesso(ORG_BLQ, { pool });
    let provedorChamado = false;
    const negada = await withEntitlement(ctxBlq, "ai.reply", async () => { provedorChamado = true; return { result: "nunca" }; }, { pool }).catch((e: unknown) => e);

    // Assert
    expect(acesso).toMatchObject({ mode: "read_only", reason: "subscription_blocked" });
    expect(escritaPermitida(acesso, "POST", "/api/v1/contacts")).toBe(false);
    expect(escritaPermitida(acesso, "GET", "/api/v1/contacts")).toBe(true);
    expect(escritaPermitida(acesso, "POST", "/api/v1/billing/checkout")).toBe(true);
    expect(negada).toBeInstanceOf(EntitlementDenied);
    expect(provedorChamado).toBe(false);
    console.info("f12-bloqueio-autocontido: read_only=1/1 write_denied=1/1 read_allowed=1/1 billing_open=1/1 provider_calls=0/0");
  });
});
