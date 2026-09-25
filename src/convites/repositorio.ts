/**
 * Convites de equipe: emissão, revogação, leitura e aceite (F20-T02, ADR-045 §2).
 *
 * A tabela é `service_only` (D35) — tudo aqui passa pelo pool de serviço, e é a
 * rota que decide quem pode chamar. O que este módulo garante e a aplicação não
 * precisa lembrar:
 *
 *   - **reenviar revoga o anterior** (D61 b): `emitir` revoga o convite vivo da
 *     mesma pessoa ANTES de inserir o novo, na mesma transação. Sem isso o
 *     índice único parcial recusaria o insert — o índice é a rede, esta é a
 *     regra;
 *   - o aceite é do banco (`fn_aceitar_convite_de_equipe`), não daqui;
 *   - o e-mail é normalizado na entrada, porque é por `lower(email)` que o
 *     índice do "um vivo por pessoa" casa.
 */
import type { ServicePool } from "@/src/tenant-context/db";
import { getServicePool } from "@/src/tenant-context/db";

import { linkDoConvite, normalizarEmailDeConvite, sortearTokenDeConvite } from "./token";

export type PapelDoConvite = "viewer" | "agent" | "manager" | "admin";

export interface ConvitePendente {
  readonly id: string;
  readonly token: string;
  readonly email: string;
  readonly role: PapelDoConvite;
  readonly invited_by: string | null;
  readonly expires_at: string;
  readonly created_at: string;
}

export interface Deps {
  readonly pool?: ServicePool;
}

export const DIAS_DE_VALIDADE = 7; // D59 c

interface LinhaDeConvite {
  id: string;
  token: string;
  email: string;
  role: PapelDoConvite;
  invited_by: string | null;
  expires_at: string;
  created_at: string;
}

/**
 * Emite um convite e devolve a linha + o link curto. Revoga o convite vivo
 * anterior da mesma pessoa (D61 b) e conta quantos revogou — quem chama registra
 * isso na auditoria, para "por que o link antigo parou de funcionar?" ter
 * resposta.
 */
export async function emitirConvite(
  entrada: {
    organization_id: string;
    email: string;
    role: PapelDoConvite;
    invited_by: string | null;
    interface_settings?: Record<string, unknown>;
    app_url: string;
    dias?: number;
    /**
     * Quando a chamada é uma REPETIÇÃO idempotente (o POST do tenant com a
     * mesma Idempotency-Key), reaproveitar o convite vivo em vez de emitir
     * outro: repetir a criação não pode invalidar o link que a pessoa já
     * recebeu. Emissão normal (inclusive "reenviar") continua revogando.
     */
    reaproveitar_vivo?: boolean;
  },
  deps: Deps = {},
): Promise<{ convite: ConvitePendente; link: string; revogados: number }> {
  const pool = deps.pool ?? (await getServicePool());
  const email = normalizarEmailDeConvite(entrada.email);
  const token = sortearTokenDeConvite();
  const dias = entrada.dias ?? DIAS_DE_VALIDADE;
  if (entrada.reaproveitar_vivo === true) {
    const { rows } = await pool.query<LinhaDeConvite>(
      `select id, token, email, role, invited_by, expires_at::text, created_at::text
         from public.team_invites
        where organization_id = $1 and lower(email) = $2
          and accepted_at is null and revoked_at is null and expires_at > now()
        order by created_at desc limit 1`,
      [entrada.organization_id, email],
    );
    const vivo = rows[0];
    if (vivo) return { convite: vivo, link: linkDoConvite(entrada.app_url, vivo.token), revogados: 0 };
  }

  const cliente = await pool.connect();
  try {
    await cliente.query("begin");
    const revogados = await cliente.query(
      `update public.team_invites
          set revoked_at = now(), revoked_by = $3, revoked_reason = 'reenviado', updated_at = now()
        where organization_id = $1 and lower(email) = $2
          and accepted_at is null and revoked_at is null`,
      [entrada.organization_id, email, entrada.invited_by],
    );
    const { rows } = await cliente.query<LinhaDeConvite>(
      `insert into public.team_invites
         (organization_id, token, email, role, interface_settings, invited_by, expires_at)
       values ($1, $2, $3, $4, $5::jsonb, $6, now() + make_interval(days => $7))
       returning id, token, email, role, invited_by, expires_at::text, created_at::text`,
      [
        entrada.organization_id,
        token,
        email,
        entrada.role,
        JSON.stringify(entrada.interface_settings ?? { preset: "completa" }),
        entrada.invited_by,
        dias,
      ],
    );
    await cliente.query("commit");
    const convite = rows[0]!;
    return { convite, link: linkDoConvite(entrada.app_url, convite.token), revogados: revogados.rowCount ?? 0 };
  } catch (erro) {
    await cliente.query("rollback");
    throw erro;
  } finally {
    cliente.release();
  }
}

/** Os convites que ainda podem ser aceitos, do mais novo para o mais velho. */
export async function listarPendentes(
  organization_id: string,
  deps: Deps = {},
): Promise<ConvitePendente[]> {
  const pool = deps.pool ?? (await getServicePool());
  const { rows } = await pool.query<LinhaDeConvite>(
    `select id, token, email, role, invited_by, expires_at::text, created_at::text
       from public.team_invites
      where organization_id = $1 and accepted_at is null and revoked_at is null and expires_at > now()
      order by created_at desc`,
    [organization_id],
  );
  return rows;
}

/**
 * Revoga um convite vivo. Devolve `false` quando não havia o que revogar — o
 * chamador distingue "revoguei" de "já não valia", em vez de responder sucesso
 * para os dois.
 */
export async function revogarConvite(
  entrada: { organization_id: string; invite_id: string; revoked_by: string | null },
  deps: Deps = {},
): Promise<boolean> {
  const pool = deps.pool ?? (await getServicePool());
  const { rowCount } = await pool.query(
    `update public.team_invites
        set revoked_at = now(), revoked_by = $3, revoked_reason = 'manual', updated_at = now()
      where organization_id = $1 and id = $2 and accepted_at is null and revoked_at is null`,
    [entrada.organization_id, entrada.invite_id, entrada.revoked_by],
  );
  return (rowCount ?? 0) > 0;
}

export type MotivoDaRecusa =
  | "invite_not_found"
  | "invite_revoked"
  | "invite_expired"
  | "invite_already_accepted"
  | "invite_email_mismatch";

export interface ConviteParaAceite {
  readonly id: string;
  readonly organization_id: string;
  readonly email: string;
  readonly role: PapelDoConvite;
  readonly expires_at: string;
}

/**
 * Lê o convite pelo token para a TELA decidir o que mostrar (pedir login,
 * avisar que expirou, dizer que é de outro e-mail). Quem aceita é o banco.
 */
export async function lerConvitePorToken(
  token: string,
  deps: Deps = {},
): Promise<{ convite: ConviteParaAceite } | { recusa: MotivoDaRecusa }> {
  const pool = deps.pool ?? (await getServicePool());
  const { rows } = await pool.query<{
    id: string;
    organization_id: string;
    email: string | null;
    role: PapelDoConvite;
    expires_at: string;
    accepted_at: string | null;
    revoked_at: string | null;
    vencido: boolean;
  }>(
    `select id, organization_id, email, role, expires_at::text,
            accepted_at::text, revoked_at::text, (expires_at <= now()) as vencido
       from public.team_invites where token = $1`,
    [token],
  );
  const linha = rows[0];
  if (!linha) return { recusa: "invite_not_found" };
  if (linha.revoked_at !== null) return { recusa: "invite_revoked" };
  if (linha.accepted_at !== null) return { recusa: "invite_already_accepted" };
  if (linha.vencido) return { recusa: "invite_expired" };
  return {
    convite: {
      id: linha.id,
      organization_id: linha.organization_id,
      email: linha.email ?? "",
      role: linha.role,
      expires_at: linha.expires_at,
    },
  };
}

/** O aceite é atômico no banco (migration 9036): trava a linha e decide lá. */
export async function aceitarConvitePorToken(
  entrada: { token: string; user_id: string },
  deps: Deps = {},
): Promise<{ ok: true; organization_id: string; invite_id: string } | { ok: false; recusa: MotivoDaRecusa }> {
  const pool = deps.pool ?? (await getServicePool());
  try {
    const { rows } = await pool.query<{ resultado: { invite_id: string; organization_id: string } }>(
      `select public.fn_aceitar_convite_de_equipe($1, $2) as resultado`,
      [entrada.token, entrada.user_id],
    );
    const r = rows[0]!.resultado;
    return { ok: true, organization_id: r.organization_id, invite_id: r.invite_id };
  } catch (erro) {
    const texto = erro instanceof Error ? erro.message : String(erro);
    const conhecidas: MotivoDaRecusa[] = [
      "invite_not_found",
      "invite_revoked",
      "invite_expired",
      "invite_already_accepted",
      "invite_email_mismatch",
    ];
    const recusa = conhecidas.find((m) => texto.includes(m));
    if (recusa) return { ok: false, recusa };
    throw erro;
  }
}
