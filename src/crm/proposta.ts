/**
 * Proposta de dado do contato pela FACHADA SaaS (F18-T02, ADR-040 §2).
 *
 * `crm_propose_contact_field` é a ferramenta em que o herdado acertou a mão: a
 * IA NÃO grava no cadastro o que o cliente disse — ela propõe, e uma pessoa
 * confirma. A ação entra no catálogo com esse mesmo desenho; o que muda é que
 * agora ela tem política, teto diário e auditoria como todas as outras.
 *
 * A implementação herdada (`lib/contacts/proposta-de-dado.ts`) fala por
 * PostgREST e não alcança o pool do worker (nem o gate de integração, que não
 * tem PostgREST — lição 24 da F13). Aqui está a mesma decisão escrita em SQL,
 * com as mesmas três recusas nomeadas do original: contato inexistente,
 * contato anonimizado e proposta já pendente do mesmo campo.
 */
import { withTenant, type TenantCtx } from "@/src/tenant-context";
import type { ServicePool } from "@/src/tenant-context/db";

export const CAMPOS_PROPONIVEIS = ["email", "name", "phone_number"] as const;
export type CampoProponivel = (typeof CAMPOS_PROPONIVEIS)[number];

/** Prazo da proposta: o herdado usa 7 dias e não há motivo para divergir. */
const DIAS_ATE_VENCER = 7;

export type MotivoDaRecusaDaProposta =
  | "contato_nao_encontrado"
  | "contato_anonimizado"
  | "valor_igual_ao_atual"
  | "ja_existe_proposta";

export type ResultadoDaProposta =
  | { readonly ok: true; readonly proposal_id: string; readonly field: CampoProponivel }
  | { readonly ok: false; readonly reason: MotivoDaRecusaDaProposta };

export async function proporCampoDoContato(
  ctx: TenantCtx,
  pedido: {
    readonly contact_id: string;
    readonly field: CampoProponivel;
    readonly value: string;
    readonly conversation_id?: string;
  },
  deps: { pool?: ServicePool } = {},
): Promise<ResultadoDaProposta> {
  return withTenant(
    ctx,
    async (db) => {
      const contato = await db.query<{ is_anonymized: boolean; atual: string | null }>(
        `select is_anonymized,
                case $3::text when 'email' then email when 'name' then name else phone_number end as atual
           from public.contacts
          where organization_id=$1 and id=$2
          limit 1`,
        [ctx.organization_id, pedido.contact_id, pedido.field],
      );
      const linha = contato.rows[0];
      if (linha === undefined) return { ok: false, reason: "contato_nao_encontrado" } as const;
      if (linha.is_anonymized) return { ok: false, reason: "contato_anonimizado" } as const;
      if ((linha.atual ?? "").trim() === pedido.value.trim()) {
        return { ok: false, reason: "valor_igual_ao_atual" } as const;
      }
      const pendente = await db.query<{ id: string }>(
        `select id from public.contact_field_proposals
          where organization_id=$1 and contact_id=$2 and campo=$3 and status='pending'
          limit 1`,
        [ctx.organization_id, pedido.contact_id, pedido.field],
      );
      if (pendente.rows[0] !== undefined) return { ok: false, reason: "ja_existe_proposta" } as const;

      const criada = await db.query<{ id: string }>(
        `insert into public.contact_field_proposals
           (organization_id, contact_id, campo, valor_proposto, valor_anterior,
            conversation_id, status, proposed_at, expires_at)
         values ($1,$2,$3,$4,$5,$6,'pending', now(), now() + ($7 || ' days')::interval)
         returning id`,
        [
          ctx.organization_id,
          pedido.contact_id,
          pedido.field,
          pedido.value.trim(),
          linha.atual,
          pedido.conversation_id ?? null,
          String(DIAS_ATE_VENCER),
        ],
      );
      const id = criada.rows[0]?.id;
      if (id === undefined) throw new Error("insert de contact_field_proposals não devolveu linha");
      return { ok: true, proposal_id: id, field: pedido.field } as const;
    },
    deps,
  );
}
