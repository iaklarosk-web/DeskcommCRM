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
import { wahaSaasAdapter } from "./waha";
import {
  SAAS_CHANNEL_PROVIDERS,
  type SaasChannelAdapter,
  type SaasChannelProvider,
} from "./contract";

const ADAPTERS: Record<SaasChannelProvider, SaasChannelAdapter> = {
  waha: wahaSaasAdapter,
  mock: mockAdapter,
};

/** O provider assumido quando o chamador não diz qual. */
const PROVIDER_PADRAO: SaasChannelProvider = "waha";

export interface GetSaasAdapterDeps {
  /** Seam de teste: sem ele, o modo vem do ambiente. */
  modo?: string;
  adapters?: Partial<Record<SaasChannelProvider, SaasChannelAdapter>>;
}

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
  if (modoMockLigado(deps.modo)) return matriz.mock;

  const pedido = provider ?? PROVIDER_PADRAO;
  if (!SAAS_CHANNEL_PROVIDERS.includes(pedido)) {
    throw new Error(`unknown_saas_channel_provider: ${String(pedido)}`);
  }
  const adapter = matriz[pedido];
  if (!adapter) throw new Error(`unknown_saas_channel_provider: ${String(pedido)}`);
  return adapter;
}

export { criarAdapterMock, idDeterministicoDoMock, mockAdapter } from "./mock";
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
