/**
 * F06-T01 — a linha de log por requisição e por job (§5.17, §7.7).
 *
 * Uma linha JSON por chamada, SEMPRE com `request_id` e `organization_id`
 * (nulo quando a rota é global: cron, health, administração da plataforma —
 * e aí o campo `scope` diz por quê). Sai pelo `lib/logger.ts` herdado, que
 * já é JSON de uma linha e já proíbe segredo, corpo de mensagem, CPF e
 * telefone; este módulo só fixa o VOCABULÁRIO das linhas — que campos existem
 * e como se chamam — para que quem agrega logs indexe pelos mesmos nomes em
 * toda rota e todo worker.
 *
 * Por que o log fica no GUARDA e não em cada rota: `requireRole` é o único
 * ponto por onde toda rota autenticada passa e onde `organization_id` acaba
 * de ser resolvido. Duzentas e tantas rotas herdadas repetindo a mesma linha
 * seriam duzentas chances de omiti-la; o guarda a emite uma vez, e a régua
 * `tests/unit/f06-t01-logs-por-rota.test.ts` cobra que toda rota passe por um
 * emissor conhecido ou emita a linha ela mesma.
 */
import { logger } from "@/lib/logger";

/** Desfechos da linha `api.request`. Enum, nunca frase (D19 vale para log também). */
export type DesfechoDaRequisicao =
  | "allowed"
  | "resolved"
  | "unauthenticated"
  | "forbidden_tenant"
  | "forbidden_role"
  | "mfa_required"
  | "support_ended"
  | "internal_error"
  | "accepted"
  | "rejected"
  | "quarantined"
  | "rate_limited";

/** Por que `organization_id` é nulo: rota global, ou tenant ainda não resolvido (401/403 antes da organização). */
export type EscopoGlobal = "cron" | "health" | "platform_admin" | "unresolved";

export interface LinhaDeRequisicao {
  request_id: string;
  organization_id: string | null;
  outcome: DesfechoDaRequisicao;
  /** Caminho da rota (`x-pathname` do proxy) ou o nome literal da rota. */
  path?: string | null;
  method?: string | null;
  actor_id?: string | null;
  status?: number;
  scope?: EscopoGlobal;
}

export interface LinhaDeJob {
  /** O `job_id` é o correlacionador do worker — é o `request_id` da linha. */
  request_id: string;
  organization_id: string | null;
  job_type: string;
  outcome: "claimed" | "ok" | "failed" | "blocked" | "rejected";
  attempt?: number;
  counts?: Record<string, number>;
  error_code?: string;
}

function semVazio<T extends Record<string, unknown>>(linha: T): T {
  const limpa: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(linha)) {
    if (valor !== undefined) limpa[chave] = valor;
  }
  return limpa as T;
}

/** Uma linha por requisição de API. `organization_id` nulo exige `scope`. */
export function registrarRequisicao(linha: LinhaDeRequisicao): void {
  if (linha.organization_id === null && linha.scope === undefined) {
    throw new Error("log de requisição sem organization_id precisa declarar o scope global");
  }
  logger.info("api.request", semVazio({ ...linha }));
}

/** Uma linha por transição de job no worker (§5.13). */
export function registrarJob(linha: LinhaDeJob): void {
  logger.info("job.run", semVazio({ ...linha }));
}

interface RequisicaoMinima {
  readonly headers: Headers;
  readonly method?: string;
  readonly url?: string;
}

/**
 * A linha `api.request` para rotas que NÃO passam pelo guarda de papel —
 * cron, webhook, health, administração da plataforma. Lê `request_id`,
 * caminho e método da própria requisição; quem chama diz o escopo (ou a
 * organização, quando o webhook a resolveu) e o desfecho.
 */
export function registrarRequisicaoDe(
  req: RequisicaoMinima,
  dados: {
    outcome: DesfechoDaRequisicao;
    organization_id?: string | null;
    scope?: EscopoGlobal;
    request_id?: string;
    status?: number;
    actor_id?: string | null;
  },
): void {
  let path: string | null = req.headers.get("x-pathname");
  if (!path && req.url) {
    try {
      path = new URL(req.url).pathname;
    } catch {
      path = null;
    }
  }
  const requestId = dados.request_id ?? req.headers.get("x-request-id") ?? `sem-request-id:${crypto.randomUUID()}`;
  registrarRequisicao({
    request_id: requestId,
    organization_id: dados.organization_id ?? null,
    outcome: dados.outcome,
    path,
    method: req.method ?? req.headers.get("x-request-method"),
    actor_id: dados.actor_id,
    status: dados.status,
    scope: dados.scope,
  });
}
