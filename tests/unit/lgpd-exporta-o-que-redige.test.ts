import fs from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * O QUE SE APAGA A PEDIDO DO TITULAR É O QUE SE ENTREGA A PEDIDO DELE.
 *
 * ═══ O defeito que este arquivo fecha ═══
 *
 * A migration 0184 declarou `calendar_appointments` dado pessoal e ligou o
 * trigger de REDAÇÃO. A mesma entrega escreveu
 * `tests/invariants/agenda-lgpd-alcanca.test.ts` — quatro casos, com controle
 * positivo — para provar que a redação alcança a tabela.
 *
 * E ninguém acrescentou a agenda ao EXPORT. O titular exercia o Art. 18 II e
 * recebia um relatório que não mencionava nenhuma consulta que ele marcou.
 *
 * A entrega construiu o gate de UMA metade da LGPD e nenhum da outra. Não foi
 * descuido de quem escreveu: `lib/lgpd/export-collector.ts` não tem lista
 * declarada em lugar nenhum — os blocos são escritos à mão, um a um, e
 * `workers/lgpd-export-worker.ts` se autodescreve como "8-table aggregator"
 * com contagem FIXA no comentário. Tabela nova simplesmente não aparece.
 *
 * ═══ Por que a lista é DERIVADA, e não escrita aqui ═══
 *
 * Uma lista fixa neste arquivo reproduziria o defeito num arquivo a mais: a
 * oitava tabela redigida entraria sem ninguém acrescentá-la aqui, e o teste
 * ficaria verde por não medir. As duas pontas saem da fonte:
 *
 *   redação → toda função do baseline cujo nome case /redact|redigir/, pelos
 *             alvos de `update <tabela> set` no corpo dela
 *   export  → chamadas alcançáveis desde collectExportData, inclusive helpers
 *             locais: `.from(literal)` e FROM/JOIN em `.query(SQL literal)`
 *
 * ═══ O que este teste NÃO prova ═══
 *
 * Que o conteúdo exportado seja suficiente — só que há uma consulta à tabela
 * no grafo estático alcançável. Não prova execução de todos os caminhos, filtros,
 * projeção ou inclusão do resultado no payload; isso exige prova comportamental.
 * Imports dinâmicos, SQL construído em runtime e despacho dinâmico de métodos
 * não ganham cobertura por inferência. Bibliotecas externas não são varridas.
 * E não olha o PDF: `activities` está no payload e não no relatório, o que é
 * legítimo (o worker sobe `data.json` E `report.pdf`, e o JSON leva tudo).
 */

const RAIZ = path.resolve(__dirname, "../..");
const BASELINE = fs.readFileSync(path.join(RAIZ, "supabase/baseline.sql"), "utf8");
const CAMINHO_COLETOR = "lib/lgpd/export-collector.ts";

/** Corpos de função cujo NOME anuncia redação — no dump vêm com identificador entre aspas. */
function corposDeRedacao(): string[] {
  const corpos: string[] = [];
  const abre =
    /create or replace function\s+"?public"?\.\s*"?([a-z_]*(?:redact|redigir)[a-z_]*)"?/gi;
  for (const m of BASELINE.matchAll(abre)) {
    const inicio = m.index ?? 0;
    // O corpo termina no primeiro `$$;` depois da abertura. Os dumps deste repo
    // usam `$$` e `$pub$`; ambos fecham com `$;`.
    const fim = BASELINE.indexOf("$;", inicio);
    corpos.push(BASELINE.slice(inicio, fim === -1 ? BASELINE.length : fim));
  }
  return corpos;
}

function tabelasRedigidas(): string[] {
  const alvos = new Set<string>();
  for (const corpo of corposDeRedacao()) {
    for (const m of corpo.matchAll(/\bupdate\s+(?:"?public"?\.)?"?([a-z_]+)"?\s+set\b/gi)) {
      const t = m[1];
      if (t !== undefined) alvos.add(t);
    }
  }
  return [...alvos].sort();
}

/** Retira comentários e valores SQL sem deixar seu texto fabricar FROM/JOIN. */
function tokensSql(sql: string): string[] {
  let codigo = "";
  for (let i = 0; i < sql.length;) {
    if (sql.startsWith("--", i)) {
      const fim = sql.indexOf("\n", i + 2);
      i = fim < 0 ? sql.length : fim;
      codigo += " ";
    } else if (sql.startsWith("/*", i)) {
      let nivel = 1;
      i += 2;
      while (i < sql.length && nivel > 0) {
        if (sql.startsWith("/*", i)) {
          nivel++;
          i += 2;
        } else if (sql.startsWith("*/", i)) {
          nivel--;
          i += 2;
        } else i++;
      }
      codigo += " ";
    } else if (sql[i] === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "\\" || sql.startsWith("''", i)) i += 2;
        else if (sql[i++] === "'") break;
      }
      codigo += " ";
    } else if (sql[i] === '"') {
      // Aspas duplas são identificadores, não valores; conservar como um token.
      codigo += sql[i++];
      while (i < sql.length) {
        if (sql.startsWith('""', i)) {
          codigo += '""';
          i += 2;
        } else {
          const caractere = sql[i++];
          codigo += caractere;
          if (caractere === '"') break;
        }
      }
    } else {
      const dolar = /^\$(?:[a-z_][a-z0-9_]*)?\$/i.exec(sql.slice(i))?.[0];
      if (dolar) {
        const fim = sql.indexOf(dolar, i + dolar.length);
        i = fim < 0 ? sql.length : fim + dolar.length;
        codigo += " ";
      } else codigo += sql[i++];
    }
  }
  return codigo.match(/"(?:""|[^"])*"|[a-z_][a-z0-9_$]*|[().,]/gi) ?? [];
}

function tabelasNoSql(sql: string): string[] {
  const tokens = tokensSql(sql);
  const nome = (token: string | undefined): string | undefined => {
    if (!token || !/^(?:"|[a-z_])/i.test(token)) return undefined;
    return token.startsWith('"') ? token.slice(1, -1).replaceAll('""', '"') : token.toLowerCase();
  };
  // Uma CTE pode ter o nome de uma tabela redigida sem consultar essa tabela.
  const ctes = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]?.toLowerCase() !== "with") continue;
    let cursor = i + 1;
    if (tokens[cursor]?.toLowerCase() === "recursive") cursor++;
    while (nome(tokens[cursor])) {
      const cte = nome(tokens[cursor++]);
      if (tokens[cursor] === "(") {
        while (cursor < tokens.length && tokens[cursor++] !== ")") {
          /* colunas */
        }
      }
      if (tokens[cursor++]?.toLowerCase() !== "as") break;
      if (tokens[cursor]?.toLowerCase() === "not") cursor++;
      if (tokens[cursor]?.toLowerCase() === "materialized") cursor++;
      if (tokens[cursor++] !== "(") break;
      if (cte) ctes.add(cte);
      let nivel = 1;
      while (cursor < tokens.length && nivel > 0) {
        if (tokens[cursor] === "(") nivel++;
        if (tokens[cursor] === ")") nivel--;
        cursor++;
      }
      if (tokens[cursor++] !== ",") break;
    }
  }
  const tabelas = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    if (!/^(from|join)$/i.test(tokens[i] ?? "")) continue;
    let cursor = i + 1;
    if (tokens[cursor]?.toLowerCase() === "only") cursor++;
    let tabela = nome(tokens[cursor++]);
    let schema: string | undefined;
    if (tokens[cursor] === ".") {
      schema = tabela;
      tabela = nome(tokens[++cursor]);
      cursor++;
    }
    if (
      tabela &&
      tokens[cursor] !== "(" &&
      (!schema || schema === "public") &&
      (schema || !ctes.has(tabela))
    )
      tabelas.add(tabela);
  }
  return [...tabelas];
}

type LeitorDeFonte = (arquivo: string) => string | undefined;
const lerFonte: LeitorDeFonte = (arquivo) => {
  const completo = path.join(RAIZ, arquivo);
  return fs.existsSync(completo) && fs.statSync(completo).isFile()
    ? fs.readFileSync(completo, "utf8")
    : undefined;
};

/** Binder local: distingue alias importado de variável/parâmetro homônimo. */
function tabelasExportadas(entrada = CAMINHO_COLETOR, ler: LeitorDeFonte = lerFonte): string[] {
  const modulos = new Map<string, { fonte: ts.SourceFile; checker: ts.TypeChecker }>();
  const visitados = new Set<ts.Node>();
  const tabelas = new Set<string>();
  function modulo(arquivo: string) {
    const existente = modulos.get(arquivo);
    if (existente) return existente;
    const codigo = ler(arquivo);
    if (codigo === undefined) throw new Error(`Fonte local não encontrada: ${arquivo}`);
    const completo = path.join(RAIZ, arquivo);
    const fonte = ts.createSourceFile(completo, codigo, ts.ScriptTarget.Latest, true);
    // Não carrega libs, node_modules ou a árvore do projeto. Imports são
    // resolvidos abaixo somente quando uma referência executável os alcança.
    const opcoes: ts.CompilerOptions = { noLib: true, noResolve: true };
    const host = ts.createCompilerHost(opcoes);
    host.getSourceFile = (nome) => (nome === completo ? fonte : undefined);
    host.fileExists = (nome) => nome === completo;
    host.readFile = (nome) => (nome === completo ? codigo : undefined);
    const programa = ts.createProgram([completo], opcoes, host);
    const resultado = { fonte, checker: programa.getTypeChecker() };
    modulos.set(arquivo, resultado);
    return resultado;
  }
  function arquivoDe(no: ts.Node): string {
    return path.relative(RAIZ, no.getSourceFile().fileName).split(path.sep).join("/");
  }
  function destino(origem: ts.Node, caminho: string): string | undefined {
    if (!caminho.startsWith("@/") && !caminho.startsWith(".")) return undefined;
    const base = caminho.startsWith("@/")
      ? caminho.slice(2)
      : path.posix.normalize(path.posix.join(path.posix.dirname(arquivoDe(origem)), caminho));
    if (base.startsWith("../")) throw new Error(`Import fora do projeto: ${caminho}`);
    for (const candidato of [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}/index.ts`,
      `${base}/index.tsx`,
    ]) {
      if (ler(candidato) !== undefined) return candidato;
    }
    throw new Error(`Import local não resolvido: ${arquivoDe(origem)} → ${caminho}`);
  }
  function exportado(
    arquivo: string,
    nome: string,
    vistos = new Set<string>(),
  ): ts.Node | undefined {
    const chave = `${arquivo}:${nome}`;
    if (vistos.has(chave)) return undefined;
    vistos.add(chave);
    for (const no of modulo(arquivo).fonte.statements) {
      if (ts.isExportDeclaration(no) && !no.isTypeOnly) {
        const elementos =
          no.exportClause && ts.isNamedExports(no.exportClause) ? no.exportClause.elements : [];
        const item = elementos.find((e) => !e.isTypeOnly && e.name.text === nome);
        if (
          no.moduleSpecifier &&
          ts.isStringLiteral(no.moduleSpecifier) &&
          (item || !no.exportClause)
        ) {
          const proximo = destino(no, no.moduleSpecifier.text);
          const achado = proximo && exportado(proximo, item?.propertyName?.text ?? nome, vistos);
          if (achado) return achado;
        } else if (item) {
          const declaracao =
            modulo(arquivo).checker.getExportSpecifierLocalTargetSymbol(item)?.declarations?.[0];
          if (declaracao && ts.isVariableDeclaration(declaracao) && declaracao.initializer)
            return valor(declaracao.initializer);
          if (declaracao && ts.isFunctionDeclaration(declaracao)) return declaracao;
          if (declaracao && ts.isImportSpecifier(declaracao)) return valor(declaracao.name);
        }
      }
      if (ts.isExportAssignment(no) && nome === "default") return valor(no.expression);
      const mods = ts.canHaveModifiers(no) ? ts.getModifiers(no) : undefined;
      if (!mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
      if (
        ts.isFunctionDeclaration(no) &&
        (no.name?.text === nome ||
          (nome === "default" && mods.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)))
      )
        return no;
      if (ts.isVariableStatement(no)) {
        const declaracao = no.declarationList.declarations.find(
          (d) => ts.isIdentifier(d.name) && d.name.text === nome,
        );
        if (declaracao?.initializer) return valor(declaracao.initializer);
      }
    }
    return undefined;
  }
  function valor(no: ts.Node, vistos = new Set<ts.Node>()): ts.Node | undefined {
    if (vistos.has(no)) return undefined;
    vistos.add(no);
    if (ts.isParenthesizedExpression(no) || ts.isAsExpression(no) || ts.isNonNullExpression(no))
      return valor(no.expression, vistos);
    if (ts.isIdentifier(no)) {
      const declaracao = modulo(arquivoDe(no)).checker.getSymbolAtLocation(no)?.declarations?.[0];
      if (!declaracao) return undefined;
      if (ts.isImportSpecifier(declaracao) || ts.isImportClause(declaracao)) {
        const clausula = ts.isImportClause(declaracao) ? declaracao : declaracao.parent.parent;
        if (clausula.isTypeOnly || (ts.isImportSpecifier(declaracao) && declaracao.isTypeOnly))
          return undefined;
        const importacao = clausula.parent;
        if (!ts.isStringLiteral(importacao.moduleSpecifier)) return undefined;
        const arquivo = destino(importacao, importacao.moduleSpecifier.text);
        const nome = ts.isImportSpecifier(declaracao)
          ? (declaracao.propertyName?.text ?? declaracao.name.text)
          : "default";
        return arquivo ? exportado(arquivo, nome) : undefined;
      }
      if (ts.isVariableDeclaration(declaracao) && declaracao.initializer)
        return valor(declaracao.initializer, vistos);
      if (ts.isFunctionDeclaration(declaracao)) return declaracao;
      return undefined;
    }
    if (ts.isPropertyAccessExpression(no)) {
      if (ts.isIdentifier(no.expression)) {
        const declaracao = modulo(arquivoDe(no)).checker.getSymbolAtLocation(no.expression)
          ?.declarations?.[0];
        if (declaracao && ts.isNamespaceImport(declaracao) && !declaracao.parent.isTypeOnly) {
          const importacao = declaracao.parent.parent;
          if (ts.isStringLiteral(importacao.moduleSpecifier)) {
            const arquivo = destino(importacao, importacao.moduleSpecifier.text);
            return arquivo ? exportado(arquivo, no.name.text) : undefined;
          }
        }
      }
      const objeto = valor(no.expression, vistos);
      if (objeto && ts.isObjectLiteralExpression(objeto)) {
        const membro = objeto.properties.find(
          (p) =>
            p.name &&
            (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) &&
            p.name.text === no.name.text,
        );
        if (membro && ts.isPropertyAssignment(membro)) return valor(membro.initializer, vistos);
        if (membro && ts.isMethodDeclaration(membro)) return membro;
      }
      return undefined;
    }
    return no;
  }
  function literal(no: ts.Node | undefined): string | undefined {
    const resolvido = no && valor(no);
    return resolvido &&
      (ts.isStringLiteral(resolvido) || ts.isNoSubstitutionTemplateLiteral(resolvido))
      ? resolvido.text
      : undefined;
  }
  function executar(no: ts.Node | undefined): void {
    if (!no || visitados.has(no)) return;
    visitados.add(no);
    if (
      ts.isFunctionDeclaration(no) ||
      ts.isArrowFunction(no) ||
      ts.isFunctionExpression(no) ||
      ts.isMethodDeclaration(no)
    ) {
      if (no.body) varrer(no.body);
    }
  }
  function varrer(no: ts.Node): void {
    // Definir uma função não a executa. Callbacks só entram quando passados a
    // uma chamada; uma função irmã abandonada não dá cobertura à exportação.
    if (ts.isFunctionLike(no)) return;
    if (ts.isCallExpression(no)) {
      if (ts.isPropertyAccessExpression(no.expression)) {
        const texto = literal(no.arguments[0]);
        if (no.expression.name.text === "from" && texto && /^[a-z_][a-z0-9_]*$/i.test(texto))
          tabelas.add(texto);
        if (no.expression.name.text === "query" && texto)
          for (const tabela of tabelasNoSql(texto)) tabelas.add(tabela);
      }
      executar(valor(no.expression));
      for (const argumento of no.arguments) executar(valor(argumento));
    }
    ts.forEachChild(no, varrer);
  }
  const inicio = exportado(entrada, "collectExportData");
  if (!inicio) throw new Error(`collectExportData não encontrada em ${entrada}`);
  executar(inicio);
  return [...tabelas].sort();
}

describe("scanner do export LGPD: controles com fontes em memória", () => {
  function escanear(fontes: Record<string, string>): string[] {
    return tabelasExportadas("coletor.ts", (arquivo) => fontes[arquivo]);
  }

  it("reconhece chamadas .from reais, sem contar comentário ou texto com aparência de chamada", () => {
    expect(
      escanear({
        "coletor.ts": `
      // admin.from("so_no_comentario")
      export function collectExportData(admin) {
        const exemplo = 'admin.from("so_no_texto")';
        /* admin.from("outro_comentario") */
        return [admin.from('contatos'), admin.from("tarefas")];
      }
    `,
      }),
    ).toEqual(["contatos", "tarefas"]);
  });

  it("segue alias, reexport local e helper chamado para ler FROM/JOIN SQL", () => {
    expect(
      escanear({
        "coletor.ts": `
        import { coletar as pedidos } from "@/pedidos";
        export function collectExportData(db) { return pedidos(db); }
      `,
        "pedidos/index.ts": 'export { lerPedidos as coletar } from "./export";',
        "pedidos/export.ts": `
        const consulta = 'select * from public.pedidos p join "public"."itens" i on i.pedido_id=p.id';
        function snapshot(db) { return db.query(consulta); }
        export function lerPedidos(db) { return snapshot(db); }
        export function abandonada(db) { return db.query('select * from tabela_desconectada'); }
      `,
      }),
    ).toEqual(["itens", "pedidos"]);
  });

  it("não abre módulo importado mas não usado, import só de tipo ou módulo desconectado", () => {
    const leituras: string[] = [];
    const fontes: Record<string, string> = {
      "coletor.ts": `
        import { pedidos } from "./abandonado";
        import type { Snapshot } from "./somente-tipo";
        export function collectExportData(admin): Snapshot { return admin.from('contatos'); }
      `,
      "abandonado.ts":
        "export function pedidos(db) { return db.query('select * from nova_tabela'); }",
      "desconectado.ts": "export function pedidos(db) { return db.from('nova_tabela'); }",
    };
    expect(
      tabelasExportadas("coletor.ts", (arquivo) => {
        leituras.push(arquivo);
        return fontes[arquivo];
      }),
    ).toEqual(["contatos"]);
    expect([...new Set(leituras)]).toEqual(["coletor.ts"]);
  });

  it("parâmetro homônimo não fabrica chamada ao helper importado", () => {
    expect(
      escanear({
        "coletor.ts": `
        import { pedidos } from "./abandonado";
        export function collectExportData(pedidos) { return pedidos(); }
      `,
        "abandonado.ts": "export function pedidos(db) { return db.from('tabela_errada'); }",
      }),
    ).toEqual([]);
  });

  it("segue callback/alias local, sem executar uma função apenas declarada", () => {
    expect(
      escanear({
        "coletor.ts": `
        import { ler } from './pedidos';
        export function collectExportData(db) {
          function esquecida() { return db.from('fora_do_fluxo'); }
          const callback = ler;
          return comTenant(db, callback);
        }
      `,
        "pedidos.ts": "const ler = (db) => db.query(`select * from snapshots`); export { ler };",
      }),
    ).toEqual(["snapshots"]);
  });

  it("segue import default e namespace sem incluir outra exportação do módulo", () => {
    expect(
      escanear({
        "coletor.ts": `
        import ler from './padrao';
        import * as pedido from './pedidos';
        export function collectExportData(db) { return [ler(db), pedido.itens(db)]; }
      `,
        "padrao.ts": "export default function (db) { return db.from('pedidos'); }",
        "pedidos.ts": `
        const lerItens = (db) => db.query('select * from public.itens');
        export { lerItens as itens };
        export const outra = (db) => db.from('so_importada');
      `,
      }),
    ).toEqual(["itens", "pedidos"]);
  });

  it("SQL não concede cobertura por comentário, valor, função, outro schema ou CTE homônima", () => {
    expect(
      tabelasNoSql(`
      with nova_tabela as (select * from public.origem)
      select 'from coincidencia', 'x'' join outra_coincidencia',
        $$from dolar$$, $tag$join dolar_com_tag$tag$, "from identificador"
      from nova_tabela n
      join /* join apenas_comentario /* from aninhado */ */ "public"."itens" i on true
      -- from comentario_de_linha
      join privado.nova_tabela p on true
      join public.funcao_parecida_com_tabela() f on true
    `),
    ).toEqual(["origem", "itens"]);
  });

  it("tabela nova continua faltando até sua consulta ser conectada, sem mudar lista de exceções", () => {
    const fontes: Record<string, string> = {
      "coletor.ts": `
        import { nova } from './nova';
        export function collectExportData(db) {
          // nova(db); db.from('nova_tabela');
          const descricao = 'select * from nova_tabela';
          return db.from('contatos');
        }
      `,
      "nova.ts":
        "export function nova(db) { return db.query('select * from public.nova_tabela'); }",
    };
    const faltando = () => ["contatos", "nova_tabela"].filter((t) => !escanear(fontes).includes(t));
    expect(faltando()).toEqual(["nova_tabela"]);
    fontes["coletor.ts"] = fontes["coletor.ts"]!.replace(
      "return db.from('contatos');",
      "return [db.from('contatos'), nova(db)];",
    );
    expect(faltando()).toEqual([]);
    // Mutante local: retirar só a consulta deixa a mesma tabela descoberta.
    fontes["nova.ts"] = "export function nova() { return 'select * from public.nova_tabela'; }";
    expect(faltando()).toEqual(["nova_tabela"]);
  });

  it("ciclos de chamadas locais terminam, sem importar funções não chamadas", () => {
    expect(
      escanear({
        "coletor.ts": `
        import { ler } from './a';
        export function collectExportData(db) { return ler(db); }
      `,
        "a.ts": `
        import { continuar } from './b';
        export function ler(db) { db.from('contatos'); return continuar(db); }
      `,
        "b.ts": `
        import { ler } from './a';
        export function continuar(db) { return ler(db); }
        export function esquecida(db) { return db.from('desconectada'); }
      `,
      }),
    ).toEqual(["contatos"]);
  });
});

describe("LGPD: o export alcança tudo que a redação alcança", () => {
  it("CONTROLE: as duas varreduras acham tabela (senão o teste passa medindo o vazio)", () => {
    // Sem isto, um regex que deixe de casar devolve dois conjuntos vazios e a
    // asserção abaixo fica verde — o modo de falha que este repo já pagou várias
    // vezes. E o número tem de ser plausível: a redação move mais que 3 tabelas.
    expect(tabelasRedigidas().length).toBeGreaterThan(3);
    expect(tabelasExportadas().length).toBeGreaterThan(3);
  });

  it("CONTROLE: a varredura da redação enxerga a tabela que o trigger 0184 acrescentou", () => {
    // `calendar_appointments` não é redigida pelo cascade e sim por um trigger
    // separado (0184). Se a sonda só olhasse a função principal, ela sumiria — e
    // o teste passaria justamente sobre o caso que o motivou.
    expect(tabelasRedigidas()).toContain("calendar_appointments");
  });

  it("toda tabela que a redação apaga é visitada pelo export", () => {
    const exportadas = new Set(tabelasExportadas());
    const faltando = tabelasRedigidas().filter((t) => !exportadas.has(t));
    expect(
      faltando,
      "Estas tabelas são redigidas quando o titular pede anonimização e NÃO são " +
        "coletadas quando ele pede acesso (Art. 18 II). O que se apaga a pedido " +
        "dele é o que se entrega a pedido dele — acrescente o bloco em " +
        "`lib/lgpd/export-collector.ts` ou em helper realmente chamado por ele, " +
        "espelhando o de `crm_lead_activities`:\n" +
        faltando.map((f) => `  ${f}`).join("\n"),
    ).toEqual([]);
  });
});
