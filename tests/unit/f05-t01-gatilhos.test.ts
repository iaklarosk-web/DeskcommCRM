/**
 * F05-T01/T02 — os OITO motivos, os gatilhos determinísticos e a régua dos sete
 * campos, medidos SEM banco (§5.11, D19, G-78).
 *
 * O que precisa de Postgres — os oito gatilhos ponta a ponta, o dossiê gravado,
 * a fila e o claim — está em `tests/integration/f05-handoff.test.ts` e em
 * `tests/invariants/f05-t01-handoff-schema.test.ts`. Aqui o que se mede é a
 * REGRA, e uma regra pura medida com banco em volta é uma regra medida por
 * acidente.
 *
 * ═══ O caso que justifica este arquivo existir ════════════════════════════
 *
 * `src/handoff/gatilhos.ts` COPIA as quatro regex do gatilho herdado
 * (`lib/agent-engine/agent/human-handoff.ts`) em vez de importá-lo — porque
 * aquele módulo puxa o motor inteiro (fronteira de serviço, cron, atividade do
 * lead, cliente Postgres) para dentro do caminho quente do turno SaaS, que §5.9
 * manda manter longe de tudo isso.
 *
 * Cópia sem catraca é divergência com data marcada. A catraca é o caso
 * "concordam frase a frase": um corpus roda pelos DOIS e a concordância tem de
 * ser N/N. No dia em que um lado mudar, este arquivo fica vermelho.
 */
import { describe, expect, it } from "vitest";

import { detectHumanHandoffRequest } from "@/lib/agent-engine/agent/human-handoff";
import { ACTION_CATALOG, toolsFor, type ToolSpec } from "@/src/actions";
import {
  acoesDeRiscoAlto,
  assuntoProibidoDoTenant,
  camposAusentes,
  CAMPOS_DO_RESUMO,
  contaFrases,
  gatilhoDeTexto,
  INTENT_PADRAO,
  MOTIVOS_DE_HANDOFF,
  ORIGEM_DO_MOTIVO,
  pedidoDeAtendenteHumano,
  PORQUE_DO_MOTIVO,
  PROXIMO_PASSO_DO_MOTIVO,
  reclamacaoDetectada,
  resumoDeterministico,
  RISCO_QUE_EXIGE_HUMANO,
  ULTIMAS_MENSAGENS_NO_RESUMO,
  type MensagemDoResumo,
  type ResumoDoHandoff,
} from "@/src/handoff";

/** Os OITO de §5.11 — escritos aqui como AFIRMAÇÃO, não derivados do código. */
const OITO_MOTIVOS = [
  "customer_request",
  "high_risk_action",
  "low_confidence",
  "out_of_knowledge",
  "complaint",
  "provider_error",
  "tenant_rule",
  "forbidden_request",
] as const;

describe("F05-T01 — o enum dos oito motivos", () => {
  it("o enum do código é exatamente a lista de §5.11", () => {
    // Arrange + Act + Assert — os dois sentidos: nada a mais, nada a menos.
    expect([...MOTIVOS_DE_HANDOFF].sort()).toEqual([...OITO_MOTIVOS].sort());
    expect(MOTIVOS_DE_HANDOFF.length, "§5.11 tem oito motivos").toBe(8);
    console.info(`f05-t01-enum: motivos=${MOTIVOS_DE_HANDOFF.length}/8`);
  });

  it("os quatro registros são TOTAIS sobre o enum e nenhum valor é vazio", () => {
    // Arrange — os registros que o dossiê lê. Um `undefined` em qualquer um
    // deles viraria campo vazio no que a pessoa abre para assumir a conversa.
    const registros = {
      ORIGEM_DO_MOTIVO,
      INTENT_PADRAO,
      PORQUE_DO_MOTIVO,
      PROXIMO_PASSO_DO_MOTIVO,
    } as const;

    // Act + Assert
    let cobertos = 0;
    for (const [nome, registro] of Object.entries(registros)) {
      expect(Object.keys(registro).sort(), `${nome} não cobre o enum`).toEqual(
        [...OITO_MOTIVOS].sort(),
      );
      for (const motivo of MOTIVOS_DE_HANDOFF) {
        const valor = (registro as Record<string, string>)[motivo] ?? "";
        expect(valor.trim().length, `${nome}.${motivo} está vazio`).toBeGreaterThan(0);
        cobertos += 1;
      }
    }

    const esperado = Object.keys(registros).length * OITO_MOTIVOS.length;
    expect(cobertos).toBe(esperado);
    console.info(`f05-t01-registros: celulas=${cobertos}/${esperado} vazias=0`);
  });

  it("o resumo determinístico tem ≥1 frase para os oito", () => {
    // Arrange + Act — é o texto que vai para `summary` quando não há melhor.
    const comFrase = MOTIVOS_DE_HANDOFF.filter(
      (motivo) => contaFrases(resumoDeterministico(motivo, "")) >= 1,
    ).length;

    // Assert
    expect(comFrase).toBe(MOTIVOS_DE_HANDOFF.length);
    // E o `intent` vazio NÃO deixa o texto pela metade: cai no padrão do motivo.
    expect(resumoDeterministico("provider_error", "")).toContain(
      INTENT_PADRAO["provider_error"],
    );
    console.info(`f05-t01-resumo: com_frase=${comFrase}/${MOTIVOS_DE_HANDOFF.length}`);
  });

  it("`contaFrases` separa frase de etiqueta", () => {
    // Arrange — a régua de "≥1 frase" de §5.11. Contar palavras aprovaria
    // "erro provedor agora"; o terminador é o que separa frase de rótulo.
    const casos = [
      { texto: "O cliente pediu uma pessoa.", frases: 1 },
      { texto: "Primeira. Segunda! Terceira?", frases: 3 },
      { texto: "provider_error", frases: 0 },
      { texto: "   ", frases: 0 },
      { texto: "sem terminador nenhum aqui", frases: 0 },
    ] as const;

    // Act + Assert
    let certos = 0;
    for (const caso of casos) {
      expect(contaFrases(caso.texto), `contagem errada em "${caso.texto}"`).toBe(caso.frases);
      certos += 1;
    }
    expect(certos).toBe(casos.length);
    console.info(`f05-t01-frases: casos=${certos}/${casos.length}`);
  });
});

/**
 * O corpus da catraca. Cada frase roda pelo gatilho HERDADO e pelo da F05, e as
 * duas respostas têm de ser iguais — inclusive nas negativas, que são o lado que
 * pega o afrouxamento (uma regex mais larga continuaria acertando as positivas).
 */
const CORPUS_DE_PEDIDO_HUMANO = [
  { texto: "quero falar com uma pessoa de verdade agora", pede: true },
  { texto: "queria conversar com um atendente, por favor", pede: true },
  { texto: "me passa pro comercial", pede: true },
  { texto: "prefiro atendimento humano", pede: true },
  { texto: "tem como falar com um responsavel?", pede: true },
  { texto: "me transfere para uma pessoa", pede: true },
  { texto: "voce e uma pessoa de verdade?", pede: true },
  { texto: "qual o prazo de entrega para campinas", pede: false },
  { texto: "quero falar sobre o pedido de sexta", pede: false },
  { texto: "preciso de mais 2kg de cafe", pede: false },
  { texto: "voces atendem aos sabados?", pede: false },
  { texto: "obrigado pelo atendimento, foi otimo", pede: false },
  { texto: "", pede: false },
] as const;

describe("F05-T01 — `customer_request`: o gatilho copiado concorda com o herdado", () => {
  it("as duas implementações decidem igual, frase a frase", () => {
    // Arrange + Act — o MESMO corpus pelos dois.
    let concordam = 0;
    const divergentes: string[] = [];
    for (const caso of CORPUS_DE_PEDIDO_HUMANO) {
      const herdado = detectHumanHandoffRequest(caso.texto);
      const daF05 = pedidoDeAtendenteHumano(caso.texto);
      if (herdado === daF05) concordam += 1;
      else divergentes.push(`${caso.texto} (herdado=${herdado} f05=${daF05})`);
    }

    // Assert — a concordância é a catraca da cópia declarada em gatilhos.ts.
    expect(divergentes, "o gatilho da F05 divergiu do herdado").toEqual([]);
    expect(concordam).toBe(CORPUS_DE_PEDIDO_HUMANO.length);
    console.info(
      `f05-t01-heranca: concordancia=${concordam}/${CORPUS_DE_PEDIDO_HUMANO.length} divergentes=0`,
    );
  });

  it("o corpus tem os dois lados — positivas E negativas", () => {
    // Sem este controle, um corpus só de positivas aprovaria uma função que
    // devolve `true` sempre, e a catraca acima não mediria nada.
    const positivas = CORPUS_DE_PEDIDO_HUMANO.filter((c) => c.pede).length;
    const negativas = CORPUS_DE_PEDIDO_HUMANO.length - positivas;
    expect(positivas).toBeGreaterThanOrEqual(5);
    expect(negativas).toBeGreaterThanOrEqual(5);

    // E o que o corpus AFIRMA é o que as duas devolvem.
    const acertos = CORPUS_DE_PEDIDO_HUMANO.filter(
      (c) => pedidoDeAtendenteHumano(c.texto) === c.pede,
    ).length;
    expect(acertos, "a expectativa do corpus não bate com o detector").toBe(
      CORPUS_DE_PEDIDO_HUMANO.length,
    );
    console.info(
      `f05-t01-corpus: positivas=${positivas} negativas=${negativas} acertos=${acertos}/${CORPUS_DE_PEDIDO_HUMANO.length}`,
    );
  });
});

const CORPUS_DE_RECLAMACAO = [
  { texto: "isso e um absurdo estou muito insatisfeito com o atendimento", reclama: true },
  { texto: "que absurdo, ninguem me responde", reclama: true },
  { texto: "o servico de voces esta pessimo", reclama: true },
  { texto: "isso e inaceitavel", reclama: true },
  { texto: "vou reclamar no procon", reclama: true },
  { texto: "nunca mais compro com voces", reclama: true },
  { texto: "estou insatisfeita com a ultima entrega", reclama: true },
  // O outro lado: fato sem marca de insatisfação continua com a IA.
  { texto: "o prazo atrasou dois dias", reclama: false },
  { texto: "chegou com a caixa amassada, como faco a troca?", reclama: false },
  { texto: "onde eu reclamo de uma entrega errada?", reclama: false },
  { texto: "quero cancelar o item 2 do pedido", reclama: false },
  { texto: "talvez voces consigam me ajudar com uma duvida antiga", reclama: false },
  { texto: "qual o horario de funcionamento de voces", reclama: false },
] as const;

describe("F05-T01 — `complaint`: exige a marca de insatisfação, não o assunto", () => {
  it("acerta as duas metades do corpus", () => {
    // Arrange + Act
    const errados = CORPUS_DE_RECLAMACAO.filter(
      (c) => reclamacaoDetectada(c.texto) !== c.reclama,
    ).map((c) => c.texto);

    // Assert — o lado FALSO é o que importa: sem ele, metade das perguntas de
    // logística viraria handoff e a fila deixaria de significar alguma coisa.
    expect(errados, "o detector de reclamação errou").toEqual([]);
    const positivas = CORPUS_DE_RECLAMACAO.filter((c) => c.reclama).length;
    console.info(
      `f05-t01-reclamacao: casos=${CORPUS_DE_RECLAMACAO.length}/${CORPUS_DE_RECLAMACAO.length} ` +
        `positivas=${positivas} negativas=${CORPUS_DE_RECLAMACAO.length - positivas}`,
    );
  });
});

describe("F05-T01 — `tenant_rule`: a regra é do TENANT", () => {
  it("casa o tópico configurado e ignora o que não é tópico", () => {
    // Arrange — a lista vem de `ai.forbidden_topics` (§5.2), não do produto.
    const topicos = ["Cancelamento de Contrato", "processo judicial"];

    // Act + Assert
    expect(assuntoProibidoDoTenant("quero tratar do cancelamento de contrato", topicos)).toBe(
      "Cancelamento de Contrato",
    );
    // Sem acento e com caixa diferente: a normalização é a mesma do herdado.
    expect(assuntoProibidoDoTenant("PROCESSO JUDICIAL em andamento", topicos)).toBe(
      "processo judicial",
    );
    expect(assuntoProibidoDoTenant("quero 2kg de café", topicos)).toBeNull();
    // Tenant sem tópicos (o default `[]`) nunca dispara.
    expect(assuntoProibidoDoTenant("qualquer coisa", [])).toBeNull();
    expect(assuntoProibidoDoTenant("qualquer coisa", null)).toBeNull();
    // ⚠️ O caso que cala a fila inteira: tópico vazio casaria com TUDO.
    expect(
      assuntoProibidoDoTenant("bom dia", ["", "   "]),
      "tópico em branco mandaria toda conversa do tenant para a fila",
    ).toBeNull();
    console.info("f05-t01-tenant-rule: casos=6/6 topico_vazio_ignorado=1/1");
  });

  it("a ordem da camada: pedido explícito ganha da reclamação e da regra", () => {
    // Arrange — um cliente irritado que pede uma pessoa dispara os três.
    const texto = "isso e um absurdo, quero falar com um atendente sobre o cancelamento";
    const topicos = ["cancelamento"];

    // Act
    const achado = gatilhoDeTexto(texto, topicos);

    // Assert — `customer_request` é o motivo mais fiel ao que ele escreveu: a
    // reclamação é o contexto, o pedido é a ação.
    expect(achado?.motivo).toBe("customer_request");
    expect(gatilhoDeTexto("isso e um absurdo", topicos)?.motivo).toBe("complaint");
    expect(gatilhoDeTexto("falar sobre cancelamento", topicos)?.motivo).toBe("tenant_rule");
    expect(gatilhoDeTexto("bom dia, tudo bem?", topicos)).toBeNull();
    console.info("f05-t01-ordem: casos=4/4");
  });
});

describe("F05-T01 — `high_risk_action`: o risco sai do CATÁLOGO", () => {
  it("as únicas entradas high são as duas da LGPD (F06-T03), humanas — nenhuma chega ao modelo (e isso é DECLARADO)", () => {
    // Arrange + Act — o número que faz o caminho de execução não disparar em
    // produção hoje. Declarar é o contrário de esconder: o dia em que uma
    // Action subir de risco, este caso muda e a mudança fica visível. Foi o
    // que aconteceu na F06-T03: duas ações `high`, ambas só humanas, então o
    // gatilho continua sem disparar para a IA — que nunca as vê.
    const arriscadas = ACTION_CATALOG.filter(
      (entrada) => entrada.risk === "high" || entrada.risk === "blocked",
    ).map((entrada) => entrada.name);

    // Assert
    expect(arriscadas).toEqual(["export_customer_data", "delete_customer_data"]);
    expect(ACTION_CATALOG.filter((e) => arriscadas.includes(e.name)).every((e) => e.executors.length === 1 && e.executors[0] === "human")).toBe(true);
    expect(acoesDeRiscoAlto(toolsFor(null, "ai"), toolsFor(null, "ai"))).toEqual([]);
    console.info(
      `f05-t01-risco: catalogo=${ACTION_CATALOG.length} high_ou_blocked=${arriscadas.length} piso=${RISCO_QUE_EXIGE_HUMANO}`,
    );
  });

  it("com um catálogo que TEM risco alto, a ação pedida é apontada pelo nome", () => {
    // Arrange — catálogo injetado: é a única forma honesta de medir o detector
    // enquanto nenhuma Action de verdade é `high`. Sem ele, a função ficaria
    // "coberta" por um `[]` que não prova nada (G-03).
    const tools: readonly ToolSpec[] = [
      { name: "ler", description: "", input_schema: {}, risk: "low", confirmation: "none" },
      { name: "gravar", description: "", input_schema: {}, risk: "medium", confirmation: "none" },
      { name: "liberar", description: "", input_schema: {}, risk: "high", confirmation: "none" },
      { name: "apagar", description: "", input_schema: {}, risk: "blocked", confirmation: "none" },
    ];

    // Act
    const pedidas = [{ name: "ler" }, { name: "liberar" }, { name: "apagar" }, { name: "sumiu" }];
    const achadas = acoesDeRiscoAlto(pedidas, tools);

    // Assert — `high` e `blocked` entram; `low`/`medium` e nome fora do catálogo
    // ficam de fora (esse último é descartado antes, por `triarToolCalls`).
    expect(achadas).toEqual(["liberar", "apagar"]);
    expect(acoesDeRiscoAlto([{ name: "ler" }, { name: "gravar" }], tools)).toEqual([]);
    console.info(`f05-t01-risco-injetado: apontadas=${achadas.length}/2 baixas_ignoradas=2/2`);
  });
});

const MENSAGEM: MensagemDoResumo = {
  direction: "inbound",
  sent_via: "whatsapp",
  body: "texto ficticio",
  created_at: "2026-09-11T12:00:00.000Z",
};

const RESUMO_COMPLETO: ResumoDoHandoff = {
  customer: "Cliente Fictício",
  intent: "pedido_de_atendimento_humano",
  summary: "O cliente pediu para falar com uma pessoa. Intenção lida: pedido.",
  last_messages: [null, null, MENSAGEM, MENSAGEM, MENSAGEM],
  pending_action: null,
  reason: "customer_request",
  suggested_next_step: "Assuma a conversa e se apresente ao cliente pelo nome.",
};

describe("F05-T02 — a régua dos sete campos", () => {
  it("o resumo completo não tem campo ausente, e são SETE", () => {
    // Arrange + Act + Assert
    expect(camposAusentes(RESUMO_COMPLETO)).toEqual([]);
    expect(CAMPOS_DO_RESUMO.length, "D19 tem sete campos").toBe(7);
    expect([...CAMPOS_DO_RESUMO].sort()).toEqual(
      [
        "customer",
        "intent",
        "last_messages",
        "pending_action",
        "reason",
        "suggested_next_step",
        "summary",
      ].sort(),
    );
    console.info(`f05-t02-campos: campos=${CAMPOS_DO_RESUMO.length}/7 ausentes=0`);
  });

  it("cada campo estragado é apontado — um a um, e só ele", () => {
    // Arrange — a régua só vale se ela PEGA a ausência. Um `camposAusentes` que
    // devolvesse sempre `[]` passaria no caso acima e aprovaria dossiê vazio.
    const sabotagens: ReadonlyArray<{ campo: string; resumo: ResumoDoHandoff }> = [
      { campo: "customer", resumo: { ...RESUMO_COMPLETO, customer: "   " } },
      { campo: "intent", resumo: { ...RESUMO_COMPLETO, intent: "" } },
      { campo: "summary", resumo: { ...RESUMO_COMPLETO, summary: "provider_error" } },
      {
        campo: "last_messages",
        resumo: { ...RESUMO_COMPLETO, last_messages: [MENSAGEM, MENSAGEM] },
      },
      {
        campo: "pending_action",
        resumo: {
          ...RESUMO_COMPLETO,
          pending_action: 42 as unknown as string,
        },
      },
      {
        campo: "reason",
        resumo: { ...RESUMO_COMPLETO, reason: "  " as ResumoDoHandoff["reason"] },
      },
      { campo: "suggested_next_step", resumo: { ...RESUMO_COMPLETO, suggested_next_step: "" } },
    ];

    // Act + Assert
    let pegos = 0;
    for (const sabotagem of sabotagens) {
      expect(
        camposAusentes(sabotagem.resumo),
        `a régua não pegou o campo ${sabotagem.campo} estragado`,
      ).toEqual([sabotagem.campo]);
      pegos += 1;
    }

    expect(pegos).toBe(CAMPOS_DO_RESUMO.length);
    expect(ULTIMAS_MENSAGENS_NO_RESUMO, "§5.11 pede exatamente cinco").toBe(5);
    console.info(
      `f05-t02-regua: campos_sabotados_pegos=${pegos}/${CAMPOS_DO_RESUMO.length} last_messages=${ULTIMAS_MENSAGENS_NO_RESUMO}`,
    );
  });
});
