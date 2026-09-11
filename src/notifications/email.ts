/**
 * O adapter de E-MAIL transacional (§5.16, "e-mail se `notifications.email.enabled`
 * (adapter com mock)") — e o único deles que existe nesta fase: o mock.
 *
 * ─── Por que o mock grava em `email_outbox` e não em memória ────────────────
 *
 * Mesma escolha do canal (`src/channels/mock.ts` → `mock_outbox`, ADR-017): o
 * que TERIA saído fica numa tabela `service_only`, na MESMA transação do aviso
 * in-app, e a prova de §7.6 (`email_outbox=6/6`) conta linhas no banco em vez de
 * confiar num array que morre com o processo. "Enviado" no mock é "gravado", e
 * `sent_at` é preenchido no ato para que o leitor não confunda a linha do mock
 * com uma linha de provedor real que ainda não confirmou.
 *
 * ─── O que NÃO existe aqui ──────────────────────────────────────────────────
 *
 * Provedor real. D12: credencial de e-mail transacional é item humano; a fase
 * fecha com mock e `NOT VALIDATED (real)`. Quando o provedor entrar, ele é um
 * segundo adapter com esta mesma interface ("Mudar X: novo canal = 1 adapter",
 * §5.16) — e continuará sem ler o corpo de mensagem de cliente, porque o
 * `payload` do aviso nunca o carrega.
 */
import type { TenantCtx, TenantDb } from "@/src/tenant-context";

import { preencher, TEXTO_DO_EMAIL, type EventoDeNotificacao } from "./eventos";

export interface EmailDeNotificacao {
  readonly notification_id: string;
  readonly user_id: string;
  readonly event: EventoDeNotificacao;
  readonly to_email: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface EmailAdapter {
  readonly provider: "mock";
  /** Envia (ou, no mock, grava) UM e-mail. Devolve o id da linha/entrega. */
  enviar(db: TenantDb, ctx: TenantCtx, email: EmailDeNotificacao): Promise<string>;
}

export function criarEmailAdapterMock(): EmailAdapter {
  return {
    provider: "mock",
    async enviar(db, ctx, email) {
      const texto = TEXTO_DO_EMAIL[email.event];
      const gravado = await db.query<{ id: string }>(
        `insert into public.email_outbox
           (organization_id, notification_id, user_id, event, to_email, subject, body, sent_at)
         values ($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::text, now())
         returning id`,
        [
          ctx.organization_id,
          email.notification_id,
          email.user_id,
          email.event,
          email.to_email,
          preencher(texto.assunto, email.payload),
          preencher(texto.corpo, email.payload),
        ],
      );
      const id = gravado.rows[0]?.id;
      if (id === undefined) throw new Error("email_outbox não devolveu id do e-mail mock");
      return id;
    },
  };
}
