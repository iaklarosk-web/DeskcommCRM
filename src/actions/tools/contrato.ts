/**
 * O contrato entre `execute()` e as dez funções de domínio (§5.8).
 *
 * ─── Por que `src/actions/tools/` é um diretório à parte ───────────────────
 *
 * D18: "Sem SQL livre, sem HTTP arbitrário". A prova é uma varredura de `grep`
 * sobre ESTE diretório, procurando chamada de rede, RPC e literal de SQL; o
 * resultado esperado é ZERO, com denominador de arquivos varridos
 * (`tests/unit/f04-t01-action-catalog.test.ts`, e de novo em F04-T06).
 *
 * ⚠️ Os três padrões da varredura NÃO são escritos por extenso em nenhum
 * arquivo daqui — nem em comentário. Um comentário que os cite vira hit, o
 * denominador fica errado, e a saída natural seria afrouxar a varredura para
 * "ignorar comentários": exatamente o afrouxamento que faria um `fetch` de
 * verdade escondido num bloco de comentário passar. O texto dos padrões vive no
 * teste, que é quem afirma.
 *
 * A regra que a varredura protege: aqui dentro monta-se argumento e lê-se
 * resultado; a consulta parametrizada e o `withTenant` ficam no domínio
 * (`src/crm/`, `src/conversation/`, `src/actions/outbound.ts`).
 *
 * ─── Recusa é RESULTADO, não exceção ───────────────────────────────────────
 *
 * §5.8, invariante 4. Um handler devolve `{ok:false, reason}` e `execute()` o
 * transforma em `{status:"denied"}` contável e auditado. Exceção fica para o
 * que é defeito — banco fora do ar, invariante violado.
 */
import type { z } from "zod";

import type { SaasChannelAdapter, SaasChannelProvider } from "@/src/channels/contract";
import type { ServicePool } from "@/src/tenant-context/db";
import type { TenantCtx } from "@/src/tenant-context";

import type { ActionExecutor } from "../catalog";

export interface ActionActor {
  readonly kind: ActionExecutor;
  /** Atendente que executa; obrigatório para o executor `human` auditar quem. */
  readonly user_id?: string;
}

export interface ExecuteDeps {
  pool?: ServicePool;
  /** Correlaciona a auditoria com a request (ADR-015). */
  requestId?: string;
  /** Seams de `getSaasAdapter` — a prova injeta o adapter em vez do ambiente. */
  adapters?: Partial<Record<SaasChannelProvider, SaasChannelAdapter>>;
  modo?: string;
  /** Relógio injetável: o prazo da pendência é comparado com hora fixa em teste. */
  agora?: () => Date;
}

/**
 * Motivo da recusa — etiqueta de contador e coluna de auditoria, nunca frase
 * livre (D19/G-78). Texto novo a cada caminho transformaria a métrica em prosa.
 */
export type ActionDenyReason =
  | "unknown_action"
  | "invalid_input"
  | "executor_not_allowed"
  | "conversation_not_found"
  | "conversation_closed"
  | "contact_without_phone"
  | "channel_account_missing"
  | "illegal_transition"
  /** A Action é `blocked` na taxonomia de §5.8: nega para TODO executor. */
  | "risk_blocked"
  /** A pendência não existe, já foi resolvida, ou outro atendente ganhou. */
  | "pending_conflict"
  /** O `attendant` recusou a ação pendente. Desfecho normal, não defeito. */
  | "confirmation_rejected"
  | "actor_without_user"
  /** O DOMÍNIO recusou (revisão, autorização, item inválido). O código exato
   *  dele viaja no `payload` da auditoria, não no motivo — o motivo é etiqueta. */
  | "domain_rejected";

export type ToolOutcome =
  | {
      readonly ok: true;
      readonly output: Record<string, unknown>;
      readonly resourceId: string | null;
    }
  | {
      readonly ok: false;
      readonly reason: ActionDenyReason;
      readonly resourceId: string | null;
      /** Código do domínio, para o `payload` da auditoria. Nunca texto livre. */
      readonly detalhe?: string;
    };

/** O que todo handler recebe além da entrada já validada. */
export interface ToolCtx {
  readonly ctx: TenantCtx;
  readonly actor: ActionActor;
  readonly deps: ExecuteDeps;
  readonly requestId: string;
}

/**
 * Um handler já casado com o schema que valida a sua entrada.
 *
 * O `as` dentro de `bind` é o único do diretório e é seguro por construção:
 * `execute()` valida com `entrada.input_schema`, e
 * `tests/unit/f04-t01-action-catalog.test.ts` confere, entrada por entrada, que
 * o schema do catálogo é O MESMO objeto do binding. Reparsear aqui pagaria a
 * validação duas vezes para provar o que aquele teste já prova.
 */
export interface ToolRunner {
  readonly schema: z.ZodType;
  run(tool: ToolCtx, input: unknown): Promise<ToolOutcome>;
}

export function bind<S extends z.ZodType>(
  schema: S,
  fn: (tool: ToolCtx, input: z.output<S>) => Promise<ToolOutcome>,
): ToolRunner {
  return { schema, run: (tool, input) => fn(tool, input as z.output<S>) };
}

/** Quem age precisa de identidade quando o domínio exige um usuário de verdade. */
export function exigirUsuario(actor: ActionActor): string | null {
  return actor.kind === "human" && typeof actor.user_id === "string" ? actor.user_id : null;
}
