/**
 * Limite diário de turnos de IA por organização (F15-T02, ADR-036 §2 T02,
 * D54 c).
 *
 * `ai.limits.daily_turns` (Setting, `int`, default 0 = sem teto — declarado,
 * nunca fato) é conferido ANTES de qualquer chamada ao provedor, pelo mesmo
 * caminho que o plano já usa: o resolver de Entitlement (§5.3, D14). Ao bater
 * o limite, `ai.reply` é negada com `daily_limit_reached`, o turno vira
 * handoff `tenant_rule` (regra do tenant, D19) e o `tenant_admin` recebe UM
 * aviso `ai.limit_reached` por dia. É a "pausa automática": a IA para de
 * responder sozinha até o dia virar (no fuso da organização) ou até alguém
 * subir o limite — e `resumed` é medido exatamente assim.
 *
 * O que conta como turno: uma linha `operation='chat'` em `ai_usage_events`
 * — é o que `withEntitlement` grava por chamada `ai.reply`, sem tarifa
 * (D54 c: turnos, não custo estimado). `ai.enabled=false` continua a pausa
 * MANUAL (`turno.ts`), independente deste arquivo.
 */
import type { EntitlementResposta } from "@/src/entitlement/capability";
import type { Resolver } from "@/src/entitlement/entitlement";
import { jaAvisado, membrosPorPapel, notify } from "@/src/notifications";
import { getSettingIn } from "@/src/tenant-config/settings";
import { withTenant, type TenantCtx, type TenantDb } from "@/src/tenant-context";
import type { ServicePool } from "@/src/tenant-context/db";

export const SEM_LIMITE = 0;
export const MOTIVO_LIMITE_DIARIO = "daily_limit_reached";
const FUSO_PADRAO = "America/Sao_Paulo";

export interface JanelaDoDia {
  /** `YYYY-MM-DD` no fuso da organização — o que o aviso mostra. */
  readonly day: string;
  readonly desde: Date;
  readonly ate: Date;
}

function partesLocais(instante: Date, timezone: string): { y: number; m: number; d: number; h: number; mi: number; s: number } {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(instante);
  const valor = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value ?? "0");
  return { y: valor("year"), m: valor("month"), d: valor("day"), h: valor("hour"), mi: valor("minute"), s: valor("second") };
}

/**
 * A meia-noite local de `agora` no fuso dado, em UTC, e a seguinte. Sem
 * biblioteca: o deslocamento é medido pelo próprio `Intl` (a diferença entre
 * o instante e a sua leitura local), o que cobre horário de verão.
 */
export function janelaDoDia(agora: Date, timezone: string = FUSO_PADRAO): JanelaDoDia {
  let fuso = timezone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: fuso });
  } catch {
    fuso = FUSO_PADRAO;
  }
  const local = partesLocais(agora, fuso);
  const comoUtc = Date.UTC(local.y, local.m - 1, local.d, local.h, local.mi, local.s);
  const deslocamentoMs = comoUtc - Math.floor(agora.getTime() / 1000) * 1000;
  const meiaNoiteLocalComoUtc = Date.UTC(local.y, local.m - 1, local.d);
  const desde = new Date(meiaNoiteLocalComoUtc - deslocamentoMs);
  const ate = new Date(desde.getTime() + 24 * 3_600_000);
  const day = `${local.y}-${String(local.m).padStart(2, "0")}-${String(local.d).padStart(2, "0")}`;
  return { day, desde, ate };
}

export interface EstadoDoLimite {
  readonly limit: number;
  readonly used: number;
  readonly remaining: number | null;
  readonly allowed: boolean;
  readonly day: string;
  readonly timezone: string;
}

/** Turnos do dia da organização — linhas `chat` de `ai_usage_events` na janela. */
export async function turnosDoDia(db: TenantDb, ctx: TenantCtx, janela: JanelaDoDia): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `select count(*)::text as n from public.ai_usage_events
      where organization_id = $1 and operation = 'chat'
        and created_at >= $2 and created_at < $3`,
    [ctx.organization_id, janela.desde, janela.ate],
  );
  return Number(rows[0]?.n ?? 0);
}

export async function estadoDoLimiteIn(db: TenantDb, ctx: TenantCtx, agora: Date): Promise<EstadoDoLimite> {
  // `business.timezone` é alias canônico de `organizations.timezone`
  // (`getSettingIn` recusa o alias de propósito); lê-se da origem.
  const [bruto, org] = await Promise.all([
    getSettingIn(db, ctx, "ai.limits.daily_turns"),
    db.query<{ timezone: string | null }>(`select timezone from public.organizations where id = $1`, [ctx.organization_id]),
  ]);
  const limit = typeof bruto === "number" && Number.isInteger(bruto) && bruto > 0 ? bruto : SEM_LIMITE;
  const fusoBruto = org.rows[0]?.timezone;
  const timezone = typeof fusoBruto === "string" && fusoBruto !== "" ? fusoBruto : FUSO_PADRAO;
  const janela = janelaDoDia(agora, timezone);
  const used = await turnosDoDia(db, ctx, janela);
  const remaining = limit === SEM_LIMITE ? null : Math.max(0, limit - used);
  return { limit, used, remaining, allowed: limit === SEM_LIMITE || used < limit, day: janela.day, timezone };
}

export async function estadoDoLimite(ctx: TenantCtx, deps: { pool?: ServicePool; agora?: () => Date } = {}): Promise<EstadoDoLimite> {
  const agora = (deps.agora ?? (() => new Date()))();
  return withTenant(ctx, (db) => estadoDoLimiteIn(db, ctx, agora), { pool: deps.pool });
}

/**
 * Envolve um resolver de Entitlement: para `ai.reply`, depois do plano, o
 * limite diário da organização. As outras capabilities passam intactas.
 */
export function resolverComLimiteDiario(base: Resolver, agora: () => Date = () => new Date()): Resolver {
  return async (ctx, capability, deps): Promise<EntitlementResposta> => {
    const doPlano = await base(ctx, capability, deps);
    if (capability !== "ai.reply" || !doPlano.allowed) return doPlano;
    const limite = await estadoDoLimite(ctx, { pool: deps.pool, agora });
    if (limite.allowed) {
      return limite.remaining === null
        ? doPlano
        : { ...doPlano, remaining: doPlano.remaining === null ? limite.remaining : Math.min(doPlano.remaining, limite.remaining) };
    }
    return { allowed: false, remaining: 0, reason: MOTIVO_LIMITE_DIARIO };
  };
}

/**
 * UM aviso `ai.limit_reached` por dia ao `tenant_admin` (§5.16), na
 * transação própria — chamado pelo turno quando o Entitlement nega por
 * `daily_limit_reached`. `already=true` é o dia já avisado: contado, não
 * repetido.
 */
export async function avisarLimiteDiario(
  ctx: TenantCtx,
  deps: { pool?: ServicePool; agora?: () => Date } = {},
): Promise<{ notified: number; already: boolean; day: string }> {
  const agora = (deps.agora ?? (() => new Date()))();
  return withTenant(
    ctx,
    async (db) => {
      const estado = await estadoDoLimiteIn(db, ctx, agora);
      if (await jaAvisado(db, ctx, "ai.limit_reached", "day", estado.day)) {
        return { notified: 0, already: true, day: estado.day };
      }
      const admins = await membrosPorPapel(db, ctx, ["tenant_admin"]);
      const aviso = await notify(db, ctx, "ai.limit_reached", admins, {
        used: estado.used,
        limit: estado.limit,
        day: estado.day,
        timezone: estado.timezone,
      });
      return { notified: aviso.count, already: false, day: estado.day };
    },
    { pool: deps.pool },
  );
}
