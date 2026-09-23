/**
 * A porta do contrato de canal do SaaS (§5.7, ADR-017). Quem envia ou ingere
 * pede o adapter aqui e nunca importa `src/channels/waha.ts` direto.
 *
 * ⚠️ `WHATSAPP_MODE=mock` (D12) DEVOLVE SEMPRE O MOCK, qualquer que seja o
 * provider pedido — inclusive `"waha"` escrito à mão no chamador. É deliberado:
 * o modo mock existe para garantir que nenhuma mensagem saia para pessoa real
 * durante a construção e o `verify.sh` (que força o modo, `scripts/verify.sh:19`),
 * e uma exceção "só neste caminho" seria exatamente o furo pelo qual a primeira
 * mensagem real escaparia. Quem quer o canal real tira o modo mock do ambiente,
 * não passa um argumento diferente.
 */
import { mockAdapter } from "./mock";
import { webchatSaasAdapter } from "./webchat";
import { wahaSaasAdapter } from "./waha";
import {
  SAAS_CHANNEL_PROVIDERS,
  type SaasChannelAdapter,
  type SaasChannelProvider,
} from "./contract";

const ADAPTERS: Record<SaasChannelProvider, SaasChannelAdapter> = {
  waha: wahaSaasAdapter,
  mock: mockAdapter,
  webchat: webchatSaasAdapter,
};

/** O provider assumido quando o chamador não diz qual. */
const PROVIDER_PADRAO: SaasChannelProvider = "waha";

export interface GetSaasAdapterDeps {
  /** Seam de teste: sem ele, o modo vem do ambiente. */
  modo?: string;
  adapters?: Partial<Record<SaasChannelProvider, SaasChannelAdapter>>;
}

export { criarConexaoDeTeste, PROVIDER_DA_CONEXAO_DE_TESTE, type ConexaoDeTesteCriada } from "./conexao-de-teste";

export function modoMockLigado(modo?: string): boolean {
  return (modo ?? process.env.WHATSAPP_MODE ?? "").trim().toLowerCase() === "mock";
}

/**
 * Fail-closed como o herdado (`lib/channels/index.ts:20-23`): provider fora da
 * matriz LANÇA em vez de cair no default. Enviar pelo canal errado é pior que
 * não enviar.
 */
export function getSaasAdapter(
  provider?: SaasChannelProvider,
  deps: GetSaasAdapterDeps = {},
): SaasChannelAdapter {
  const matriz = { ...ADAPTERS, ...(deps.adapters ?? {}) };
  const pedido = provider ?? PROVIDER_PADRAO;
  // `WHATSAPP_MODE=mock` dubla o TRANSPORTE do WhatsApp (D12). O chat do site
  // (F14) não tem transporte: a entrega é a linha que a página do visitante
  // lê, e dublá-la mandaria a resposta para o `mock_outbox` em vez de para a
  // pessoa que está na página. O mock continua valendo para todo o resto.
  if (modoMockLigado(deps.modo) && pedido !== "webchat") return matriz.mock;

  if (!SAAS_CHANNEL_PROVIDERS.includes(pedido)) {
    throw new Error(`unknown_saas_channel_provider: ${String(pedido)}`);
  }
  const adapter = matriz[pedido];
  if (!adapter) throw new Error(`unknown_saas_channel_provider: ${String(pedido)}`);
  return adapter;
}

export { criarAdapterMock, idDeterministicoDoMock, mockAdapter } from "./mock";
export { webchatSaasAdapter } from "./webchat";
export { criarAdapterWahaSaas, wahaSaasAdapter, type MemoDeEnvio } from "./waha";
export {
  CAMPOS_CATALOGADOS,
  lerAccountKey,
  parseEnvelopeWaha,
  type ParseDeps,
  type Relogio,
} from "./inbound-parse";
export {
  ChannelMediaUnavailable,
  ChannelSendFailed,
  foiRejeitado,
  INBOUND_EVENT_FIELDS,
  lerCabecalho,
  montarRefDeMidia,
  partirRefDeMidia,
  REJECT_REASONS,
  rejeitar,
  SAAS_CHANNEL_PROVIDERS,
  type AckStatus,
  type HeaderBag,
  type InboundEvent,
  type InboundMedia,
  type OutboundMessage,
  type ParsedInbound,
  type ParseInboundResult,
  type Rejected,
  type RejectReason,
  type SaasChannelAdapter,
  type SaasChannelProvider,
} from "./contract";
