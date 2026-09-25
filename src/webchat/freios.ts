/**
 * Os três freios do endpoint público do chat do site (F14, ADR-038 §2 T01 e
 * §6 objeção 2). Números DECLARADOS, não configuráveis na v1 (ADR-038 §5):
 *
 *  - por IP: sessões abertas na última hora e mensagens na última hora — quem
 *    abre mil sessões não escapa do freio por mensagem, e quem manda mil
 *    mensagens numa sessão não escapa do freio por sessão;
 *  - por organização: mensagens na última hora — o teto que protege o gasto
 *    da empresa cliente ANTES do limite diário de turnos da F15 (que é o
 *    terceiro freio e vive em `src/ai/limite.ts`).
 *
 * `decidirFreio` é PURA (a contagem vem de fora): é o alvo do mutante 75 e o
 * que a unit mede sem banco. `contagensDoFreio` lê as três contagens do banco.
 */
import type { TenantDb } from "@/src/tenant-context";

export const LIMITES_DO_WEBCHAT = Object.freeze({
  sessoes_por_ip_hora: 30,
  mensagens_por_ip_hora: 60,
  mensagens_por_organizacao_hora: 600,
});

export type MotivoDoFreio = "ip_sessions" | "ip_messages" | "org_messages";

export interface ContagensDoFreio {
  readonly sessoes_do_ip_na_hora: number;
  readonly mensagens_do_ip_na_hora: number;
  readonly mensagens_da_organizacao_na_hora: number;
}

/** `null` = passa; senão o PRIMEIRO freio que bateu, na ordem IP → organização. */
export function decidirFreio(
  contagens: ContagensDoFreio,
  limites: typeof LIMITES_DO_WEBCHAT = LIMITES_DO_WEBCHAT,
): MotivoDoFreio | null {
  if (contagens.sessoes_do_ip_na_hora >= limites.sessoes_por_ip_hora) return "ip_sessions";
  if (contagens.mensagens_do_ip_na_hora >= limites.mensagens_por_ip_hora) return "ip_messages";
  if (contagens.mensagens_da_organizacao_na_hora >= limites.mensagens_por_organizacao_hora) return "org_messages";
  return null;
}

/**
 * As três contagens, na última hora, para (organização, IP). As mensagens
 * "do IP" são as de entrada das conversas cujas sessões de visitante têm este
 * `ip_hash` — o IP não vive em `messages`, e não precisa: a sessão o guarda.
 */
export async function contagensDoFreio(
  db: TenantDb,
  organizationId: string,
  ipHash: string,
): Promise<ContagensDoFreio> {
  const linha = (
    await db.query<{ sessoes: string; msgs_ip: string; msgs_org: string }>(
      `select
         (select count(*) from public.webchat_sessions s
           where s.ip_hash = $2 and s.created_at > now() - interval '1 hour') as sessoes,
         (select count(*) from public.messages m
           where m.organization_id = $1 and m.provider = 'webchat' and m.direction = 'inbound'
             and m.created_at > now() - interval '1 hour'
             and m.conversation_id in (select s.conversation_id from public.webchat_sessions s
                                        where s.ip_hash = $2 and s.conversation_id is not null)) as msgs_ip,
         (select count(*) from public.messages m
           where m.organization_id = $1 and m.provider = 'webchat' and m.direction = 'inbound'
             and m.created_at > now() - interval '1 hour') as msgs_org`,
      [organizationId, ipHash],
    )
  ).rows[0];
  return {
    sessoes_do_ip_na_hora: Number(linha?.sessoes ?? 0),
    mensagens_do_ip_na_hora: Number(linha?.msgs_ip ?? 0),
    mensagens_da_organizacao_na_hora: Number(linha?.msgs_org ?? 0),
  };
}
