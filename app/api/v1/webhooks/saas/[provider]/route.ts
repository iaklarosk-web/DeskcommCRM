/**
 * POST /api/v1/webhooks/saas/[provider] — a porta de entrada do SaaS
 * (F03-T03, ADR-017 decisão 3).
 *
 * ⚠️ As três rotas de webhook herdadas continuam intocadas e servindo a
 * operação de hoje; a ADR-017 (decisão 3) lista os caminhos delas. Esta é uma
 * porta NOVA, que resolve o tenant por `channel_accounts` (§5.1) em vez de por
 * token de URL ou nome de sessão. Consolidar as duas exige inventário de
 * leitores e é trabalho de fase posterior.
 *
 * O nome do transporte não aparece neste arquivo de propósito: o invariante 1
 * da doutrina de restrição de canal (`scripts/lint-channels.ts`) é catraca de
 * merge, e ela mede o texto do arquivo, comentário incluído.
 *
 * ─── O contrato de status, e por que cada um é o que é ────────────────────
 *
 *  503 — sem credencial de assinatura. Responder 200 a evento que não teve como
 *        ser verificado é o fail-open que G-27 nomeia; 503 diz ao provedor
 *        "volte depois", que é a verdade.
 *  401 — assinatura inválida, com ZERO escritas. Quem não provou ser o provedor
 *        não ganha uma linha em tabela nenhuma.
 *  202 — evento em quarentena. O provedor NÃO deve reentregar um evento que
 *        nunca terá dono: 4xx faria a fila dele encher com o que nunca passa, e
 *        5xx faria a tempestade de reentregas.
 *  200 — caminho feliz E reentrega. Reentrega é sucesso: a mensagem já está
 *        gravada, e dizer outra coisa faria o provedor tentar de novo.
 *
 * O corpo da resposta NUNCA carrega `organization_id` nem conteúdo do payload:
 * quem faz o POST é o provedor, e devolver a ele qual organização casou
 * transformaria a rota num oráculo de tenant para quem tiver um `account_key`.
 */
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { getRequestId } from "@/lib/api/request-id";
import {
  SAAS_CHANNEL_PROVIDERS,
  type SaasChannelProvider,
} from "@/src/channels/contract";
import { recebeEntrada, type RecebeEntradaDeps } from "@/src/channels/inbound";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ContextoDaRota {
  params: Promise<{ provider: string }>;
}

/**
 * A fábrica existe para a prova (G-41): a suíte de integração chama o handler
 * EM PROCESSO, com um `Request` sintético e o pool do Postgres efêmero
 * injetado, em vez de fazer POST contra endpoint no ar. Produção usa o `POST`
 * exportado abaixo, sem dependência injetada nenhuma.
 */
export function criarHandlerDeWebhookSaas(deps: RecebeEntradaDeps = {}) {
  return async function POST(req: NextRequest, contexto: ContextoDaRota): Promise<Response> {
    const requestId = getRequestId(req);
    const { provider } = await contexto.params;

    if (!SAAS_CHANNEL_PROVIDERS.includes(provider as SaasChannelProvider)) {
      return fail("not_found", "provedor de canal desconhecido", 404, { requestId });
    }

    // O corpo EXATO, em bytes: a assinatura é sobre o que chegou, não sobre o
    // que o JSON.parse entendeu.
    const raw = await req.text();
    const resultado = await recebeEntrada(
      provider as SaasChannelProvider,
      raw,
      req.headers,
      { ...deps, requestId },
    );

    switch (resultado.status) {
      case "sem_credencial":
        return fail("internal_error", "canal sem credencial de assinatura", 503, { requestId });
      case "assinatura_invalida":
        return fail("unauthorized", "assinatura do webhook inválida", 401, { requestId });
      case "sem_sessao_de_canal":
        return fail("internal_error", "conta de canal sem sessão vinculada", 503, { requestId });
      case "quarentena":
        // O motivo sai porque é enum fechado e não revela nada do payload; é o
        // que permite ao operador do provedor consertar a configuração.
        return ok({ accepted: false, reason: resultado.reason }, { requestId, status: 202 });
      case "duplicado":
        return ok({ accepted: true, replay: true }, { requestId });
      case "ingerido":
        return ok({ accepted: true, replay: false }, { requestId });
      case "fora_da_fronteira":
        // A mensagem ESTÁ gravada; a fronteira herdada é que não a atribuiu a
        // nenhum atendimento (chegou antes do fechamento, ou é de grupo).
        // 200 porque o provedor entregou certo: reentregar não mudaria nada.
        return ok({ accepted: true, replay: false, in_service_window: false }, { requestId });
      case "ack_aplicado":
        return ok({ accepted: true, ack: resultado.ack_status }, { requestId });
      case "ack_sem_mensagem":
        return ok({ accepted: true, ack: null }, { requestId });
      case "sem_evento":
        return ok({ accepted: true, processed: false }, { requestId });
      default: {
        // Desfecho novo em `ResultadoDaEntrada` sem linha aqui vira erro de
        // compilação, não um 200 silencioso.
        const naoTratado: never = resultado;
        throw new Error(`desfecho de entrada sem status HTTP: ${JSON.stringify(naoTratado)}`);
      }
    }
  };
}

export const POST = criarHandlerDeWebhookSaas();
