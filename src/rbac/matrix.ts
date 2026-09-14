/**
 * A matriz única de RBAC da Fase 1 (DIRETRIZ §5.4, D15; mapa em ADR-003).
 *
 * Quatro papéis de PESSOA (três até a F13): `attendant` opera o atendimento;
 * `manager` é attendant + gestão comercial (funil, campos, fila, relatório —
 * F13, ADR-034); `tenant_admin` é manager + administração do tenant;
 * `platform_admin` cria tenant por script
 * e lê contadores globais — e NÃO opera tenant nenhum (célula negada de
 * propósito: quem administra a plataforma não lê conversa de cliente).
 *
 * O banco continua com o CHECK herdado {viewer, agent, manager, admin}
 * (ADR-003: trocá-lo quebraria 155 policies sem ganho); o vocabulário D15
 * vive AQUI e só aqui — `papelD15DoHerdado` traduz na leitura,
 * `PAPEL_HERDADO` na gravação. Comparação de papel fora deste módulo é
 * proibida (invariante 3: `grep "role ===" src/` fora de src/rbac = 0).
 *
 * Novo papel = 1 valor no tipo + 1 coluna na matriz (Mudar X da §5.4).
 */

/**
 * F13-T02 (ADR-034 §2, reabre ADR-003): `manager` passa a ser papel D15 PRÓPRIO
 * — o gerente comercial configura funil e campos, distribui a fila e lê o
 * relatório, sem administrar usuários, produtos ou acervo. Até a F13 o valor
 * herdado `manager` era lido como `tenant_admin`.
 */
export type PapelD15 = "platform_admin" | "tenant_admin" | "manager" | "attendant";

export const PAPEIS_D15: readonly PapelD15[] = ["platform_admin", "tenant_admin", "manager", "attendant"];

export type Permissao =
  | "conversations.read"
  | "conversations.reply"
  | "actions.confirm"
  | "tasks.create"
  | "notes.create"
  | "settings.manage"
  | "users.manage"
  | "products.manage"
  | "knowledge.manage"
  | "orders.write"
  | "orders.confirm"
  | "tenants.create"
  | "platform.counters.read"
  // F13 (ADR-034 §2 T02): o CRM comercial.
  | "pipelines.manage"
  | "fields.manage"
  | "opportunities.assign"
  | "reports.read";

/** A matriz ação × papel — a linha é a permissão, a célula é a resposta. */
export const MATRIZ: Record<Permissao, Record<PapelD15, boolean>> = {
  "conversations.read": { platform_admin: false, tenant_admin: true, manager: true, attendant: true },
  "conversations.reply": { platform_admin: false, tenant_admin: true, manager: true, attendant: true },
  "actions.confirm": { platform_admin: false, tenant_admin: true, manager: true, attendant: true },
  "tasks.create": { platform_admin: false, tenant_admin: true, manager: true, attendant: true },
  "notes.create": { platform_admin: false, tenant_admin: true, manager: true, attendant: true },
  "settings.manage": { platform_admin: false, tenant_admin: true, manager: false, attendant: false },
  "users.manage": { platform_admin: false, tenant_admin: true, manager: false, attendant: false },
  "products.manage": { platform_admin: false, tenant_admin: true, manager: false, attendant: false },
  "knowledge.manage": { platform_admin: false, tenant_admin: true, manager: false, attendant: false },
  "orders.write": { platform_admin: false, tenant_admin: true, manager: true, attendant: true },
  "orders.confirm": { platform_admin: false, tenant_admin: true, manager: true, attendant: true },
  "tenants.create": { platform_admin: true, tenant_admin: false, manager: false, attendant: false },
  "platform.counters.read": { platform_admin: true, tenant_admin: false, manager: false, attendant: false },
  "pipelines.manage": { platform_admin: false, tenant_admin: true, manager: true, attendant: false },
  "fields.manage": { platform_admin: false, tenant_admin: true, manager: true, attendant: false },
  "opportunities.assign": { platform_admin: false, tenant_admin: true, manager: true, attendant: false },
  "reports.read": { platform_admin: false, tenant_admin: true, manager: true, attendant: false },
};

/** Tradução leitura: valor herdado de user_organizations.role → papel D15. */
export function papelD15DoHerdado(
  roleHerdado: string | undefined,
  isPlatformAdmin = false,
): PapelD15 | null {
  if (isPlatformAdmin) return "platform_admin";
  switch (roleHerdado) {
    case "admin":
      return "tenant_admin";
    // F13-T02 (ADR-034): `manager` é papel próprio desde a F13 (ADR-003 reaberta).
    case "manager":
      return "manager";
    case "agent":
      return "attendant";
    // viewer: descartado na Fase 1 — nenhum papel, nenhuma permissão.
    default:
      return null;
  }
}

/** Tradução gravação: papel D15 → valor aceito pelo CHECK herdado. */
export const PAPEL_HERDADO: Record<Exclude<PapelD15, "platform_admin">, string> = {
  tenant_admin: "admin",
  manager: "manager",
  attendant: "agent",
};

export function can(papel: PapelD15 | null, permissao: Permissao): boolean {
  if (papel === null) return false;
  return MATRIZ[permissao][papel];
}

export class RbacDeniedError extends Error {
  public readonly status = 403;
  public readonly code = "forbidden_role";
  constructor(
    public readonly permissao: Permissao,
    public readonly papel: PapelD15 | null,
  ) {
    super(`papel ${papel ?? "(nenhum)"} não pode ${permissao}`);
    this.name = "RbacDeniedError";
  }
}

/**
 * Gate de módulo: lança 403 quando o papel não tem a permissão. As rotas
 * herdadas continuam no requireRole de lib/auth (rank + MFA); caminhos novos
 * de src/ usam este, com o papel já traduzido para D15.
 */
export function requirePermission(papel: PapelD15 | null, permissao: Permissao): void {
  if (!can(papel, permissao)) {
    throw new RbacDeniedError(permissao, papel);
  }
}
