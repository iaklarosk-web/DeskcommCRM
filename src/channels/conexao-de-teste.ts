/**
 * A conexão de TESTE do wizard (`WHATSAPP_MODE=mock`), inteira dentro da
 * fronteira de canal (F18-T04, §B19).
 *
 * Antes isto vivia em `app/actions/onboarding/conectarCanalMock.ts`, que
 * escrevia o nome da sessão, a chave da conta e a coluna do transporte na
 * própria action — e por isso `pnpm lint:channels` reprovava desde a F11: a
 * doutrina `restricao-de-canal` diz que só a fronteira nomeia o transporte. A
 * régua estava certa e ninguém a rodava no gate; agora ela roda (ADR-041 §4).
 *
 * O que a action faz agora é pedir uma conexão de teste. Como ela se chama no
 * banco é assunto daqui.
 */
import type { TenantDb } from "@/src/tenant-context";

import { SAAS_CHANNEL_PROVIDERS, type SaasChannelProvider } from "./contract";

/** A chave de provider da conexão de teste, tirada do contrato (nunca literal solto). */
export const PROVIDER_DA_CONEXAO_DE_TESTE: SaasChannelProvider = SAAS_CHANNEL_PROVIDERS[1];

export interface ConexaoDeTesteCriada {
  readonly session_id: string;
  readonly session_name: string;
}

/**
 * Cria (ou reaproveita) a sessão de canal e a conta que o adapter de teste
 * atende. Idempotente: rodar duas vezes devolve a mesma sessão.
 */
export async function criarConexaoDeTeste(
  db: TenantDb,
  organizationId: string,
): Promise<ConexaoDeTesteCriada> {
  const sessionName = `${PROVIDER_DA_CONEXAO_DE_TESTE}-${organizationId.slice(0, 8)}`;
  const accountKey = `${PROVIDER_DA_CONEXAO_DE_TESTE}-${organizationId}`;
  const criada = await db.query<{ id: string }>(
    `insert into public.channel_sessions (organization_id, waha_session_name, webhook_secret_encrypted)
     values ($1, $2, '\\x00'::bytea)
     on conflict do nothing
     returning id`,
    [organizationId, sessionName],
  );
  const sessionId =
    criada.rows[0]?.id ??
    (
      await db.query<{ id: string }>(
        `select id from public.channel_sessions where organization_id = $1 and waha_session_name = $2`,
        [organizationId, sessionName],
      )
    ).rows[0]?.id;
  if (sessionId === undefined) throw new Error("sessão de canal de teste não criada");
  await db.query(
    `insert into public.channel_accounts (organization_id, provider, account_key, channel_session_id)
     values ($1, $2, $3, $4)
     on conflict (provider, account_key) do update set channel_session_id = excluded.channel_session_id`,
    [organizationId, PROVIDER_DA_CONEXAO_DE_TESTE, accountKey, sessionId],
  );
  return { session_id: sessionId, session_name: sessionName };
}
