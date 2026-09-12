import { randomUUID } from "node:crypto";

import { f02E2eSandbox } from "./f02-crm-cadastros";

/**
 * A FIXTURE DAS DUAS ORGANIZAÇÕES FICTÍCIAS DA TELA DE USO DE IA (F05-T09).
 *
 * Mesmo contrato das fixtures de F02/F03/F04, e pela mesma razão: "valor
 * exibido = sum(ai_usage_events)" só prova alguma coisa se as duas organizações
 * tiverem somas DIFERENTES e cada tela mostrar só a sua. Cria só o que precisa,
 * apaga só o que criou e CONFERE que não sobrou linha.
 *
 * ## O que é semeado
 *
 * Linhas em `ai_usage_events` — o livro-razão de §5.3 — escritas pelo cliente
 * service-role do sandbox (a tabela é `service_only`, D35). Duas por lado no
 * mês corrente, uma por lado no mês passado, com números escolhidos para que
 * A ≠ B em tokens E em custo: um filtro de tenant furado apareceria como soma
 * errada, nunca como soma igual por coincidência. `llm_call_id` fica nulo — é o
 * caso que o índice único parcial da 9018 admite (linha sem chamada de motor).
 *
 * ## Por que `admin`
 *
 * A tela é do `tenant_admin` (D15): a página redireciona para `/403` abaixo de
 * `ROLE_RANK.admin`, e `/api/v1/settings/ai/uso` exige `admin`.
 *
 * ## Nada real é tocado
 *
 * Nenhuma chamada a provedor: as linhas são semeadas, não geradas. `AI_PROVIDER=mock`
 * continua valendo por fora (D12).
 */

export type LadoDoTeste = "A" | "B";

export interface LinhaSemeada {
  readonly model: string;
  readonly operation: "chat" | "embedding" | "summary";
  readonly prompt_tokens: number;
  readonly completion_tokens: number;
  readonly estimated_cost_cents: number;
  /** `"este_mes"` = agora; `"mes_passado"` = dia 5 do mês anterior (UTC). */
  readonly quando: "este_mes" | "mes_passado";
}

export interface F05AiUsageFixture {
  suffix: string;
  password: string;
  admin: { id: string; email: string; nome: string };
  orgs: Record<LadoDoTeste, string>;
  linhas: Record<LadoDoTeste, readonly LinhaSemeada[]>;
}

/** Os números por lado — DIFERENTES entre A e B, em tokens e em custo. */
export const LINHAS_POR_LADO: Record<LadoDoTeste, readonly LinhaSemeada[]> = {
  A: [
    { model: "modelo-ficticio-a", operation: "chat", prompt_tokens: 100, completion_tokens: 50, estimated_cost_cents: 1.25, quando: "este_mes" },
    { model: "modelo-ficticio-a", operation: "chat", prompt_tokens: 200, completion_tokens: 70, estimated_cost_cents: 0.75, quando: "este_mes" },
    { model: "modelo-ficticio-a", operation: "chat", prompt_tokens: 1000, completion_tokens: 500, estimated_cost_cents: 9.5, quando: "mes_passado" },
  ],
  B: [
    { model: "modelo-ficticio-b", operation: "chat", prompt_tokens: 300, completion_tokens: 10, estimated_cost_cents: 3.5, quando: "este_mes" },
    { model: "modelo-ficticio-b", operation: "embedding", prompt_tokens: 40, completion_tokens: 0, estimated_cost_cents: 0.004, quando: "este_mes" },
    { model: "modelo-ficticio-b", operation: "chat", prompt_tokens: 2000, completion_tokens: 900, estimated_cost_cents: 20, quando: "mes_passado" },
  ],
};

/** A soma ESPERADA de um subconjunto — calculada da fixture, não da tela. */
export function somaDe(linhas: readonly LinhaSemeada[]) {
  return {
    calls: linhas.length,
    prompt_tokens: linhas.reduce((s, l) => s + l.prompt_tokens, 0),
    completion_tokens: linhas.reduce((s, l) => s + l.completion_tokens, 0),
    total_tokens: linhas.reduce((s, l) => s + l.prompt_tokens + l.completion_tokens, 0),
    estimated_cost_cents: Number(linhas.reduce((s, l) => s + l.estimated_cost_cents, 0).toFixed(4)),
  };
}

export function instanteDe(quando: LinhaSemeada["quando"], agora = new Date()): string {
  if (quando === "este_mes") return agora.toISOString();
  return new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() - 1, 5, 12, 0, 0)).toISOString();
}

/** Tabelas tenant-aware que esta jornada escreve, conferidas na limpeza. */
const TABELAS_DO_DOMINIO = ["ai_usage_events", "user_organizations"] as const;

export async function seedF05AiUsage(): Promise<F05AiUsageFixture> {
  const db = f02E2eSandbox();
  const suffix = randomUUID().slice(0, 8);
  const password = `F05-local-${randomUUID()}!`;
  const fixture: F05AiUsageFixture = {
    suffix,
    password,
    admin: { id: "", email: `f05-uso-admin-${suffix}@example.test`, nome: `Admin ${suffix}` },
    orgs: { A: "", B: "" },
    linhas: LINHAS_POR_LADO,
  };

  try {
    const usuario = await db.auth.admin.createUser({
      email: fixture.admin.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fixture.admin.nome },
    });
    if (usuario.error || !usuario.data.user) throw usuario.error ?? new Error("usuário da fixture não criado");
    fixture.admin.id = usuario.data.user.id;

    for (const lado of ["A", "B"] as const) {
      const org = await db
        .from("organizations")
        .insert({
          slug: `f05-uso-${lado.toLowerCase()}-${suffix}`,
          display_name: `F05 Uso ${lado} ${suffix}`,
          legal_name: `F05 Uso ${lado} ${suffix} Ltda.`,
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

      const uso = await db.from("ai_usage_events").insert(
        LINHAS_POR_LADO[lado].map((l) => ({
          organization_id: fixture.orgs[lado],
          model: l.model,
          operation: l.operation,
          prompt_tokens: l.prompt_tokens,
          completion_tokens: l.completion_tokens,
          estimated_cost_cents: l.estimated_cost_cents,
          created_at: instanteDe(l.quando),
        })),
      );
      if (uso.error) throw uso.error;
    }
    return fixture;
  } catch (erro) {
    await cleanupF05AiUsage(fixture);
    throw erro;
  }
}

export interface LimpezaF05 {
  deleted_organizations: number;
  deleted_users: number;
  domain_tables_checked: number;
  domain_rows_remaining: number;
}

export async function cleanupF05AiUsage(fixture: F05AiUsageFixture): Promise<LimpezaF05> {
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

  if (falhas.length > 0) throw new Error(`Limpeza F05 incompleta: ${falhas.join("; ")}`);
  return {
    deleted_organizations: apagadas,
    deleted_users: usuarios,
    domain_tables_checked: TABELAS_DO_DOMINIO.length,
    domain_rows_remaining: restantes,
  };
}
