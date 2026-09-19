/**
 * Tipos do Stripe FALSO da bancada (`stripe-falso.mjs`). O `.mjs` é `.mjs`
 * porque o Playwright o sobe como processo; este arquivo é só o contrato que
 * a suíte TypeScript enxerga.
 */
export interface ChamadaAoFalso {
  readonly metodo: string;
  readonly caminho: string;
  readonly form: Record<string, string> | null;
  readonly auth: string | null;
}

export interface SessaoNoFalso {
  readonly organization_id: string;
  readonly price: string;
  readonly trial_days: number;
  readonly success_url: string;
  readonly cancel_url: string;
  readonly customer: string | null;
  readonly subscription: string;
}

export interface StripeFalso {
  readonly base: string;
  readonly porta: number;
  readonly chamadas: ChamadaAoFalso[];
  readonly assinaturas: Map<string, Record<string, unknown>>;
  readonly sessoes: Map<string, SessaoNoFalso>;
  readonly produtos: Map<string, Record<string, unknown>>;
  readonly precos: Map<string, Record<string, unknown>>;
  definirAssinatura(id: string, obj: Record<string, unknown>): void;
  parar(): Promise<void>;
}

export function assinarComoOStripe(corpo: string, secret: string, t?: number): string;

export function subirStripeFalso(opts: {
  chave: string;
  webhookSecret?: string;
  app?: string;
  porta?: number;
}): Promise<StripeFalso>;
