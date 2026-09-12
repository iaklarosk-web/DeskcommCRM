/**
 * F06-T01 — captura de erro com ALLOWLIST de contexto (§5.17).
 *
 * O Sentry herdado já sanitiza por DENYLIST (`lib/sentry/scrub.ts`: cabeçalho
 * sensível, CPF, telefone, e-mail, token em URL). Denylist protege contra o
 * que já se conhece; o contexto que ESTE produto anexa a um erro é dado de
 * tenant, e a §5.17 manda o contrário: só sai o que está nomeado. Quatro
 * campos, e a prova conta `campos capturados / campos existentes` (G-14).
 *
 * DSN é opcional (`SENTRY_DSN`, `lib/sentry/dsn.ts`): sem ele o SDK inicia
 * sem destino e `captureException` é um no-op — a chamada continua existindo
 * para que o dublê do teste a conte (`sentry_mock_captured=1`).
 */
import * as Sentry from "@sentry/nextjs";

/** Os únicos campos de contexto que saem com um erro. Lista fechada. */
export const CAMPOS_QUE_SAEM = ["request_id", "organization_id", "job_type", "error_code"] as const;

export type CampoPermitido = (typeof CAMPOS_QUE_SAEM)[number];

export interface ContextoFiltrado {
  /** O que vai para o Sentry. */
  captured: Partial<Record<CampoPermitido, string | null>>;
  /** Quantos campos o chamador tinha. Denominador da prova. */
  existing: number;
  /** Quantos sobreviveram à allowlist. Numerador. */
  kept: number;
}

/** Aplica a allowlist. Valores viram string curta; nada além dos quatro passa. */
export function contextoPermitido(contexto: Record<string, unknown>): ContextoFiltrado {
  const captured: ContextoFiltrado["captured"] = {};
  let kept = 0;
  for (const campo of CAMPOS_QUE_SAEM) {
    if (!Object.hasOwn(contexto, campo)) continue;
    const valor = contexto[campo];
    captured[campo] = valor === null || valor === undefined ? null : String(valor).slice(0, 200);
    kept += 1;
  }
  return { captured, existing: Object.keys(contexto).length, kept };
}

/** A única porta de saída de erro do código SaaS para o Sentry. */
export function capturarErro(erro: unknown, contexto: Record<string, unknown> = {}): ContextoFiltrado {
  const filtrado = contextoPermitido(contexto);
  Sentry.captureException(erro, { extra: filtrado.captured });
  return filtrado;
}
