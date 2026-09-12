/**
 * O adapter de `WHATSAPP_MODE=mock` (D12, ADR-017 decisão 1).
 *
 * Existe para que NENHUMA mensagem saia para pessoa real durante a construção e
 * o `verify.sh`, sem que o caminho de saída fique sem prova: em vez de falar com
 * um transporte, ele grava a linha em `public.mock_outbox` dentro de
 * `withTenant(ctx)` — mesma disciplina de tenant de todo o resto (§5.1, D20).
 *
 * Por que um adapter SEPARADO e não uma variável dentro do WAHA: esconder o modo
 * mock dentro do caminho real faria a prova medir um `if`, e não um contrato. Os
 * dois adapters existirem é o que a prova `channel-adapter-contract:
 * adapters=2 cases=6 pass=12/12` mede (ADR-017, alternativa rejeitada).
 *
 * ─── Entrada ───────────────────────────────────────────────────────────────
 *
 * Lê o MESMO envelope do WAHA (`src/channels/inbound-parse.ts`), porque as
 * fixtures de `tests/fixtures/waha/2026.7.2/` são a entrada dele (§5.7). Mesma
 * allowlist, mesmos motivos de recusa: um mock que lesse outro formato provaria
 * o mock, não o produto.
 *
 * ─── Segredo ───────────────────────────────────────────────────────────────
 *
 * `WHATSAPP_MOCK_HMAC_SECRET` (lida aqui, e só aqui). Sem ela `isConfigured()`
 * é falso e a rota responde 503 com contador (G-27). O valor nunca é impresso
 * nem registrado — só o tamanho é consultado.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, resolve, sep } from "node:path";

import { withTenant, type TenantCtx } from "@/src/tenant-context";
import type { ServicePool } from "@/src/tenant-context/db";

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

/** Mesmo cabeçalho do canal real — o mock imita o fio, não inventa outro. */
const CABECALHO_DE_ASSINATURA = "x-webhook-hmac";

/** Espelho de `MIN_SECRET_LEN` (`lib/waha/webhook-auth.ts:37`). */
const TAMANHO_MINIMO_DE_SEGREDO = 16;

/** O acervo de mídia do mock: a pasta de fixtures. Nunca a rede. */
const FIXTURES_PADRAO = "tests/fixtures/waha/2026.7.2";

export interface AdapterMockDeps {
  /** Só o TAMANHO é consultado; o valor nunca é registrado. */
  segredoDeAssinatura?: () => string;
  agora?: Relogio;
  /** Pool injetável — a prova unitária nunca abre Postgres. */
  pool?: ServicePool;
  /** Raiz do acervo de mídia; a prova aponta para a pasta que quiser. */
  diretorioDeFixtures?: string;
}

/**
 * O id determinístico do envio.
 *
 * Mesma `idempotency_key` no mesmo tenant ⇒ mesmo id, sempre — é o que faz o
 * reenvio ser reconhecível em vez de virar uma segunda mensagem. O tenant entra
 * na derivação porque `mock_outbox` é única por `(organization_id,
 * idempotency_key)`: derivar só da chave faria duas organizações que usassem a
 * mesma string receber o MESMO id de mensagem, e id de mensagem é o que a
 * F03-T06 usa para casar status.
 */
export function idDeterministicoDoMock(organizationId: string, idempotencyKey: string): string {
  const digest = createHash("sha256")
    .update(`${organizationId}:${idempotencyKey}`, "utf8")
    .digest("hex");
  return `mock_${digest.slice(0, 32)}`;
}

/** Comparação de tamanho fixo — `timingSafeEqual` recusa buffers desiguais. */
function assinaturaConfere(esperado: string, recebido: string): boolean {
  if (recebido.length !== esperado.length) return false;
  try {
    return timingSafeEqual(Buffer.from(recebido, "hex"), Buffer.from(esperado, "hex"));
  } catch {
    return false;
  }
}

export function criarAdapterMock(deps: AdapterMockDeps = {}): SaasChannelAdapter {
  const segredoDeAssinatura =
    deps.segredoDeAssinatura ?? (() => (process.env.WHATSAPP_MOCK_HMAC_SECRET ?? "").trim());
  const agora = deps.agora ?? (() => new Date());
  const diretorioDeFixtures = deps.diretorioDeFixtures ?? FIXTURES_PADRAO;

  return {
    provider: "mock",

    isConfigured(): boolean {
      return segredoDeAssinatura().length >= TAMANHO_MINIMO_DE_SEGREDO;
    },

    verifySignature(raw: Buffer, headers: HeaderBag): boolean {
      const segredo = segredoDeAssinatura();
      if (segredo.length < TAMANHO_MINIMO_DE_SEGREDO) return false;
      const cabecalho = lerCabecalho(headers, CABECALHO_DE_ASSINATURA);
      if (cabecalho === null) return false;
      const esperado = createHmac("sha256", segredo).update(raw).digest("hex");
      return assinaturaConfere(esperado, cabecalho.replace(/^sha256=/i, "").trim());
    },

    resolveAccountKey(raw: unknown): string | null {
      return lerAccountKey(raw);
    },

    parseInbound(raw: unknown): ParseInboundResult {
      return parseEnvelopeWaha(raw, { provider: "mock", agora });
    },

    async send(ctx: TenantCtx, msg: OutboundMessage): Promise<{ provider_message_id: string }> {
      if (msg.organization_id !== ctx.organization_id) {
        throw new ChannelSendFailed("mock", "tenant_mismatch");
      }

      const providerMessageId = idDeterministicoDoMock(
        ctx.organization_id,
        msg.idempotency_key,
      );

      await withTenant(
        ctx,
        async (db) => {
          // `do nothing` e não `do update`: o mock não duplica NEM reescreve. A
          // segunda escrita da mesma chave é um reenvio, e reenvio que altera a
          // linha original apagaria a evidência do primeiro envio.
          await db.query(
            `insert into public.mock_outbox
               (organization_id, conversation_id, to_e164, body, idempotency_key)
             values ($1::uuid, $2::uuid, $3::text, $4::text, $5::text)
             on conflict (organization_id, idempotency_key) do nothing`,
            [
              ctx.organization_id,
              msg.conversation_id,
              msg.to_e164,
              msg.body,
              msg.idempotency_key,
            ],
          );
        },
        { pool: deps.pool },
      );

      return { provider_message_id: providerMessageId };
    },

    async fetchMedia(_ctx: TenantCtx, ref: string): Promise<ReadableStream> {
      const { endereco } = partirRefDeMidia(ref);
      // `basename` antes de resolver, e conferência da raiz depois: o ref pode
      // vir de payload, e payload é entrada de fora. `../` aqui leria arquivo do
      // repositório inteiro.
      const arquivo = resolve(diretorioDeFixtures, basename(endereco));
      const raiz = resolve(diretorioDeFixtures) + sep;
      if (!arquivo.startsWith(raiz)) {
        throw new ChannelMediaUnavailable("mock", "ref_fora_do_acervo");
      }
      let bytes: Buffer;
      try {
        bytes = readFileSync(arquivo);
      } catch {
        // Sem rede e sem invenção: o que não está no acervo não existe.
        throw new ChannelMediaUnavailable("mock", "fixture_ausente");
      }
      return new Blob([new Uint8Array(bytes)]).stream();
    },
  };
}

/** A instância que a aplicação usa. A prova cria a sua com dublês. */
export const mockAdapter: SaasChannelAdapter = criarAdapterMock();
