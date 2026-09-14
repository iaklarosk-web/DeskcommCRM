"use server";
/**
 * F11-T05 (ADR-030 §1): concluir o passo "telefone" do wizard em
 * `WHATSAPP_MODE=mock` (D12) — a organização ganha a sessão de canal e a conta
 * `mock` que o adapter mock atende (ADR-017), exatamente o que
 * `scripts/staging/seed-users.sh` faz pelo operador. É o que permite à empresa
 * "concluir a configuração sem editar código/banco" (§7.9 F11) num ambiente
 * sem WAHA. Fora do modo mock a action recusa: nunca substitui a conexão real.
 */
import { redirect } from "next/navigation";

import { audit } from "@/lib/audit";
import { modoMockLigado } from "@/src/channels";
import { withTenant } from "@/src/tenant-context";

import { OnboardingError, patchOnboardingState, requireOnboardingCtx } from "./_shared";

export async function conectarCanalMock(): Promise<void> {
  if (!modoMockLigado()) throw new OnboardingError("forbidden", "Conexão de teste só existe com WHATSAPP_MODE=mock.");
  const ctx = await requireOnboardingCtx();
  const sessionName = `mock-${ctx.orgId.slice(0, 8)}`;
  const accountKey = `mock-${ctx.orgId}`;
  await withTenant({ organization_id: ctx.orgId, user_id: ctx.userId, source: "session" }, async (db) => {
    const sessao = await db.query<{ id: string }>(
      `insert into public.channel_sessions (organization_id, waha_session_name, webhook_secret_encrypted)
       values ($1, $2, '\\x00'::bytea)
       on conflict do nothing
       returning id`,
      [ctx.orgId, sessionName],
    );
    const sessionId =
      sessao.rows[0]?.id ??
      (await db.query<{ id: string }>(`select id from public.channel_sessions where organization_id = $1 and waha_session_name = $2`, [ctx.orgId, sessionName])).rows[0]?.id;
    if (!sessionId) throw new OnboardingError("db_error", "Sessão de canal mock não criada.");
    await db.query(
      `insert into public.channel_accounts (organization_id, provider, account_key, channel_session_id)
       values ($1, 'mock', $2, $3)
       on conflict (provider, account_key) do update set channel_session_id = excluded.channel_session_id`,
      [ctx.orgId, accountKey, sessionId],
    );
  });
  await patchOnboardingState(ctx.orgId, { whatsapp: { session_name: sessionName, status: "WORKING" } });
  await audit({
    action: "onboarding.whatsapp_configured",
    actorUserId: ctx.userId,
    organizationId: ctx.orgId,
    resourceType: "channel_session",
    metadata: { session_name: sessionName, status: "WORKING", mode: "mock" },
  });
  redirect("/onboarding");
}
