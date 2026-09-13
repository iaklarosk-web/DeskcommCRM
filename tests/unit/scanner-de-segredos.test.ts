/**
 * F01-T10 — o scanner de segredos (§5.18) está VIVO, provado nas duas
 * direções: árvore limpa passa com a linha da §8.3, e as credenciais FALSAS
 * da fixture negativa são pegas pelo padrão (G-51 — scanner que não pega a
 * própria fixture está morto, e o script sai 1 sozinho nesse caso).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = path.resolve(__dirname, "../..");

function rodar(): { saida: string; exit: number } {
  try {
    const saida = execFileSync("bash", ["scripts/scan-secrets.sh"], {
      cwd: RAIZ,
      encoding: "utf8",
    });
    return { saida, exit: 0 };
  } catch (e) {
    const erro = e as { status?: number; stdout?: string };
    return { saida: erro.stdout ?? "", exit: erro.status ?? 1 };
  }
}

describe("scanner de segredos (scripts/scan-secrets.sh)", () => {
  it("árvore limpa: findings=0, exit 0, e a linha tem a grafia da §8.3", () => {
    const { saida, exit } = rodar();
    expect(exit).toBe(0);
    expect(saida).toMatch(/^secrets: files_scanned=\d+ findings=0$/m);
    const f = Number(/files_scanned=(\d+)/.exec(saida)?.[1]);
    expect(f).toBeGreaterThan(300);
  });

  it("a fixture negativa casa o padrão do scanner — pelo menos 2 credenciais falsas", () => {
    // O padrão vem do PRÓPRIO script (uma fonte só): se alguém o afrouxar a
    // ponto de soltar a fixture, este caso e o exit do script reprovam juntos.
    const script = readFileSync(path.join(RAIZ, "scripts/scan-secrets.sh"), "utf8");
    const padrao = /PADRAO='([^']+)'/.exec(script)?.[1];
    expect(padrao, "PADRAO não encontrado no script").toBeDefined();
    const fixture = readFileSync(
      path.join(RAIZ, "tests/fixtures/secrets/negativa.txt"),
      "utf8",
    );
    const hits = fixture.split("\n").filter((l) => new RegExp(padrao ?? "").test(l));
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });
});
