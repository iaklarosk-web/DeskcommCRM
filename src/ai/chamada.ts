/**
 * A chamada de modelo do turno SaaS — guarda por Entitlement, registro por
 * `runModelCall` (§5.3, D14/D36; F04-T08; ADR-021 decisão 3).
 *
 * ═══ O erro que este arquivo existe para NÃO cometer ═══════════════════════
 *
 * `withEntitlement` recebe um `fn` e grava, DEPOIS dele, um `ai_usage_events`
 * para cada `usage` que o `fn` devolver. O reflexo natural seria devolver o
 * usage da chamada — e aí a MESMA chamada teria duas linhas no livro-razão: a
 * que `runModelCall` grava na transação do `llm_calls` e a que `withEntitlement`
 * gravaria por fora, cotada por outra tabela de preço. O orçamento
 * (`ai_budgets`, gatilho sobre `llm_calls`) continuaria vendo só a primeira.
 *
 * Por isso a divisão é explícita e tem nome:
 *
 *   - `withEntitlement` é a GUARDA. Ele decide se a chamada pode acontecer. Com
 *     `allowed=false` ele lança ANTES do `fn`, e `runModelCall` não é alcançado
 *     — nenhum byte sai para o provedor (D36).
 *   - `runModelCall` é o REGISTRO. É o único lugar que fala com o provedor e o
 *     único que escreve consumo, nas duas tabelas, no mesmo statement.
 *
 * O `fn` daqui devolve `{ result }` e NUNCA `usage`. Isso não é omissão: é a
 * decisão, e ela tem mutante próprio (`tests/mutants/43-f04-consumo-em-dobro.sh`)
 * porque devolver o usage não quebraria nada visível — só dobraria a conta.
 */
import type pg from "pg";

import {
  runModelCall,
  type LlmEdgeConfig,
  type ModelMessage,
  type ToolSet,
} from "@/lib/agent-engine/edge/llm/run-model-call";
import type { ProviderRegistry } from "@/lib/agent-engine/edge/llm/providers";
import type { Logger } from "@/lib/agent-engine/obs/logger";
import { withEntitlement, type Capability, type EntitlementResposta } from "@/src/entitlement";
import type { TenantCtx } from "@/src/tenant-context";

export interface EntradaDaChamada {
  messages: ModelMessage[];
  system?: string;
  tools?: ToolSet;
  /** Sem ele, o modelo padrão da organização (`organizations.settings.llm`). */
  model?: string;
  maxSteps?: number;
  /** Atribuição de custo do motor: 'agent_turn' (padrão) | 'classifier' | … */
  purpose?: string;
  /** A conversa que motivou a chamada — vai para `ai_usage_events`. */
  conversationId?: string | null;
  agentId?: string | null;
}

export interface DepsDaChamada {
  pool: pg.Pool;
  cfg: LlmEdgeConfig;
  registry?: ProviderRegistry;
  log?: Logger;
  /** Seam da Fase 2 (D14). A prova de D36 injeta o dublê que nega. */
  resolver?: (ctx: TenantCtx, capability: Capability) => EntitlementResposta;
}

export type SaidaDaChamada = Awaited<ReturnType<typeof runModelCall>>;

/**
 * Uma chamada ao provedor, pela única porta que a Fase 1 reconhece.
 *
 * `capability` é parâmetro e não constante porque §5.3 distingue `ai.reply` de
 * `ai.summary`: o resumo do handoff (§5.11) é cobrado como resumo, e uma
 * constante aqui faria os dois virarem a mesma pergunta ao entitlement.
 */
export async function chamarModelo(
  ctx: TenantCtx,
  capability: Capability,
  entrada: EntradaDaChamada,
  deps: DepsDaChamada,
): Promise<SaidaDaChamada> {
  return withEntitlement(
    ctx,
    capability,
    async () => {
      const saida = await runModelCall(
        deps.pool,
        deps.cfg,
        {
          tenantId: ctx.organization_id,
          messages: entrada.messages,
          ...(entrada.system === undefined ? {} : { system: entrada.system }),
          ...(entrada.tools === undefined ? {} : { tools: entrada.tools }),
          ...(entrada.model === undefined ? {} : { model: entrada.model }),
          ...(entrada.maxSteps === undefined ? {} : { maxSteps: entrada.maxSteps }),
          ...(entrada.purpose === undefined ? {} : { purpose: entrada.purpose }),
          conversationId: entrada.conversationId ?? null,
          agentId: entrada.agentId ?? null,
        },
        {
          ...(deps.registry === undefined ? {} : { registry: deps.registry }),
          ...(deps.log === undefined ? {} : { log: deps.log }),
        },
      );
      // ⚠️ SEM `usage`. Quem grava o consumo é runModelCall, na mesma transação
      // do llm_calls. Devolver o usage aqui contaria a chamada duas vezes.
      return { result: saida };
    },
    {
      pool: deps.pool,
      ...(deps.resolver === undefined ? {} : { resolver: deps.resolver }),
    },
  );
}
