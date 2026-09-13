/**
 * O CALENDÁRIO do lembrete (§5.12): hora local do tenant, janela de disparo e
 * `period_key` como semana ISO — funções PURAS, sem banco e sem relógio.
 *
 * ─── Por que o fuso é do TENANT e não do processo ──────────────────────────
 *
 * §5.12 invariante 3: "tenant em `America/Manaus` dispara 1 hora depois do de
 * São Paulo, contado". O cron roda de hora em hora em UTC; `weekday` e `hour`
 * da Setting são LOCAIS. Converter com `Intl.DateTimeFormat` (e não com um
 * offset fixo) é o que faz o horário de verão de um tenant não mudar a hora do
 * outro.
 *
 * ─── A chave do período é a semana ISO da DATA LOCAL ───────────────────────
 *
 * `2026-W37`. Calculada sobre o dia local — não sobre o UTC —, porque o
 * disparo de quinta às 23h em Manaus é quinta para o cliente, mesmo que já
 * seja sexta em UTC. D23: idempotente por `(tenant, customer, período)`.
 */

export interface HoraLocal {
  /** 0 = domingo … 6 = sábado, no fuso do tenant. */
  readonly weekday: number;
  /** 0–23, no fuso do tenant. */
  readonly hour: number;
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const DIAS_DA_SEMANA: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Fuso inválido é DEFEITO de configuração, não motivo para cair em UTC em silêncio. */
export class FusoInvalido extends Error {
  constructor(public readonly timezone: string) {
    super(`fuso horário inválido: ${timezone}`);
    this.name = "FusoInvalido";
  }
}

export function horaLocal(instante: Date, timezone: string): HoraLocal {
  let formato: Intl.DateTimeFormat;
  try {
    formato = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    throw new FusoInvalido(timezone);
  }
  const partes = new Map(formato.formatToParts(instante).map((p) => [p.type, p.value]));
  const weekday = DIAS_DA_SEMANA[partes.get("weekday") ?? ""];
  const hour = Number(partes.get("hour"));
  const year = Number(partes.get("year"));
  const month = Number(partes.get("month"));
  const day = Number(partes.get("day"));
  if (weekday === undefined || [hour, year, month, day].some((n) => !Number.isInteger(n))) {
    throw new FusoInvalido(timezone);
  }
  return { weekday, hour, year, month, day };
}

/**
 * Semana ISO 8601 da data LOCAL: `YYYY-Www`. O ano é o da semana ISO (a
 * primeira semana do ano é a que contém a primeira quinta-feira), então 1º de
 * janeiro pode cair em `W52`/`W53` do ano anterior — é o padrão, não um bug.
 */
export function chaveDoPeriodo(local: HoraLocal): string {
  // Data UTC "fictícia" só com Y-M-D locais: a aritmética de semana é de
  // calendário, e aqui não há hora envolvida.
  const data = new Date(Date.UTC(local.year, local.month - 1, local.day));
  // ISO: segunda = 1 … domingo = 7.
  const diaIso = data.getUTCDay() === 0 ? 7 : data.getUTCDay();
  // A quinta-feira da mesma semana decide o ano ISO.
  const quinta = new Date(data);
  quinta.setUTCDate(data.getUTCDate() - diaIso + 4);
  const anoIso = quinta.getUTCFullYear();
  const primeiroDoAno = new Date(Date.UTC(anoIso, 0, 1));
  const semana = Math.ceil(((quinta.getTime() - primeiroDoAno.getTime()) / 86_400_000 + 1) / 7);
  return `${anoIso}-W${String(semana).padStart(2, "0")}`;
}

export interface JanelaDoLembrete {
  readonly weekday: number;
  readonly hour: number;
}

/** O tenant dispara neste instante? Igualdade de dia e hora LOCAIS. */
export function bateAJanela(local: HoraLocal, janela: JanelaDoLembrete): boolean {
  return local.weekday === janela.weekday && local.hour === janela.hour;
}
