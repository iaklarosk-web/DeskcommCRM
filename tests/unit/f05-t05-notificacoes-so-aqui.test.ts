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
 * MESMOS seis eventos: um evento acrescentado num lado só seria recusado pelo
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

  it("o enum do TypeScript e o CHECK da migration listam os mesmos seis eventos", () => {
    // Arrange
    const sql = readFileSync(MIGRATION, "utf8");
    const noCheck = [...sql.matchAll(/constraint (notifications|email_outbox)_event_check check \(event in \(([\s\S]*?)\)\)/g)];
    expect(noCheck.length, "a migration não tem os dois CHECKs de evento").toBe(2);

    // Act + Assert — cada CHECK contém exatamente os seis do enum.
    for (const [, tabela, corpo] of noCheck) {
      const valores = [...corpo!.matchAll(/'([a-z_.]+)'/g)].map((m) => m[1]!).sort();
      expect(valores, `${tabela}_event_check diverge do enum`).toEqual([...EVENTOS_DE_NOTIFICACAO].sort());
    }
    expect(Object.keys(TEXTO_DO_EMAIL).sort()).toEqual([...EVENTOS_DE_NOTIFICACAO].sort());
    console.info(`f05-t05-enum-x-check: tabelas=2/2 eventos=${EVENTOS_DE_NOTIFICACAO.length}/6`);
  });

  it("o template de e-mail lê o payload e denuncia campo ausente com `?`", () => {
    expect(preencher("job {{job_id}} falhou {{attempts}}x", { job_id: "j1", attempts: 3 })).toBe(
      "job j1 falhou 3x",
    );
    expect(preencher("conversa {{conversation_id}}", {})).toBe("conversa ?");
  });
});
