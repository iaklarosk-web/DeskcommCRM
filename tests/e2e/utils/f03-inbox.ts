import { randomUUID } from "node:crypto";

import { f02E2eSandbox } from "./f02-crm-cadastros";

/**
 * A FIXTURE DAS DUAS ORGANIZAÇÕES FICTÍCIAS DO INBOX (F03-T09).
 *
 * Mesmo contrato da fixture de F02 (`f02-crm-orders.ts`) e pela mesma razão: o
 * "7/7 por tenant" de §7.4 só prova isolamento se as sete jornadas rodarem em
 * DUAS organizações que não se conhecem. Cria só o que precisa, apaga só o que
 * criou e CONFERE que não sobrou linha — resíduo é falha, não detalhe.
 *
 * O guarda de ambiente é o mesmo de F02 (`f02E2eSandbox`): loopback obrigatório
 * e marcador do sandbox descartável, checados ANTES de qualquer escrita.
 *
 * ## Nada real é tocado
 *
 * O canal nasce com o `status` default (`STARTING`, nunca `WORKING`), então o
 * envio humano para no ramo `channel_session_not_working` de
 * `app/api/v1/messages/_handler.ts`: a mensagem é gravada e enfileirada, e
 * NENHUMA chamada sai para provedor nenhum. `WHATSAPP_MODE=mock` e
 * `AI_PROVIDER=mock` continuam valendo por fora (D12).
 *
 * ## Uma conversa por contato
 *
 * `uniq_conversations_1to1_per_contact_session` é único por
 * `(organization_id, contact_id, channel_session_id)` — sem recorte de estado
 * (ADR-019). Por isso cada conversa da prova tem o SEU contato: quatro conversas
 * no mesmo contato seriam quatro violações de unicidade, não quatro linhas.
 */

/** As quatro conversas semeadas por tenant, uma por estado que a prova usa. */
export type ConversaDaProva = "esperando" | "automatica" | "humana" | "resolvida";

export type LadoDoTeste = "A" | "B";

interface ConversaSemeada {
  id: string;
  contactId: string;
  /** O nome do contato — é por ele que a prova acha a linha na lista. */
  nome: string;
}

export interface TenantDoInbox {
  orgId: string;
  channelSessionId: string;
  conversas: Record<ConversaDaProva, ConversaSemeada>;
}

export interface F03InboxFixture {
  suffix: string;
  password: string;
  atendente: { id: string; email: string; nome: string };
  colega: { id: string; email: string; nome: string };
  tenants: Record<LadoDoTeste, TenantDoInbox>;
}

/**
 * O estado de partida de cada conversa, nos DOIS vocabulários.
 *
 * `status` é o ciclo herdado e `saas_state` é D16; a projeção
 * `trg_saas_state_project` é `AFTER UPDATE OF status` e NÃO cobre INSERT, então
 * uma conversa semeada com `status='pending'` e sem `saas_state` nasceria em
 * `open` pelo default da coluna — o par escrito aqui é o que impede a fixture de
 * mentir sobre o estado de partida. Os pares seguem `LEGACY_TO_D16`
 * (`src/conversation/state-map.ts`).
 */
const PARTIDA: Record<
  ConversaDaProva,
  { status: string; saas_state: string; comDono: boolean }
> = {
  esperando: { status: "pending", saas_state: "waiting_human", comDono: false },
  automatica: { status: "ai_handling", saas_state: "ai_handling", comDono: false },
  humana: { status: "claimed", saas_state: "human_handling", comDono: true },
  resolvida: { status: "resolved", saas_state: "resolved", comDono: true },
};

const CONVERSAS: readonly ConversaDaProva[] = Object.keys(PARTIDA) as ConversaDaProva[];

/** As tabelas tenant-aware que esta jornada escreve, conferidas na limpeza. */
const TABELAS_DO_DOMINIO = [
  "conversations",
  "messages",
  "contacts",
  "channel_sessions",
  "conversation_assignment_events",
  "demandas",
  "event_log",
  "user_organizations",
] as const;

function tenantVazio(): TenantDoInbox {
  return {
    orgId: "",
    channelSessionId: randomUUID(),
    conversas: {} as TenantDoInbox["conversas"],
  };
}

export async function seedF03Inbox(): Promise<F03InboxFixture> {
  const db = f02E2eSandbox();
  const suffix = randomUUID().slice(0, 8);
  const password = `F03-local-${randomUUID()}!`;
  const fixture: F03InboxFixture = {
    suffix,
    password,
    atendente: {
      id: "",
      email: `f03-atendente-${suffix}@example.test`,
      nome: `Atendente ${suffix}`,
    },
    colega: { id: "", email: `f03-colega-${suffix}@example.test`, nome: `Colega ${suffix}` },
    tenants: { A: tenantVazio(), B: tenantVazio() },
  };

  try {
    for (const pessoa of [fixture.atendente, fixture.colega]) {
      const { data, error } = await db.auth.admin.createUser({
        email: pessoa.email,
        password,
        email_confirm: true,
        // O nome desnormalizado que `fn_conversation_assign` copia para
        // `assigned_to_user_name` sai daqui: sem ele a tela mostraria o rótulo
        // genérico e a prova de "o responsável aparece" não distinguiria ninguém.
        user_metadata: { full_name: pessoa.nome },
      });
      if (error || !data.user) throw error ?? new Error("usuário da fixture não criado");
      pessoa.id = data.user.id;
    }

    for (const lado of ["A", "B"] as const) {
      const tenant = fixture.tenants[lado];
      const org = await db
        .from("organizations")
        .insert({
          slug: `f03-${lado.toLowerCase()}-${suffix}`,
          display_name: `F03 ${lado} ${suffix}`,
          legal_name: `F03 ${lado} ${suffix} Ltda.`,
          status: "active",
          onboarded_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (org.error || !org.data) throw org.error ?? new Error("organização não criada");
      tenant.orgId = (org.data as { id: string }).id;

      // Os dois são `manager`: `fn_conversation_assign` recusa destino que não
      // seja agent+ ativo da org, e a transferência da jornada 5 precisa de um
      // destino elegível no MESMO tenant.
      const membros = await db.from("user_organizations").insert(
        [fixture.atendente, fixture.colega].map((pessoa) => ({
          organization_id: tenant.orgId,
          user_id: pessoa.id,
          role: "manager",
          accepted_at: new Date().toISOString(),
        })),
      );
      if (membros.error) throw membros.error;

      const canal = await db.from("channel_sessions").insert({
        id: tenant.channelSessionId,
        organization_id: tenant.orgId,
        waha_session_name: `f03-${lado.toLowerCase()}-${suffix}`,
        webhook_secret_encrypted: "f03-e2e",
        display_name: `Canal fictício ${lado} ${suffix}`,
      });
      if (canal.error) throw canal.error;

      const agora = new Date().toISOString();
      for (const chave of CONVERSAS) {
        const partida = PARTIDA[chave];
        const semeada: ConversaSemeada = {
          id: randomUUID(),
          contactId: randomUUID(),
          nome: `Cliente ${chave} ${lado} ${suffix}`,
        };
        const contato = await db.from("contacts").insert({
          id: semeada.contactId,
          organization_id: tenant.orgId,
          display_name: semeada.nome,
          // `contacts_phone_e164_format` exige `^\+\d{8,15}$`.
          phone_number: `+5511${String(Date.now()).slice(-7)}${CONVERSAS.indexOf(chave)}${lado === "A" ? 1 : 2}`,
        });
        if (contato.error) throw contato.error;

        const conversa = await db.from("conversations").insert({
          id: semeada.id,
          organization_id: tenant.orgId,
          contact_id: semeada.contactId,
          channel_session_id: tenant.channelSessionId,
          status: partida.status,
          saas_state: partida.saas_state,
          saas_state_entered_at: agora,
          ...(partida.comDono
            ? {
                assigned_to_user_id: fixture.atendente.id,
                assigned_to_user_name: fixture.atendente.nome,
                assignee_kind: "user",
                assigned_at: agora,
              }
            : {}),
          last_message_preview: `Mensagem fictícia de ${semeada.nome}`,
          last_message_at: agora,
          // A janela de 24h precisa estar ABERTA para o composer aceitar texto
          // livre (ver `estadoDaJanela`); sem isto a jornada de responder
          // esbarraria num bloqueio de canal, não na máquina de estados.
          last_inbound_at: agora,
        });
        if (conversa.error) throw conversa.error;
        tenant.conversas[chave] = semeada;
      }
    }
    return fixture;
  } catch (erro) {
    await cleanupF03Inbox(fixture);
    throw erro;
  }
}

export interface LimpezaF03 {
  deleted_organizations: number;
  deleted_users: number;
  domain_tables_checked: number;
  domain_rows_remaining: number;
}

/**
 * Apaga SÓ os ids desta execução e prova que nada sobrou.
 *
 * As organizações são novas e exclusivas do teste, e todas as tabelas conferidas
 * abaixo referenciam `organizations(id) on delete cascade` — a contagem depois do
 * DELETE é o que transforma "deve ter limpado" em evidência. `api_audit_log` fica
 * DE FORA de propósito: a FK dela é `on delete set null`, porque trilha de
 * auditoria não desaparece com o tenant.
 */
export async function cleanupF03Inbox(fixture: F03InboxFixture): Promise<LimpezaF03> {
  const db = f02E2eSandbox();
  const falhas: string[] = [];
  const organizacoes = [fixture.tenants.A.orgId, fixture.tenants.B.orgId].filter(Boolean);
  let apagadas = 0;
  let usuarios = 0;

  for (const id of organizacoes) {
    const resultado = await db.from("organizations").delete().eq("id", id).select("id");
    if (resultado.error) falhas.push(`organização da fixture: ${resultado.error.message}`);
    else apagadas += resultado.data.length;
  }
  for (const pessoa of [fixture.atendente, fixture.colega]) {
    if (!pessoa.id) continue;
    const resultado = await db.auth.admin.deleteUser(pessoa.id);
    if (resultado.error) falhas.push(`usuário da fixture: ${resultado.error.message}`);
    else usuarios++;
  }

  let restantes = 0;
  if (organizacoes.length > 0) {
    for (const tabela of TABELAS_DO_DOMINIO) {
      const contagem = await db
        .from(tabela)
        .select("*", { count: "exact", head: true })
        .in("organization_id", organizacoes);
      if (contagem.error) falhas.push(`${tabela}: ${contagem.error.message}`);
      else restantes += contagem.count ?? 0;
    }
  }

  if (falhas.length > 0) throw new Error(`Limpeza F03 incompleta: ${falhas.join("; ")}`);
  return {
    deleted_organizations: apagadas,
    deleted_users: usuarios,
    domain_tables_checked: TABELAS_DO_DOMINIO.length,
    domain_rows_remaining: restantes,
  };
}
