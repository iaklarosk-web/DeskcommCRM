import { randomUUID } from "node:crypto";

import { f02E2eSandbox } from "./f02-crm-cadastros";

/**
 * A FIXTURE DAS DUAS ORGANIZAÇÕES FICTÍCIAS DA TELA DE IA (F04-T10).
 *
 * Mesmo contrato das fixtures de F02 e F03, e pela mesma razão: o "5/5 por
 * tenant" de §7.5 só prova alguma coisa se as cinco jornadas rodarem em DUAS
 * organizações que não se conhecem. Cria só o que precisa, apaga só o que criou
 * e CONFERE que não sobrou linha — resíduo é falha, não detalhe.
 *
 * O guarda de ambiente é o de F02 (`f02E2eSandbox`): loopback obrigatório e
 * marcador do sandbox descartável, checados ANTES de qualquer escrita.
 *
 * ## Por que `admin` e não `manager`
 *
 * A tela é do `tenant_admin` (D15, ADR-003): a página redireciona para `/403`
 * abaixo de `ROLE_RANK.admin`, e as rotas `/api/v1/settings/ai*` exigem `admin`.
 * Uma fixture `manager` mediria o 403, não a tela.
 *
 * ## Nada real é tocado
 *
 * Nenhuma conversa, nenhum canal, nenhum provedor: esta jornada só escreve
 * `tenant_settings` e o acervo da própria organização. `WHATSAPP_MODE=mock` e
 * `AI_PROVIDER=mock` continuam valendo por fora (D12).
 */

export type LadoDoTeste = "A" | "B";

export interface F04AiSettingsFixture {
  suffix: string;
  password: string;
  admin: { id: string; email: string; nome: string };
  orgs: Record<LadoDoTeste, string>;
}

/**
 * As tabelas tenant-aware que esta jornada escreve, conferidas na limpeza.
 * Todas referenciam `organizations(id) on delete cascade` — a contagem depois do
 * DELETE é o que transforma "deve ter limpado" em evidência.
 */
const TABELAS_DO_DOMINIO = [
  "tenant_settings",
  "ai_knowledge_sources",
  "ai_knowledge_versions",
  "ai_chunks",
  "user_organizations",
] as const;

export async function seedF04AiSettings(): Promise<F04AiSettingsFixture> {
  const db = f02E2eSandbox();
  const suffix = randomUUID().slice(0, 8);
  const password = `F04-local-${randomUUID()}!`;
  const fixture: F04AiSettingsFixture = {
    suffix,
    password,
    admin: {
      id: "",
      email: `f04-admin-${suffix}@example.test`,
      nome: `Admin ${suffix}`,
    },
    orgs: { A: "", B: "" },
  };

  try {
    const usuario = await db.auth.admin.createUser({
      email: fixture.admin.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fixture.admin.nome },
    });
    if (usuario.error || !usuario.data.user) {
      throw usuario.error ?? new Error("usuário da fixture não criado");
    }
    fixture.admin.id = usuario.data.user.id;

    for (const lado of ["A", "B"] as const) {
      const org = await db
        .from("organizations")
        .insert({
          slug: `f04-${lado.toLowerCase()}-${suffix}`,
          display_name: `F04 ${lado} ${suffix}`,
          legal_name: `F04 ${lado} ${suffix} Ltda.`,
          status: "active",
          onboarded_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (org.error || !org.data) throw org.error ?? new Error("organização não criada");
      fixture.orgs[lado] = (org.data as { id: string }).id;

      const membro = await db.from("user_organizations").insert({
        organization_id: fixture.orgs[lado],
        user_id: fixture.admin.id,
        role: "admin",
        accepted_at: new Date().toISOString(),
      });
      if (membro.error) throw membro.error;
    }
    return fixture;
  } catch (erro) {
    await cleanupF04AiSettings(fixture);
    throw erro;
  }
}

export interface LimpezaF04 {
  deleted_organizations: number;
  deleted_users: number;
  domain_tables_checked: number;
  domain_rows_remaining: number;
}

/** Apaga SÓ os ids desta execução e prova que nada sobrou. */
export async function cleanupF04AiSettings(
  fixture: F04AiSettingsFixture,
): Promise<LimpezaF04> {
  const db = f02E2eSandbox();
  const falhas: string[] = [];
  const organizacoes = [fixture.orgs.A, fixture.orgs.B].filter(Boolean);
  let apagadas = 0;
  let usuarios = 0;

  for (const id of organizacoes) {
    const resultado = await db.from("organizations").delete().eq("id", id).select("id");
    if (resultado.error) falhas.push(`organização da fixture: ${resultado.error.message}`);
    else apagadas += resultado.data.length;
  }
  if (fixture.admin.id) {
    const resultado = await db.auth.admin.deleteUser(fixture.admin.id);
    if (resultado.error) falhas.push(`usuário da fixture: ${resultado.error.message}`);
    else usuarios++;
  }

  let restantes = 0;
  if (organizacoes.length > 0) {
    for (const tabela of TABELAS_DO_DOMINIO) {
      const contagem = await db
        .from(tabela)
        .select("*", { count: "exact", head: true })
        .in("organization_id", organizacoes);
      if (contagem.error) falhas.push(`${tabela}: ${contagem.error.message}`);
      else restantes += contagem.count ?? 0;
    }
  }

  if (falhas.length > 0) throw new Error(`Limpeza F04 incompleta: ${falhas.join("; ")}`);
  return {
    deleted_organizations: apagadas,
    deleted_users: usuarios,
    domain_tables_checked: TABELAS_DO_DOMINIO.length,
    domain_rows_remaining: restantes,
  };
}
