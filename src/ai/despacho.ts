/**
 * F18-T01 (ADR-040 §1) — QUEM atende o despacho de IA desta organização.
 *
 * O evento `ai_agent.dispatch_requested` (`lib/channels/pos-entrada.ts`) vira
 * job `inbound_turn`, e até esta fase o job tinha um destino só: o motor
 * herdado (`runAgentTurn`), sem a política por ação, sem o teto diário e sem a
 * auditoria por ação da F15 — o §B8.
 *
 * Aqui mora a bifurcação, e ela é de UMA chave por organização:
 *
 *   `ai.engine = saas`   (padrão) → `responderTurno`, o turno que o gate mede
 *   `ai.engine = legacy`          → o motor herdado, como antes
 *
 * A volta atrás é uma chave, não um deploy: se algo aparecer em produção, a
 * organização volta para `legacy` sem esperar release. É por isso que o valor
 * fica em `tenant_settings` e não numa variável de ambiente.
 *
 * Este módulo NÃO chama nenhum dos dois motores: ele responde "qual" e lê o que
 * o turno SaaS precisa para ser chamado. Quem chama é o handler do worker, que
 * é o único que tem as dependências dos dois lados.
 */
import { getSetting } from "@/src/tenant-config";
import type { ServicePool } from "@/src/tenant-context/db";
import type { TenantCtx } from "@/src/tenant-context";

export type MotorDeIa = "saas" | "legacy";

export interface DepsDoDespacho {
  pool?: ServicePool;
}

/**
 * O motor desta organização. Qualquer valor fora do vocabulário cai no padrão
 * declarado do schema (`saas`) — o schema é a catraca, e um valor estranho no
 * banco não pode significar "escolha o outro".
 */
export async function motorDaOrganizacao(
  ctx: TenantCtx,
  deps: DepsDoDespacho = {},
): Promise<MotorDeIa> {
  const valor = await getSetting(ctx, "ai.engine", deps);
  return valor === "legacy" ? "legacy" : "saas";
}

/**
 * O texto da mensagem que motivou o turno.
 *
 * O job carrega o id da mensagem, não o texto: `responderTurno` recebe o texto
 * do cliente. Ler daqui (e não do payload) mantém uma fonte só — a mensagem
 * gravada — e faz o turno enxergar exatamente o que o inbox mostra.
 *
 * Devolve `null` quando a mensagem não é desta organização ou não é de
 * entrada: turno sem pergunta do cliente não é turno.
 */
export async function textoDaMensagemDeEntrada(
  pool: ServicePool,
  organizationId: string,
  messageId: string,
): Promise<string | null> {
  const { rows } = await pool.query<{ body: string | null }>(
    `select body
       from public.messages
      where organization_id = $1 and id = $2 and direction = 'inbound'
      limit 1`,
    [organizationId, messageId],
  );
  const corpo = rows[0]?.body;
  return typeof corpo === "string" && corpo.trim().length > 0 ? corpo : null;
}
