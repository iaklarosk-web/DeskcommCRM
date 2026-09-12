/**
 * O adapter WAHA do contrato SaaS — um EMBRULHO, nunca uma segunda ingestão
 * (ADR-017, decisão 1).
 *
 * Cada método aqui delega ao herdado que já existe e já é provado:
 *
 *  - assinatura → `authenticateWahaWebhook` (`lib/waha/webhook-auth.ts:50`)
 *  - contrato do payload → `wahaEnvelopeSchema` (`lib/waha/envelope.ts`)
 *  - identidade do remetente → `parseChatId` / `telefoneAlternativoDe`
 *    (`lib/waha/ingest.ts:190,380`)
 *  - envio → o `ChannelAdapter` herdado por `getAdapter("waha")`
 *    (`lib/channels/index.ts:20`)
 *  - mídia → `fetchInboundMedia` do mesmo adapter herdado
 *
 * Reimplementar qualquer um deles seria perder paridade de comportamento sem
 * ninguém perceber — o defeito que `lib/channels/adapters/waha.ts` declara no
 * próprio cabeçalho e que esta camada repete de propósito.
 *
 * ─── Segredo e G-27 ────────────────────────────────────────────────────────
 *
 * `isConfigured()` é falso quando NÃO HÁ segredo de assinatura. A rota da
 * F03-T03 lê isso e responde 503 com contador — nunca 200 a evento que não teve
 * como ser verificado. O nome da variável é `WAHA_HMAC_SECRET`
 * (`lib/env.ts:146`); o VALOR não é lido, impresso nem registrado em lugar
 * nenhum deste arquivo.
 */
import { getAdapter } from "@/lib/channels";
import type { ChannelAdapter } from "@/lib/channels/types";
import { env } from "@/lib/env";
import { authenticateWahaWebhook } from "@/lib/waha/webhook-auth";

import {
  ChannelMediaUnavailable,
  ChannelSendFailed,
  lerCabecalho,
  partirRefDeMidia,
  type HeaderBag,
  type OutboundMessage,
  type ParseInboundResult,
  type SaasChannelAdapter,
} from "./contract";
import { lerAccountKey, parseEnvelopeWaha, type Relogio } from "./inbound-parse";
import type { TenantCtx } from "@/src/tenant-context";

/** O cabeçalho que o WAHA assina — o mesmo que a rota herdada lê. */
const CABECALHO_DE_ASSINATURA = "x-webhook-hmac";

/**
 * Piso de tamanho do segredo, espelho de `MIN_SECRET_LEN`
 * (`lib/waha/webhook-auth.ts:37`). Abaixo disso é placeholder ou lixo de
 * decrypt, e tratar placeholder como segredo é o fail-open que aquele arquivo
 * existe para fechar.
 */
const TAMANHO_MINIMO_DE_SEGREDO = 16;

/**
 * Memória de envio por `(tenant, idempotency_key)`.
 *
 * ⚠️ LIMITE DECLARADO: é do PROCESSO. Ela fecha a janela do reenvio dentro da
 * mesma requisição/worker e é o que a prova do contrato mede; a garantia
 * DURÁVEL de não-duplicação é da F03-T07, onde o job de saída é idempotente por
 * `message_id` em `job_queue`. Chamar isto de "idempotência de canal" sem essa
 * frase seria vender uma promessa que o processo não pode cumprir depois de um
 * restart.
 */
export type MemoDeEnvio = Map<string, string>;

export interface AdapterWahaDeps {
  /** Só o TAMANHO é consultado; o valor nunca é registrado. */
  segredoDeAssinatura?: () => string;
  /** O `ChannelAdapter` herdado. Injetável para a prova não tocar rede. */
  transporte?: () => ChannelAdapter;
  agora?: Relogio;
  memo?: MemoDeEnvio;
}

function chaveDoMemo(organizationId: string, idempotencyKey: string): string {
  return `${organizationId}:${idempotencyKey}`;
}

export function criarAdapterWahaSaas(deps: AdapterWahaDeps = {}): SaasChannelAdapter {
  const segredoDeAssinatura =
    deps.segredoDeAssinatura ?? (() => (env.WAHA_HMAC_SECRET ?? "").trim());
  const transporte = deps.transporte ?? (() => getAdapter("waha"));
  const agora = deps.agora ?? (() => new Date());
  const memo: MemoDeEnvio = deps.memo ?? new Map<string, string>();

  return {
    provider: "waha",

    isConfigured(): boolean {
      // Duas credenciais, duas metades do trabalho: sem segredo não há como
      // VERIFICAR o que entra; sem transporte não há como ENVIAR o que sai.
      const temSegredo = segredoDeAssinatura().length >= TAMANHO_MINIMO_DE_SEGREDO;
      return temSegredo && transporte().isConfigured();
    },

    verifySignature(raw: Buffer, headers: HeaderBag): boolean {
      const segredo = segredoDeAssinatura();
      if (segredo.length < TAMANHO_MINIMO_DE_SEGREDO) return false;
      const resultado = authenticateWahaWebhook({
        rawBody: raw.toString("utf8"),
        signatureHeader: lerCabecalho(headers, CABECALHO_DE_ASSINATURA),
        sessionSecret: segredo,
      });
      // `ok:true` com `signatureVerified:false` é o caso "não assinou e o
      // ambiente não exige" do herdado. Para ESTE contrato isso não é assinatura
      // verificada — quem decide aceitar evento não assinado é a rota, com o
      // contador na mão, não o adapter dizendo `true` por omissão.
      return resultado.ok && resultado.signatureVerified;
    },

    resolveAccountKey(raw: unknown): string | null {
      return lerAccountKey(raw);
    },

    parseInbound(raw: unknown): ParseInboundResult {
      return parseEnvelopeWaha(raw, { provider: "waha", agora });
    },

    async send(ctx: TenantCtx, msg: OutboundMessage): Promise<{ provider_message_id: string }> {
      // O `organization_id` vem do ctx (D06/D20). Divergência não é escolhida:
      // enviar pelo tenant errado é o defeito que a checagem existe para barrar.
      if (msg.organization_id !== ctx.organization_id) {
        throw new ChannelSendFailed("waha", "tenant_mismatch");
      }

      const chave = chaveDoMemo(ctx.organization_id, msg.idempotency_key);
      const jaEnviado = memo.get(chave);
      if (jaEnviado !== undefined) return { provider_message_id: jaEnviado };

      const accountKey = msg.account_key ?? null;
      if (accountKey === null || accountKey.length === 0) {
        throw new ChannelSendFailed("waha", "account_key_ausente");
      }

      const herdado = transporte();
      const destino = herdado.resolveRecipient({
        isGroup: false,
        groupChatId: null,
        phoneNumber: msg.to_e164,
        waIdentity: null,
      });
      if (destino === null) throw new ChannelSendFailed("waha", "destinatario_irresolvivel");

      const { externalId } = await herdado.send({
        organizationId: ctx.organization_id,
        sessionRef: accountKey,
        to: destino,
        kind: "text",
        body: msg.body,
      });
      // `externalId: null` colapsa "canal não configurado" e "resposta sem id".
      // O contrato SaaS não tem esse desfecho mudo: vira erro com o código que o
      // próprio adapter herdado declara.
      if (externalId === null) throw new ChannelSendFailed("waha", herdado.codes.sendFailed);

      memo.set(chave, externalId);
      return { provider_message_id: externalId };
    },

    async fetchMedia(ctx: TenantCtx, ref: string): Promise<ReadableStream> {
      const herdado = transporte();
      if (typeof herdado.fetchInboundMedia !== "function") {
        // Sem download no herdado não se inventa um: um `fetch` escrito aqui
        // ignoraria a assinatura e o host próprio que cada canal usa.
        throw new ChannelMediaUnavailable("waha", "sem_download_no_adapter_herdado");
      }
      const { accountKey, endereco } = partirRefDeMidia(ref);
      const baixada = await herdado.fetchInboundMedia({
        organizationId: ctx.organization_id,
        sessionRef: accountKey,
        url: endereco,
        hintMime: null,
      });
      if (baixada.buffer.byteLength === 0) {
        throw new ChannelMediaUnavailable("waha", "download_sem_bytes");
      }
      return new Blob([new Uint8Array(baixada.buffer)]).stream();
    },
  };
}

/** A instância que a aplicação usa. A prova cria a sua com dublês. */
export const wahaSaasAdapter: SaasChannelAdapter = criarAdapterWahaSaas();
