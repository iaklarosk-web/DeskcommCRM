/**
 * F03-T02 — o contrato de canal de §5.7 (ADR-017), medido nos DOIS adapters.
 *
 * A tabela `CASOS` é a prova: os mesmos seis casos rodam contra `waha` e contra
 * `mock`, sem uma linha duplicada. Dois testes copiados divergiriam na primeira
 * vez que alguém mexesse num só — e o que esta suíte afirma é justamente que os
 * dois adapters se comportam IGUAL, que é o que autoriza o `verify.sh` a forçar
 * o modo mock (D12) e ainda assim provar o caminho real.
 *
 * Nenhum dos casos toca rede nem Postgres: o `send` do WAHA roda contra um
 * transporte dublê e o do mock contra um pool falso que imita o índice único de
 * `mock_outbox` (o índice de verdade é medido em
 * `tests/invariants/f03-t02-mock-outbox.test.ts`, que é onde ele existe).
 *
 * As contagens impressas no fim são CALCULADAS a partir da tabela e do número
 * de adapters; escrever "12" aqui seria uma asserção sobre o que se lembra.
 */
import { createHmac } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  criarAdapterMock,
  criarAdapterWahaSaas,
  foiRejeitado,
  INBOUND_EVENT_FIELDS,
  REJECT_REASONS,
  type RejectReason,
  type SaasChannelAdapter,
  type SaasChannelProvider,
} from "@/src/channels";
import type { ChannelAdapter } from "@/lib/channels/types";
import { counterValue, resetCounters } from "@/src/obs/counters";
import type { TenantCtx } from "@/src/tenant-context";

const RAIZ = process.cwd();
const PASTA_DE_FIXTURES = path.join(RAIZ, "tests/fixtures/waha/2026.7.2");

/** Fictício e com folga sobre o piso de 16 do herdado. Não é credencial. */
const SEGREDO_DE_TESTE = "f03-t02-segredo-ficticio-de-prova";
const ORG_ID = "f0300002-0000-4000-8000-000000000001";
const CONVERSA_ID = "f0300002-1000-4000-8000-000000000001";
const CONTA_DA_FIXTURE = "f03-sessao-ficticia";
const ID_DO_TRANSPORTE = "3EB0F03SAIDA001";

const ctx: TenantCtx = { organization_id: ORG_ID, source: "webhook" };

function lerFixture(nome: string): Buffer {
  return readFileSync(path.join(PASTA_DE_FIXTURES, nome));
}

function comAssinatura(assinatura: string): Record<string, string> {
  return { "X-Webhook-Hmac": assinatura };
}

/**
 * O caminho que a rota da F03-T03 vai percorrer, em miniatura: só parseia o que
 * a assinatura aprovou. É o que torna "não produz evento" mensurável em vez de
 * ser uma frase sobre intenção.
 */
function ingerir(adapter: SaasChannelAdapter, raw: Buffer, headers: Record<string, string>) {
  if (!adapter.verifySignature(raw, headers)) return { verificado: false, eventos: 0 };
  const resultado = adapter.parseInbound(JSON.parse(raw.toString("utf8")));
  return {
    verificado: true,
    eventos: foiRejeitado(resultado) ? 0 : resultado.events.length,
  };
}

/** Transporte dublê do WAHA: conta os envios e nunca abre socket. */
function transporteDuble(): { adapter: ChannelAdapter; chamadas: () => number } {
  let chamadas = 0;
  const adapter = {
    provider: "waha",
    resolveRecipient: (input: { phoneNumber?: string | null }) =>
      input.phoneNumber ? `${input.phoneNumber.replace(/\D/g, "")}@c.us` : null,
    isConfigured: () => true,
    send: async () => {
      chamadas += 1;
      return { externalId: ID_DO_TRANSPORTE };
    },
    codes: { notConfigured: "waha_not_configured", sendFailed: "waha_error", unknownError: "waha_unknown" },
  } as unknown as ChannelAdapter;
  return { adapter, chamadas: () => chamadas };
}

/**
 * Pool falso do mock, com o índice único imitado: a segunda linha do mesmo par
 * `(organization_id, idempotency_key)` não entra, que é o que `on conflict do
 * nothing` faz no banco de verdade.
 */
function poolFalso(): { pool: never; linhas: () => number } {
  const gravadas = new Set<string>();
  const client = {
    query: async (texto: string, valores?: unknown[]) => {
      if (texto.includes("insert into public.mock_outbox")) {
        const chave = `${String(valores?.[0])}:${String(valores?.[4])}`;
        if (gravadas.has(chave)) return { rows: [], rowCount: 0 };
        gravadas.add(chave);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    },
    release: () => {},
  };
  return {
    pool: { connect: async () => client } as never,
    linhas: () => gravadas.size,
  };
}

/** Um adapter pronto para um caso, com o medidor do efeito que o envio produz. */
interface Aparelho {
  adapter: SaasChannelAdapter;
  /** Quantas mensagens de fato SAÍRAM — o número que a idempotência trava. */
  efeitos: () => number;
}

interface Sujeito {
  nome: SaasChannelProvider;
  criar(): Aparelho;
  criarSemSegredo(): SaasChannelAdapter;
  /** A assinatura que ESTE canal considera válida (algoritmos diferentes). */
  assinar(raw: Buffer): string;
}

const SUJEITOS: readonly Sujeito[] = [
  {
    nome: "waha",
    criar(): Aparelho {
      const transporte = transporteDuble();
      return {
        adapter: criarAdapterWahaSaas({
          segredoDeAssinatura: () => SEGREDO_DE_TESTE,
          transporte: () => transporte.adapter,
        }),
        efeitos: transporte.chamadas,
      };
    },
    criarSemSegredo(): SaasChannelAdapter {
      const transporte = transporteDuble();
      return criarAdapterWahaSaas({
        segredoDeAssinatura: () => "",
        transporte: () => transporte.adapter,
      });
    },
    assinar: (raw) => `sha512=${createHmac("sha512", SEGREDO_DE_TESTE).update(raw).digest("hex")}`,
  },
  {
    nome: "mock",
    criar(): Aparelho {
      const banco = poolFalso();
      return {
        adapter: criarAdapterMock({
          segredoDeAssinatura: () => SEGREDO_DE_TESTE,
          pool: banco.pool,
        }),
        efeitos: banco.linhas,
      };
    },
    criarSemSegredo(): SaasChannelAdapter {
      return criarAdapterMock({ segredoDeAssinatura: () => "", pool: poolFalso().pool });
    },
    assinar: (raw) => `sha256=${createHmac("sha256", SEGREDO_DE_TESTE).update(raw).digest("hex")}`,
  },
];

interface CasoDoContrato {
  nome: string;
  executar(sujeito: Sujeito): Promise<void>;
}

const CASOS: readonly CasoDoContrato[] = [
  {
    nome: "assinatura válida devolve true e o payload vira evento",
    async executar(sujeito) {
      // Arrange
      const { adapter } = sujeito.criar();
      const raw = lerFixture("message-texto.json");

      // Act
      const resultado = ingerir(adapter, raw, comAssinatura(sujeito.assinar(raw)));

      // Assert
      expect(resultado.verificado, "assinatura correta foi recusada").toBe(true);
      expect(resultado.eventos, "assinatura válida não produziu evento").toBe(1);
    },
  },
  {
    nome: "assinatura inválida devolve false e não produz evento",
    async executar(sujeito) {
      // Arrange — mesmo tamanho da válida, um nibble trocado: o que se mede é a
      // comparação, não um erro de formato.
      const { adapter } = sujeito.criar();
      const raw = lerFixture("message-texto.json");
      const valida = sujeito.assinar(raw);
      const adulterada = valida.slice(0, -1) + (valida.endsWith("0") ? "1" : "0");

      // Act
      const resultado = ingerir(adapter, raw, comAssinatura(adulterada));

      // Assert
      expect(resultado.verificado, "assinatura errada foi aceita").toBe(false);
      expect(resultado.eventos, "assinatura errada produziu evento").toBe(0);
    },
  },
  {
    nome: "sem segredo configurado isConfigured() é falso",
    async executar(sujeito) {
      // Arrange
      const semSegredo = sujeito.criarSemSegredo();
      const { adapter: comSegredo } = sujeito.criar();

      // Act + Assert — quem responde 503 é a rota (G-27); o adapter só declara.
      expect(semSegredo.isConfigured(), "adapter sem segredo se declarou pronto").toBe(false);
      expect(comSegredo.isConfigured(), "adapter com segredo se declarou despreparado").toBe(true);
    },
  },
  {
    nome: "resolveAccountKey devolve a chave da conta do envelope",
    async executar(sujeito) {
      // Arrange
      const { adapter } = sujeito.criar();
      const envelope = JSON.parse(lerFixture("message-texto.json").toString("utf8"));

      // Act
      const conta = adapter.resolveAccountKey(envelope);

      // Assert
      expect(conta, "a conta do envelope não foi resolvida").toBe(CONTA_DA_FIXTURE);
      expect(adapter.resolveAccountKey({ nada: true }), "conta inventada de payload alheio").toBeNull();
    },
  },
  {
    nome: "parseInbound grava só a allowlist e conta o campo desconhecido",
    async executar(sujeito) {
      // Arrange
      const { adapter } = sujeito.criar();
      const envelope = JSON.parse(
        lerFixture("message-campo-desconhecido.json").toString("utf8"),
      );

      // Act
      const resultado = adapter.parseInbound(envelope);

      // Assert
      expect(foiRejeitado(resultado), "fixture catalogada foi rejeitada").toBe(false);
      if (foiRejeitado(resultado)) return;
      expect(resultado.events).toHaveLength(1);
      const evento = resultado.events[0]!;
      expect(
        Object.keys(evento).sort(),
        "parseInbound copiou campo fora da allowlist do InboundEvent",
      ).toEqual([...INBOUND_EVENT_FIELDS].sort());
      expect(
        JSON.stringify(evento),
        "parseInbound copiou campo fora da allowlist do InboundEvent (valor vazou no evento)",
      ).not.toContain("campoQueNinguemCatalogou");
      expect(resultado.unknownFields, "campo fora do catálogo não foi contado (G-42)").toEqual({
        campoQueNinguemCatalogou: 1,
      });
      expect(
        counterValue("unknown_fields", { name: "campoQueNinguemCatalogou" }),
        "o contador nomeado de §5.17 não registrou o campo desconhecido",
      ).toBe(1);
    },
  },
  {
    nome: "send devolve provider_message_id e é idempotente por idempotency_key",
    async executar(sujeito) {
      // Arrange
      const { adapter, efeitos } = sujeito.criar();
      const msg = {
        organization_id: ORG_ID,
        conversation_id: CONVERSA_ID,
        to_e164: "+5511900000001",
        body: "confirmação do pedido",
        idempotency_key: "f03-t02-envio-001",
        account_key: CONTA_DA_FIXTURE,
      };

      // Act — o MESMO envio, duas vezes, como um retry faria.
      const primeiro = await adapter.send(ctx, msg);
      const segundo = await adapter.send(ctx, msg);

      // Assert
      expect(primeiro.provider_message_id.length, "envio sem provider_message_id").toBeGreaterThan(0);
      expect(segundo.provider_message_id, "a mesma chave devolveu id diferente").toBe(
        primeiro.provider_message_id,
      );
      expect(efeitos(), "a segunda tentativa duplicou o envio").toBe(1);
    },
  },
];

let aprovados = 0;

describe("F03-T02 — o contrato de §5.7 vale igual nos dois adapters", () => {
  beforeEach(() => {
    resetCounters();
  });

  for (const sujeito of SUJEITOS) {
    describe(`adapter ${sujeito.nome}`, () => {
      for (const caso of CASOS) {
        it(caso.nome, async () => {
          await caso.executar(sujeito);
          aprovados += 1;
        });
      }
    });
  }

  afterAll(() => {
    const total = SUJEITOS.length * CASOS.length;
    console.info(
      `channel-adapter-contract: adapters=${SUJEITOS.length} cases=${CASOS.length} ` +
        `pass=${aprovados}/${total}`,
    );
  });
});

/**
 * A pasta INTEIRA de fixtures atravessa o parser. Cada arquivo termina de um dos
 * dois jeitos declarados — evento ou `Rejected` com motivo do enum. Exceção e
 * descarte mudo são o que este caso existe para tornar impossível: foi assim que
 * a ingestão herdada devolvia 200 para payload que ela nunca leu.
 */
describe("F03-T02 — nenhuma fixture some em silêncio", () => {
  /** O motivo que cada fixture de recusa documenta no README da pasta. */
  const RECUSAS_ESPERADAS: Record<string, RejectReason> = {
    "message-grupo.json": "group_chat",
    "message-lid-sem-telefone.json": "lid_without_pn",
  };

  it("toda fixture da pasta vira evento ou Rejected com motivo do enum", () => {
    // Arrange — N vem da PASTA, nunca de um número escrito aqui.
    const arquivos = readdirSync(PASTA_DE_FIXTURES)
      .filter((nome) => nome.endsWith(".json"))
      .sort();
    let lidas = 0;
    const recusas: Record<string, RejectReason> = {};

    // Act
    for (const nome of arquivos) {
      const envelope = JSON.parse(lerFixture(nome).toString("utf8"));
      const porAdapter = SUJEITOS.map((sujeito) => sujeito.criar().adapter.parseInbound(envelope));
      const classificacoes = porAdapter.map((resultado) =>
        foiRejeitado(resultado) ? `rejected:${resultado.reason}` : `events:${resultado.events.length}`,
      );

      // Assert — os dois adapters leem o MESMO formato, então classificam igual.
      expect(new Set(classificacoes).size, `adapters divergiram em ${nome}`).toBe(1);

      const resultado = porAdapter[0]!;
      if (foiRejeitado(resultado)) {
        expect(REJECT_REASONS, `motivo fora do enum em ${nome}`).toContain(resultado.reason);
        recusas[nome] = resultado.reason;
      } else {
        expect(resultado.events.length, `fixture sem evento e sem recusa: ${nome}`).toBe(1);
      }
      lidas += 1;
    }

    // Assert
    expect(lidas, "fixture da pasta ficou sem passar pelo parser").toBe(arquivos.length);
    expect(recusas, "as recusas medidas não são as que o README da pasta declara").toEqual(
      RECUSAS_ESPERADAS,
    );
    console.info(`channel-adapter-contract: fixtures=${arquivos.length} parsed=${lidas}`);
  });
});
