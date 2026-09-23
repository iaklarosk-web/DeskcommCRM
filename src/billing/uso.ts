/**
 * O USO por Capability no período (F12-T04, ADR-030 §3 "Uso por capability").
 *
 * Nada é contado duas vezes: cada capability é uma LEITURA da tabela que já
 * registra o fato — o livro-razão de IA (`ai_usage_events`, §5.3), os membros
 * ativos, as mensagens de saída, os materiais do acervo. Um contador paralelo
 * ("usage_counters") divergiria da fonte no primeiro reprocessamento; a soma
 * feita pelo Postgres, na hora, não.
 *
 * O período é o do CICLO da assinatura quando ela tem um; senão o mês civil
 * corrente (UTC), fechado em `[desde, ate)` como `src/entitlement/uso.ts`.
 * `users.invite` e `knowledge.ingest` são ESTOQUE, não fluxo: contam o que
 * existe agora, sem período — o limite do plano é "até N membros", não
 * "N convites por mês".
 */
import { CAPABILITIES, type Capability } from "@/src/entitlement/capability";
import type { TenantCtx, TenantDb } from "@/src/tenant-context";

export interface Periodo {
  readonly desde: string;
  readonly ate: string;
}

export interface UsoDeCapability {
  readonly capability: Capability;
  readonly used: number;
  readonly limit: number | null;
  readonly remaining: number | null;
  /** `stock` = conta o que existe; `flow` = conta o que aconteceu no período. */
  readonly kind: "stock" | "flow";
}

export function mesCivil(agora = new Date()): Periodo {
  const desde = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1));
  const ate = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() + 1, 1));
  return { desde: desde.toISOString(), ate: ate.toISOString() };
}

const ESTOQUE: ReadonlySet<Capability> = new Set<Capability>(["users.invite", "knowledge.ingest"]);

function consultaDe(capability: Capability): string {
  switch (capability) {
    case "users.invite":
      return `select count(*)::int as n from public.user_organizations
               where organization_id = $1 and revoked_at is null`;
    case "knowledge.ingest":
      return `select count(*)::int as n from public.ai_knowledge_sources where organization_id = $1`;
    case "ai.reply":
      return `select count(*)::int as n from public.ai_usage_events
               where organization_id = $1 and operation = 'chat' and created_at >= $2 and created_at < $3`;
    case "ai.summary":
      return `select count(*)::int as n from public.ai_usage_events
               where organization_id = $1 and operation = 'summary' and created_at >= $2 and created_at < $3`;
    case "ai.embedding":
      return `select count(*)::int as n from public.ai_usage_events
               where organization_id = $1 and operation = 'embedding' and created_at >= $2 and created_at < $3`;
    case "channel.whatsapp.send":
      return `select count(*)::int as n from public.messages
               where organization_id = $1 and direction = 'outbound' and created_at >= $2 and created_at < $3`;
  }
}

/** O uso de UMA capability, lido da tabela-fonte. */
export async function usoDaCapabilityEm(
  db: TenantDb,
  ctx: TenantCtx,
  capability: Capability,
  periodo: Periodo,
  limit: number | null,
): Promise<UsoDeCapability> {
  const estoque = ESTOQUE.has(capability);
  const params = estoque ? [ctx.organization_id] : [ctx.organization_id, periodo.desde, periodo.ate];
  const { rows } = await db.query<{ n: number }>(consultaDe(capability), params);
  const used = Number(rows[0]?.n ?? 0);
  return {
    capability,
    used,
    limit,
    remaining: limit === null ? null : Math.max(0, limit - used),
    kind: estoque ? "stock" : "flow",
  };
}

/** O uso das SEIS capabilities — o que a tela de cobrança mostra. */
export async function usoPorCapabilityEm(
  db: TenantDb,
  ctx: TenantCtx,
  periodo: Periodo,
  limits: Readonly<Partial<Record<Capability, number>>>,
): Promise<readonly UsoDeCapability[]> {
  const linhas: UsoDeCapability[] = [];
  for (const capability of CAPABILITIES) {
    linhas.push(await usoDaCapabilityEm(db, ctx, capability, periodo, limits[capability] ?? null));
  }
  return linhas;
}
