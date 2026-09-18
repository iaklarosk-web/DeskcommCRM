"use server";
/**
 * F11-T05 (ADR-030 §1): concluir o passo "telefone" do wizard com a conexão de
 * TESTE (D12) — a organização ganha a sessão de canal e a conta que o adapter
 * de teste atende (ADR-017), exatamente o que `scripts/staging/seed-users.sh`
 * faz pelo operador. É o que permite à empresa "concluir a configuração sem
 * editar código/banco" (§7.9 F11) num ambiente sem transporte real. Fora do
 * modo de teste a action recusa: nunca substitui a conexão real.
 *
 * F18-T04 (§B19): como a conexão se chama no banco é assunto de
 * `src/channels/conexao-de-teste.ts`. Aqui ficou o que é do wizard — permissão,
 * estado do onboarding, auditoria e redirecionamento.
 */
import { redirect } from "next/navigation";

import { audit } from "@/lib/audit";
import { criarConexaoDeTeste, modoMockLigado } from "@/src/channels";
import { withTenant } from "@/src/tenant-context";

import { OnboardingError, patchOnboardingState, requireOnboardingCtx } from "./_shared";

export async function conectarCanalMock(): Promise<void> {
  if (!modoMockLigado()) {
    throw new OnboardingError("forbidden", "Conexão de teste só existe no modo de teste.");
  }
  const ctx = await requireOnboardingCtx();
  const conexao = await withTenant(
    { organization_id: ctx.orgId, user_id: ctx.userId, source: "session" },
    async (db) => criarConexaoDeTeste(db, ctx.orgId),
  );
  await patchOnboardingState(ctx.orgId, {
    whatsapp: { session_name: conexao.session_name, status: "WORKING" },
  });
  await audit({
    action: "onboarding.whatsapp_configured",
    actorUserId: ctx.userId,
    organizationId: ctx.orgId,
    resourceType: "channel_session",
    metadata: { session_name: conexao.session_name, status: "WORKING", mode: "test" },
  });
  redirect("/onboarding");
}
