/**
 * F04-T01 — o CATÁLOGO é uma tabela, e esta é a régua sobre ela (§5.8, D17/D18).
 *
 * O que este arquivo mede sem banco nenhum: as dez entradas existem com os oito
 * campos, a matriz N × 3 executores bate com o que §5.8 escreve,
 * `toolsFor(ctx,"ai")` devolve exatamente nove, cada entrada tem função de
 * domínio casada com o MESMO objeto de schema, e o diretório das tools não tem
 * SQL livre nem HTTP arbitrário (D18).
 *
 * Nenhum número é escrito à mão: `catalog_total`, `cells` e o denominador da
 * varredura saem do catálogo e do disco em tempo de teste. As duas exceções são
 * deliberadas e estão declaradas abaixo (`ESPERADO_DA_DIRETRIZ`): a tabela de
 * §5.8 copiada do documento, que é o REGISTRO-FONTE contra o qual o código é
 * comparado (G-35). Derivar o esperado do próprio código faria o teste
 * concordar com qualquer coisa que estivesse lá.
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ACTION_CATALOG,
  ACTION_ENTRY_FIELDS,
  ACTION_EXECUTORS,
  ACTION_RISKS,
  findAction,
  nivelDeRisco,
  toolsFor,
  type ActionExecutor,
} from "@/src/actions/catalog";
import { findHandler } from "@/src/actions/tools";

const RAIZ = process.cwd();
const DIR_DAS_TOOLS = "src/actions/tools";

/**
 * A tabela de `docs/DIRETRIZ.md` §5.8 e de `docs/design/F04-ai-agent.md` §2,
 * copiada à mão. É o registro-fonte: o teste compara o CÓDIGO com o DOCUMENTO,
 * não o código consigo mesmo.
 */
const ESPERADO_DA_DIRETRIZ: readonly {
  name: string;
  risk: string;
  executors: readonly ActionExecutor[];
  confirmation: string;
}[] = [
  { name: "get_customer", risk: "low", executors: ["human", "ai", "automation"], confirmation: "none" },
  { name: "search_products", risk: "low", executors: ["human", "ai", "automation"], confirmation: "none" },
  { name: "get_orders", risk: "low", executors: ["human", "ai", "automation"], confirmation: "none" },
  { name: "create_order", risk: "medium", executors: ["human", "ai"], confirmation: "by_risk" },
  { name: "update_order_quantity", risk: "medium", executors: ["human", "ai"], confirmation: "by_risk" },
  { name: "create_task", risk: "low", executors: ["human", "ai", "automation"], confirmation: "none" },
  { name: "transfer_to_human", risk: "low", executors: ["human", "ai"], confirmation: "none" },
  { name: "request_confirmation", risk: "low", executors: ["human", "ai"], confirmation: "none" },
  { name: "send_message", risk: "medium", executors: ["human", "ai", "automation"], confirmation: "none" },
  { name: "resume_ai", risk: "low", executors: ["human"], confirmation: "none" },
];

/** As nove de D18. `resume_ai` (D34) é humana e NÃO está aqui. */
const TOOLS_D18 = ESPERADO_DA_DIRETRIZ.filter((e) => e.name !== "resume_ai").map((e) => e.name);

describe("F04-T01 — as dez entradas, com os oito campos", () => {
  it("o catálogo tem as dez de §5.8, com risco, executores e confirmação do documento", () => {
    // Arrange — o documento.
    const esperado = ESPERADO_DA_DIRETRIZ;

    // Act — o código.
    const observado = ACTION_CATALOG.map((e) => ({
      name: e.name,
      risk: e.risk,
      executors: [...e.executors],
      confirmation: e.confirmation,
    }));

    // Assert — linha a linha, com denominador nos dois lados.
    expect(observado).toEqual(esperado.map((e) => ({ ...e, executors: [...e.executors] })));
    expect(ACTION_CATALOG.length, "o catálogo não tem dez entradas").toBe(esperado.length);

    console.info(`f04-t01-catalogo: catalog_total=${ACTION_CATALOG.length}/${esperado.length}`);
  });

  it("cada entrada traz os OITO campos de §5.8, e `audit` é sempre `always`", () => {
    // Arrange — a lista de campos vem do código-fonte do catálogo, e o número 8
    // do DOCUMENTO: se alguém acrescentar um campo à lista sem que §5.8 mude, a
    // contagem de baixo reprova.
    const campos = ACTION_ENTRY_FIELDS;
    expect(campos.length, "§5.8 nomeia oito campos por entrada").toBe(8);

    // Act
    let preenchidos = 0;
    for (const entrada of ACTION_CATALOG) {
      const registro = entrada as unknown as Record<string, unknown>;
      for (const campo of campos) {
        if (registro[campo] !== undefined && registro[campo] !== null) preenchidos += 1;
      }
      // Assert por entrada — `audit: always` é literal, não booleano.
      expect(entrada.audit, `${entrada.name} sem audit: always`).toBe("always");
      expect(ACTION_RISKS, `${entrada.name} com risco fora da taxonomia`).toContain(entrada.risk);
      expect(
        ["none", "always", "by_risk"],
        `${entrada.name} com confirmação fora do vocabulário`,
      ).toContain(entrada.confirmation);
      expect(entrada.executors.length, `${entrada.name} sem executor nenhum`).toBeGreaterThan(0);
    }

    const total = ACTION_CATALOG.length * campos.length;
    expect(preenchidos, "alguma entrada tem campo de §5.8 vazio").toBe(total);
    console.info(
      `f04-t01-campos: fields=${campos.length}/8 preenchidos=${preenchidos}/${total}`,
    );
  });

  it("`blocked` faz parte da taxonomia e NENHUMA entrada da Fase 1 o usa", () => {
    // Arrange + Act — o valor existe (é ele que nega para todo executor), mas
    // uma entrada `blocked` no catálogo da Fase 1 seria tool que ninguém pode
    // chamar ocupando um dos dez lugares.
    const bloqueadas = ACTION_CATALOG.filter((e) => e.risk === "blocked");

    // Assert
    expect(ACTION_RISKS).toContain("blocked");
    expect(bloqueadas.map((e) => e.name), "entrada `blocked` na Fase 1").toEqual([]);
    expect(nivelDeRisco("blocked"), "a escala de risco não é a ordem de §5.8").toBe(3);
    expect(nivelDeRisco("low") < nivelDeRisco("medium"), "low deveria ser menor que medium").toBe(
      true,
    );
  });
});

describe("F04-T01 — a matriz N × 3 executores (§5.8, invariante 1)", () => {
  it("30 células: 24 permitidas e 6 negadas, derivadas do catálogo", () => {
    // Arrange — o esperado vem do DOCUMENTO, a observação vem do catálogo.
    const esperadoPorNome = new Map(ESPERADO_DA_DIRETRIZ.map((e) => [e.name, e.executors]));

    // Act
    let permitidas = 0;
    const negadas: string[] = [];
    for (const entrada of ACTION_CATALOG) {
      for (const executor of ACTION_EXECUTORS) {
        const podeNoDocumento = esperadoPorNome.get(entrada.name)?.includes(executor) === true;
        const podeNoCodigo = entrada.executors.includes(executor);
        expect(
          podeNoCodigo,
          `${entrada.name} × ${executor}: código diz ${podeNoCodigo}, §5.8 diz ${podeNoDocumento}`,
        ).toBe(podeNoDocumento);
        if (podeNoCodigo) permitidas += 1;
        else negadas.push(`${entrada.name}:${executor}`);
      }
    }

    // Assert
    const celulas = ACTION_CATALOG.length * ACTION_EXECUTORS.length;
    expect(permitidas + negadas.length).toBe(celulas);
    expect(negadas.length, `células negadas: ${negadas.join(", ")}`).toBe(6);
    console.info(
      `f04-t01-matriz: cells=${celulas} allowed=${permitidas} denied=${negadas.length}/6`,
    );
  });

  it("`toolsFor(ctx,\"ai\")` devolve exatamente as nove de D18", () => {
    // Arrange + Act
    const doModelo = toolsFor({}, "ai");

    // Assert — nove, e são as nove certas: contar sem conferir os nomes
    // aprovaria um catálogo que trocasse `resume_ai` por outra coisa.
    expect(doModelo.length, "toolsFor(ai) não devolveu nove").toBe(9);
    expect([...doModelo].map((t) => t.name).sort()).toEqual([...TOOLS_D18].sort());
    expect(
      doModelo.some((t) => t.name === "resume_ai"),
      "`resume_ai` (D34) vazou para o modelo: ela é humana",
    ).toBe(false);

    // O schema viaja como JSON Schema — e campo com default NÃO pode sair como
    // obrigatório, senão o modelo é cobrado por `limit`/`priority`.
    const busca = doModelo.find((t) => t.name === "search_products");
    const obrigatorios = (busca?.input_schema as { required?: string[] }).required ?? [];
    expect(obrigatorios, "`limit` saiu como obrigatório no JSON Schema").toEqual(["query"]);

    // As outras duas listas, para que o filtro por executor não seja acidente.
    const humanas = toolsFor({}, "human").length;
    const automacao = toolsFor({}, "automation").length;
    expect(humanas, "toolsFor(human) devia devolver as dez").toBe(ACTION_CATALOG.length);
    // Cinco: as três leituras, `create_task` e `send_message` — as mesmas que
    // §5.12 precisa para o Job de lembrete.
    expect(automacao, "toolsFor(automation) mudou de tamanho").toBe(5);
    console.info(
      `f04-t01-toolsfor: ai=${doModelo.length}/9 human=${humanas}/10 automation=${automacao}/5`,
    );
  });

  it("nome fora do catálogo devolve `null`, nunca exceção (invariante 4)", () => {
    expect(findAction("drop_database")).toBeNull();
    expect(findHandler("drop_database")).toBeNull();
    expect(findAction("send_message")).not.toBeNull();
  });
});

describe("F04-T01 — cada entrada tem função de domínio, e o schema é o MESMO objeto", () => {
  it("dez entradas, dez handlers, dez schemas idênticos por referência", () => {
    // Arrange + Act — a identidade por REFERÊNCIA é o que autoriza o `as` de
    // `bind()`: `execute()` valida com `entrada.input_schema` e entrega o
    // resultado ao handler sem reparsear.
    let casados = 0;
    for (const entrada of ACTION_CATALOG) {
      const handler = findHandler(entrada.name);
      expect(handler, `${entrada.name} sem função de domínio`).not.toBeNull();
      expect(
        handler?.schema,
        `${entrada.name}: o schema do handler não é o do catálogo`,
      ).toBe(entrada.input_schema);
      casados += 1;
    }

    // Assert
    expect(casados).toBe(ACTION_CATALOG.length);
    console.info(`f04-t01-handlers: casados=${casados}/${ACTION_CATALOG.length}`);
  });
});

describe("F04-T01 — sem SQL livre e sem HTTP arbitrário nas tools (D18)", () => {
  it("a varredura do diretório das tools devolve ZERO, com denominador", () => {
    // Arrange — o denominador: os arquivos que existem para serem varridos.
    // Zero achados sobre zero arquivos seria zero sem significado (G-03).
    const arquivos = readdirSync(path.join(RAIZ, DIR_DAS_TOOLS)).filter((n) => n.endsWith(".ts"));
    expect(arquivos.length, "o diretório das tools está vazio").toBeGreaterThanOrEqual(4);

    // Act — o mesmo comando que a task e a F04-T06 cobram. O padrão é
    // aspeado com ASPAS SIMPLES no shell: a crase de ``sql` `` dentro de aspas
    // duplas viraria substituição de comando, e o `grep` receberia outra coisa.
    const padrao = "fetch(\\|\\.rpc(\\|sql`";
    const varrer = (alvo: string) =>
      execFileSync("bash", ["-c", `grep -rn '${padrao}' ${alvo} | wc -l`], {
        cwd: RAIZ,
        encoding: "utf8",
      }).trim();

    const achados = varrer(DIR_DAS_TOOLS);

    // Assert
    expect(
      achados,
      "há chamada de rede, RPC ou SQL literal dentro de src/actions/tools",
    ).toBe("0");

    // FIXTURE NEGATIVA (G-51): o instrumento tem de PEGAR. Sem ela, um padrão
    // quebrado devolveria 0 para sempre e ninguém notaria. Os três tokens
    // entram por `printf`, não por arquivo — pôr um arquivo-isca no diretório
    // varrido seria plantar exatamente o que a varredura existe para proibir.
    const isca = execFileSync(
      "bash",
      [
        "-c",
        `printf 'a fetch(1)\nb .rpc(2)\nc sql\`3\`\n' | grep -c '${padrao}'`,
      ],
      { cwd: RAIZ, encoding: "utf8" },
    ).trim();
    expect(isca, "o padrão da varredura não pega nem os três tokens que ele nomeia").toBe(
      "3",
    );

    console.info(
      `f04-t01-tools-sql: hits=${achados}/0 arquivos_varridos=${arquivos.length} fixture_negativa=${isca}/3`,
    );
  });
});
