/**
 * F05-T05 — o invariante de §5.16, medido no texto do produto:
 *
 *   `grep -rn "from('notifications')" src/ | grep -v src/notifications/` = 0
 *
 * A grafia da DIRETRIZ é a do cliente Supabase JS; este produto escreve por
 * SQL parametrizado (§5.1), então a varredura cobre AS DUAS formas — o
 * `.from('notifications')` e o `public.notifications` em string de SQL — e a
 * irmã `email_outbox`. O denominador é o número de arquivos varridos, lido da
 * árvore em tempo de teste (G-26).
 *
 * Também confere que o enum do TypeScript e o CHECK da migration 9021 listam os
 * MESMOS eventos (seis de §5.16 + três da cobrança, 9023): um evento acrescentado num lado só seria recusado pelo
 * banco na primeira vez que alguém o usasse — em produção, não aqui.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { EVENTOS_DE_NOTIFICACAO, TEXTO_DO_EMAIL, preencher } from "@/src/notifications/eventos";

const RAIZ = process.cwd();
const SRC = path.join(RAIZ, "src");
const MIGRATION = path.join(
  RAIZ,
  "supabase/migrations/20260912010000_9021_notificacoes_por_usuario_e_email_mock.sql",
);
/**
 * F12-T01 (9023) reconstruiu os dois CHECKs por ADIÇÃO (três eventos da
 * assinatura). O que vale é a ÚLTIMA definição de cada CHECK na cadeia: o enum
 * do TypeScript tem de bater com ela, e ela tem de conter tudo o que a 9021
 * listou (tests/unit/migrations-nao-encolhem-vocabulario cobre o "não encolhe").
 */
const MIGRATION_9023 = path.join(RAIZ, "supabase/migrations/20260913160000_9023_planos_assinaturas_e_cobranca_mock.sql");

function arquivosTs(dir: string, achados: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = path.join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivosTs(caminho, achados);
    else if (/\.tsx?$/.test(nome)) achados.push(caminho);
  }
  return achados;
}

const PADROES = [
  /from\(['"]notifications['"]\)/,
  /from\(['"]email_outbox['"]\)/,
  /public\.notifications\b/,
  /public\.email_outbox\b/,
];

describe("F05-T05 — ninguém fora de src/notifications toca as tabelas de aviso (§5.16)", () => {
  it("grep das duas tabelas fora de src/notifications = 0, com denominador", () => {
    // Arrange
    const todos = arquivosTs(SRC);
    const foraDoModulo = todos.filter(
      (arquivo) => !arquivo.startsWith(path.join(SRC, "notifications") + path.sep),
    );
    expect(foraDoModulo.length, "a varredura não achou arquivo nenhum em src/").toBeGreaterThan(50);

    // Act
    const acertos: string[] = [];
    for (const arquivo of foraDoModulo) {
      const texto = readFileSync(arquivo, "utf8");
      for (const padrao of PADROES) {
        if (padrao.test(texto)) acertos.push(`${path.relative(RAIZ, arquivo)} :: ${padrao.source}`);
      }
    }
    // Guarda de vacuidade: DENTRO do módulo o padrão de SQL tem de aparecer,
    // senão a varredura mede um padrão que ninguém escreve.
    const dentro = arquivosTs(path.join(SRC, "notifications")).filter((arquivo) =>
      /public\.notifications\b/.test(readFileSync(arquivo, "utf8")),
    );

    // Assert
    expect(acertos, "chamador de notifications/email_outbox fora de src/notifications").toEqual([]);
    expect(dentro.length, "src/notifications não escreve em public.notifications — varredura vácua").toBeGreaterThan(0);
    console.info(
      `f05-t05-grep: hits=${acertos.length}/0 arquivos_varridos=${foraDoModulo.length} padroes=${PADROES.length} dentro_do_modulo=${dentro.length}`,
    );
  });

  it("o enum do TypeScript e a ÚLTIMA definição do CHECK na cadeia (9023) listam os mesmos nove eventos; a 9021 está contida", () => {
    // Arrange — a 9021 criou os CHECKs com seis; a 9023 os recriou com nove.
    const re = /constraint (notifications|email_outbox)_event_check\s+check \(event in \(([\s\S]*?)\)\)/g;
    const na9021 = [...readFileSync(MIGRATION, "utf8").matchAll(re)];
    const na9023 = [...readFileSync(MIGRATION_9023, "utf8").matchAll(re)];
    expect(na9021.length, "a 9021 não tem os dois CHECKs de evento").toBe(2);
    expect(na9023.length, "a 9023 não recria os dois CHECKs de evento").toBe(2);
    const valoresDe = (corpo: string) => [...corpo.matchAll(/'([a-z_.]+)'/g)].map((m) => m[1]!).sort();

    // Act + Assert — a última definição contém exatamente o enum, e tudo da 9021.
    let contidos = 0;
    for (const [, tabela, corpo] of na9023) {
      const valores = valoresDe(corpo!);
      expect(valores, `${tabela}_event_check (9023) diverge do enum`).toEqual([...EVENTOS_DE_NOTIFICACAO].sort());
      const antigos = valoresDe(na9021.find((m) => m[1] === tabela)![2]!);
      for (const v of antigos) {
        expect(valores, `${tabela}_event_check (9023) perdeu ${v} da 9021`).toContain(v);
        contidos += 1;
      }
    }
    expect(Object.keys(TEXTO_DO_EMAIL).sort()).toEqual([...EVENTOS_DE_NOTIFICACAO].sort());
    console.info(`f05-t05-enum-x-check: tabelas=2/2 eventos=${EVENTOS_DE_NOTIFICACAO.length}/9 da_9021_contidos=${contidos}/12`);
  });

  it("o template de e-mail lê o payload e denuncia campo ausente com `?`", () => {
    expect(preencher("job {{job_id}} falhou {{attempts}}x", { job_id: "j1", attempts: 3 })).toBe(
      "job j1 falhou 3x",
    );
    expect(preencher("conversa {{conversation_id}}", {})).toBe("conversa ?");
  });
});
