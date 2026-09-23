/**
 * F18-T00 (ADR-040 §3) — o que o turno SaaS herda do agente publicado.
 *
 * O motor herdado guarda, na VERSÃO publicada do agente, três coisas que o
 * turno novo precisa para não trocar a voz do atendimento ao assumir o
 * despacho: o `system_prompt` daquela versão, as fontes de conhecimento que ela
 * declara (`knowledge_source_ids`) e as ferramentas que ela declara
 * (`tool_ids`).
 *
 * As duas primeiras são HERANÇA: o contexto do turno passa a usar o prompt da
 * versão em vez do `ai.system_prompt` da organização, e a busca no acervo fica
 * restrita às fontes daquela versão. A terceira é a CATRACA da objeção 1: uma
 * ferramenta declarada aqui e ausente do catálogo não pode ser descartada em
 * silêncio — quem decide o que fazer com ela é `src/ai/turno.ts`.
 *
 * Organização sem agente publicado devolve `null`, e o turno segue como sempre
 * seguiu (persona da organização, acervo inteiro). É o caso de toda
 * organização nova — e era o caso da produção inteira em 18/09/2026.
 */
import { withTenant, type TenantCtx } from "@/src/tenant-context";
import type { ServicePool } from "@/src/tenant-context/db";

export interface DepsDaHeranca {
  pool?: ServicePool;
}

export interface HerancaDoAgente {
  readonly version_id: string;
  /** O prompt da versão publicada; `null` quando a versão não define um. */
  readonly system_prompt: string | null;
  /** Fontes do acervo declaradas pela versão. Vazio = acervo inteiro. */
  readonly fontes: readonly string[];
  /** Ferramentas que a versão declara — inclusive as que o catálogo não tem. */
  readonly tools_declaradas: readonly string[];
}

interface Linha {
  readonly version_id: string;
  readonly system_prompt: string | null;
  readonly knowledge_source_ids: string[] | null;
  readonly tool_ids: string[] | null;
}

/**
 * A versão publicada do agente desta organização, ou `null`.
 *
 * Um agente arquivado ou pausado não atende (é a mesma regra de
 * `lib/ai/agents/no-ar.ts`), e sem `published_version_id` não há versão no ar.
 * Se houver mais de um agente publicado, vence o mais antigo — determinístico
 * de propósito: herança que muda de dono a cada turno seria pior que nenhuma.
 */
export async function herancaDoAgentePublicado(
  ctx: TenantCtx,
  deps: DepsDaHeranca = {},
): Promise<HerancaDoAgente | null> {
  return withTenant(
    ctx,
    async (db) => {
      const { rows } = await db.query<Linha>(
        `select v.id as version_id,
                v.system_prompt,
                v.knowledge_source_ids,
                v.tool_ids
           from public.ai_agents a
           join public.ai_agent_versions v on v.id = a.published_version_id
          where a.organization_id = $1
            and a.archived_at is null
            and a.paused_at is null
          order by a.created_at asc
          limit 1`,
        [ctx.organization_id],
      );
      const linha = rows[0];
      if (linha === undefined) return null;
      const prompt = typeof linha.system_prompt === "string" ? linha.system_prompt.trim() : "";
      return {
        version_id: linha.version_id,
        system_prompt: prompt.length > 0 ? prompt : null,
        fontes: Object.freeze([...(linha.knowledge_source_ids ?? [])]),
        tools_declaradas: Object.freeze([...(linha.tool_ids ?? [])]),
      };
    },
    deps,
  );
}

/**
 * As ferramentas que a versão declara e o catálogo NÃO cobre.
 *
 * `cobertas` são os nomes das ações do catálogo mais o mapa de equivalência
 * (o herdado chama `crm_search_products`; o catálogo, `search_products`).
 * O que sobra aqui é a fila de espera do inventário — e é o que vira
 * `tool_missing` quando o modelo pedir.
 */
export function declaradasForaDoCatalogo(
  heranca: HerancaDoAgente | null,
  cobertas: ReadonlySet<string>,
): readonly string[] {
  if (heranca === null) return [];
  return heranca.tools_declaradas.filter((nome) => !cobertas.has(nome));
}
