/**
 * O resolvedor de guardas de F03 (§5.6, ADR-016).
 *
 * A tabela `transitions.ts` guarda o NOME da guarda e nunca importa banco nem
 * configuração; quem responde é este módulo, e `transition()` o recebe por
 * injeção para que o teste unitário não precise de Postgres.
 *
 * A regra dura desta fase: guarda sem portador real LANÇA. Devolver `true` por
 * omissão faria a máquina andar sozinha para estados que ninguém sabe operar
 * ainda, e o defeito apareceria como conversa parada em produção, não como
 * vermelho aqui. `GuardNotImplemented` CONTINUA valendo: ele é a regra para
 * guarda sem portador, não um marcador temporário da F03.
 *
 * F04-T02 deu portador às três guardas de confirmação
 * (`action_requires_confirmation`, `pending_action_executed`,
 * `confirmation_timeout_elapsed`). As três respondem a partir de
 * `pending_actions` (migration 9017) — nunca de uma coluna nova em
 * `conversations`, que seria a segunda verdade sobre "o que está pendente".
 */
import { entitlement } from "@/src/entitlement/entitlement";
import type { Capability, EntitlementResposta } from "@/src/entitlement/capability";
import {
  existePendenciaAberta,
  pendenciaExecutadaNestaRodada,
  pendenciaVencida,
} from "@/src/actions/pending-store";
import { getSetting, getStoredSetting } from "@/src/tenant-config/settings";
import type { ServicePool } from "@/src/tenant-context/db";
import type { TenantCtx } from "@/src/tenant-context";

import type { ConversationState, TransitionGuard } from "./transitions";
import type { LegacyStatus } from "./state-map";

/** Trinta dias — a janela de arquivamento de D16 até a F04 torná-la Setting. */
const ARCHIVE_WINDOW_DAYS = 30;
const MS_POR_HORA = 3_600_000;
const MS_POR_DIA = 24 * MS_POR_HORA;

export class GuardNotImplemented extends Error {
  constructor(public readonly guard: TransitionGuard) {
    super(
      `guarda sem portador nesta fase: ${guard} (chega com o executor de F04/F05; ` +
        "a tabela D16 já a declara, mas ninguém sabe respondê-la ainda)",
    );
    this.name = "GuardNotImplemented";
  }
}

/** A linha de `conversations` que as guardas leem — nada além disto. */
export interface GuardConversation {
  readonly id: string;
  readonly status: LegacyStatus;
  readonly saas_state: ConversationState;
  readonly saas_state_entered_at: Date | null;
  readonly last_outbound_at: Date | null;
  readonly service_revision: string;
  readonly contact_id: string;
}

export type GuardResolver = (
  guard: TransitionGuard,
  ctx: TenantCtx,
  conversation: GuardConversation,
) => Promise<boolean>;

export interface GuardDeps {
  pool?: ServicePool;
  /** Relógio injetável: guarda de tempo comparada com hora fixa em teste. */
  agora?: () => Date;
  /**
   * Dublê de Entitlement. Existe para que o teste prove a metade de
   * `ai_available` que a Fase 1 não consegue observar: com `allowed=false` a
   * guarda tem de ser falsa mesmo com `ai.enabled` gravado como `true`.
   */
  entitlementResolver?: (ctx: TenantCtx, capability: Capability) => EntitlementResposta;
}

function comoDate(valor: Date | string | null): Date | null {
  if (valor === null) return null;
  return valor instanceof Date ? valor : new Date(valor);
}

/**
 * Resolvedor de produção da F03. Responde só o que tem portador REAL hoje.
 */
export function resolverDeGuardasF03(deps: GuardDeps = {}): GuardResolver {
  const agora = deps.agora ?? (() => new Date());

  return async (guard, ctx, conversation) => {
    switch (guard) {
      // A IA só ganha executor na F04. O default do schema (`ai.enabled: true`,
      // src/tenant-config/schema.ts) descreve aquele mundo; neste, ausência de
      // linha é "IA não configurada" e a guarda é falsa — por isso a leitura é
      // por presença e não por default.
      //
      // As duas guardas NÃO são sinônimas: §5.6 escreve a de `inbound.message`
      // como "`ai.enabled` e `entitlement(ai.reply).allowed`", e a de
      // `human.return_to_ai` (D34, ação `resume_ai`) como só `ai.enabled`. Na
      // Fase 1 o entitlement responde sim para tudo (D14), então hoje as duas
      // coincidem em VALOR — mas a pergunta certa já é feita, e no dia em que um
      // plano negar `ai.reply` a conversa vai para `waiting_human` sem ninguém
      // precisar lembrar disto.
      case "ai_available": {
        const { present, value } = await getStoredSetting(ctx, "ai.enabled", {
          pool: deps.pool,
        });
        if (!present || value !== true) return false;
        return (deps.entitlementResolver ?? entitlement)(ctx, "ai.reply").allowed;
      }

      case "ai_enabled": {
        const { present, value } = await getStoredSetting(ctx, "ai.enabled", {
          pool: deps.pool,
        });
        return present && value === true;
      }

      case "auto_resolve_elapsed": {
        const horas = await getSetting(ctx, "conversation.auto_resolve_hours", {
          pool: deps.pool,
        });
        if (typeof horas !== "number") return false;
        const desde =
          comoDate(conversation.last_outbound_at) ??
          comoDate(conversation.saas_state_entered_at);
        if (desde === null) return false;
        return agora().getTime() - desde.getTime() >= horas * MS_POR_HORA;
      }

      case "archive_window_elapsed": {
        const desde = comoDate(conversation.saas_state_entered_at);
        if (desde === null) return false;
        return agora().getTime() - desde.getTime() >= ARCHIVE_WINDOW_DAYS * MS_POR_DIA;
      }

      // ─── As três de D33/D16, com portador desde F04-T02 ─────────────────
      //
      // Nenhuma recebe o NOME da ação: a guarda é da CONVERSA, e a conversa só
      // pode ter uma pendência aberta por vez (índice único parcial
      // `pending_actions_uma_por_conversa`). É esse índice que torna
      // "existe pendência aberta" uma resposta sem ambiguidade.

      // `ai.confirmation_requested`: a Action de fato exigiu confirmação, e a
      // prova disso é a LINHA que `execute()` gravou antes de pedir o
      // movimento. Perguntar ao catálogo em vez de ao banco aprovaria o
      // movimento de uma ação que ninguém registrou como pendente — que é
      // exatamente o defeito que o mutante 40 sabota.
      case "action_requires_confirmation":
        return existePendenciaAberta(ctx, conversation.id, { pool: deps.pool });

      // `confirmation.approved`: "Action pendente executa ANTES" (§5.6).
      case "pending_action_executed":
        return pendenciaExecutadaNestaRodada(
          ctx,
          conversation.id,
          comoDate(conversation.saas_state_entered_at),
          { pool: deps.pool },
        );

      // `confirmation.timeout`: o prazo é o `expires_at` da pendência, que
      // nasceu do Setting `conversation.confirmation_timeout_minutes`.
      case "confirmation_timeout_elapsed":
        return pendenciaVencida(ctx, conversation.id, agora(), { pool: deps.pool });

      default: {
        // Guarda nova na tabela sem linha aqui vira erro de compilação, não
        // um `true` silencioso em runtime.
        const naoTratada: never = guard;
        throw new GuardNotImplemented(naoTratada);
      }
    }
  };
}
