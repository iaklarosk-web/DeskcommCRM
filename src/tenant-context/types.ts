/**
 * TenantContext — tipos (docs/DIRETRIZ.md §5.1, D20).
 *
 * O contrato inteiro do módulo cabe numa frase: sabe obter `organization_id`
 * de cada ponto de entrada, e nada mais. Cada fonte tem a sua função
 * (`fromSession` aqui na F01-T01; `fromJob`/`fromWebhook`/`forEachEligibleTenant`
 * chegam na F01-T02/F03) e TODAS devolvem este mesmo TenantCtx — quem consome
 * não sabe de onde o tenant veio, só que veio de fonte confiável.
 */

export type TenantSource = "session" | "job" | "webhook" | "cron" | "api_token";

export interface TenantCtx {
  organization_id: string;
  /** Presente quando a fonte é uma sessão de usuário. */
  user_id?: string;
  /** Papel efetivo na organização ativa, quando a fonte o conhece. */
  role?: string;
  source: TenantSource;
}

/**
 * Falha de resolução de tenant é ERRO, nunca null: quem esquece o catch quebra
 * alto em vez de deixar uma query correr sem tenant (o modo de falha que a RLS
 * multi-tenant existe para impedir).
 */
export class TenantResolutionError extends Error {
  constructor(
    public readonly source: TenantSource,
    public readonly reason: string,
  ) {
    super(`tenant não resolvido (${source}): ${reason}`);
    this.name = "TenantResolutionError";
  }
}
