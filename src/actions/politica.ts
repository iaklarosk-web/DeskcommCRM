/**
 * Política por AÇÃO e por organização (F15-T01, ADR-036 §1/§4, D54 b).
 *
 * Quatro modos para executores NÃO humanos (`ai`, `automation`):
 *  - `allow`    executa (sem pendência, mesmo que `by_risk` pedisse);
 *  - `approve`  fica pendente para o `attendant` (o caminho de D33);
 *  - `block`    nega e audita (`policy_blocked`);
 *  - `transfer` nega, audita e transfere a conversa a um humano
 *               (`policy_transferred`) — só faz sentido com `conversation_id`.
 *
 * ─── Onde mora o default ────────────────────────────────────────────────────
 *
 * A chave `actions.policy` nasce `{}`: nenhuma ação nasce SOBRESCRITA. O modo
 * EFETIVO de uma ação sem entrada é o que D33 já decide hoje — `executors` do
 * catálogo (só humana → `block`), `confirmation` (`none` → `allow`, `always`
 * → `approve`) e `by_risk` contra `actions.confirm_from_risk`. Assim a
 * organização que nunca tocou na tela continua exatamente como antes, e
 * `actions.confirm_from_risk` (que o `tenant_admin` pode relaxar, D33)
 * continua valendo para tudo o que não foi sobrescrito. A tela mostra o modo
 * efetivo e a origem (`padrão` | `organização`).
 *
 * `blocked` na taxonomia de risco e `executors` do catálogo prevalecem sobre
 * qualquer entrada: a configuração "não supera isolamento, autorização nem
 * limites comerciais" (D40). `allow` numa ação que o catálogo não dá ao
 * executor continua negada em `execute()` ANTES de a política ser lida.
 */
import { ACTION_CATALOG, ACTION_RISKS, findAction, nivelDeRisco, type ActionCatalogEntry, type ActionExecutor, type ActionRisk } from "./catalog";

export const MODOS_DA_POLITICA = ["allow", "approve", "block", "transfer"] as const;
export type ModoDaPolitica = (typeof MODOS_DA_POLITICA)[number];

export type Politica = Readonly<Record<string, ModoDaPolitica>>;

/** Default declarado da chave: vazio — o efetivo vem de D33 (ver cabeçalho). */
export const POLITICA_PADRAO: Politica = Object.freeze({});

/**
 * Lido na CHAMADA, nunca na carga do módulo: `tenant-config/schema` →
 * `validators` → este arquivo → `catalog` → `conversation` → `settings` →
 * `schema` é um ciclo de import, e uma constante calculada aqui no topo veria
 * `ACTION_CATALOG` ainda `undefined` quando a entrada é o catálogo.
 */
function nomesDoCatalogo(): ReadonlySet<string> {
  return new Set(ACTION_CATALOG.map((e) => e.name));
}

/**
 * Validador do tipo `action_policy` de `tenant_settings`: objeto cujas chaves
 * são nomes do catálogo e cujos valores são um dos quatro modos. Devolve
 * `null` quando serve, ou uma frase de gente (padrão de `validators.ts`).
 */
export function validarPolitica(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "esperava objeto {<ação do catálogo>: allow|approve|block|transfer}";
  }
  const nomes = nomesDoCatalogo();
  for (const [nome, modo] of Object.entries(value as Record<string, unknown>)) {
    if (!nomes.has(nome)) return `ação fora do catálogo: ${nome}`;
    if (typeof modo !== "string" || !(MODOS_DA_POLITICA as readonly string[]).includes(modo)) {
      return `${nome}: esperava um de: ${MODOS_DA_POLITICA.join(", ")}`;
    }
  }
  return null;
}

export function politicaValida(value: unknown): value is Politica {
  return validarPolitica(value) === null;
}

/**
 * O modo que D33 daria a uma ação sem entrada na política, para um executor.
 * `confirmFromRisk` é o valor de `actions.confirm_from_risk` (ou inválido →
 * `approve`, a escolha conservadora que `execute()` já fazia).
 */
export function modoDeD33(entrada: ActionCatalogEntry, executor: ActionExecutor, confirmFromRisk: unknown): ModoDaPolitica {
  if (!entrada.executors.includes(executor) || entrada.risk === "blocked") return "block";
  if (entrada.confirmation === "none") return "allow";
  if (entrada.confirmation === "always") return "approve";
  if (typeof confirmFromRisk !== "string" || !ACTION_RISKS.includes(confirmFromRisk as ActionRisk)) return "approve";
  return nivelDeRisco(entrada.risk) >= nivelDeRisco(confirmFromRisk as ActionRisk) ? "approve" : "allow";
}

export interface ModoEfetivo {
  readonly action: string;
  readonly mode: ModoDaPolitica;
  readonly source: "padrão" | "organização";
  readonly risk: ActionRisk;
  /** A organização pode mudar? Ações que o catálogo não dá ao executor, não. */
  readonly configurable: boolean;
}

/**
 * O modo efetivo de UMA ação para um executor: a entrada da organização, se
 * existe e a ação é configurável; senão D33. Entrada em ação não configurável
 * (só humana, ou `blocked`) é ignorada de propósito — a política não abre o
 * que o catálogo fecha.
 */
export function modoEfetivo(
  nome: string,
  executor: ActionExecutor,
  politica: Politica,
  confirmFromRisk: unknown,
): ModoEfetivo | null {
  const entrada = findAction(nome);
  if (entrada === null) return null;
  const configurable = entrada.executors.includes(executor) && entrada.risk !== "blocked";
  const daOrganizacao = configurable ? politica[nome] : undefined;
  return {
    action: nome,
    mode: daOrganizacao ?? modoDeD33(entrada, executor, confirmFromRisk),
    source: daOrganizacao === undefined ? "padrão" : "organização",
    risk: entrada.risk,
    configurable,
  };
}

/** A tabela inteira, na ordem do catálogo — o que a tela e a rota devolvem. */
export function tabelaDaPolitica(executor: ActionExecutor, politica: Politica, confirmFromRisk: unknown): ModoEfetivo[] {
  return ACTION_CATALOG.map((entrada) => modoEfetivo(entrada.name, executor, politica, confirmFromRisk)!);
}
