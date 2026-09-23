import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * A linha `prod:` tem de citar o commit que ESTÁ RODANDO, não o da árvore.
 *
 * INCIDENTE que este arquivo trava (22/09/2026): `prova.sh` gravava
 * `SHA=$(git rev-parse --short HEAD)`. Rodada com a árvore em `e5f11e33` e a
 * imagem de produção construída em 19/09 (código da F19, `e3c34195`), a linha
 * saiu `sha=e5f11e331` — um commit que nunca foi para a produção. Evidência que
 * mente é pior do que evidência ausente: o BUILD-STATE registraria um deploy que
 * não houve (G-04: "pronto" exige evidência olhada).
 *
 * Conserto: `up.sh` carimba o commit dentro do `standalone/` que vira a imagem
 * (`.prod/app/standalone/COMMIT`), o Dockerfile copia `standalone/` para `/app`
 * e `prova.sh` lê `/app/COMMIT` DE DENTRO do container em execução; sem
 * carimbo, diz `sha=desconhecido`, nunca o da árvore.
 */
/**
 * A raiz é injetável só para o mutante 88: ele copia os três arquivos para um
 * scratch, muta a cópia e roda ESTA suíte contra ela. Sem a variável, lê a
 * árvore — que é o que o gate mede.
 */
const raiz = process.env.F19_T06_RAIZ_DOS_SCRIPTS ?? ".";
const up = readFileSync(`${raiz}/scripts/prod/up.sh`, "utf8");
const prova = readFileSync(`${raiz}/scripts/prod/prova.sh`, "utf8");
const dockerfile = readFileSync(`${raiz}/scripts/staging/Dockerfile.staging`, "utf8");

describe("F19-T06 — o sha da linha prod: vem da imagem em execução", () => {
  it("up.sh carimba o commit dentro do standalone, e o Dockerfile leva esse diretório para /app (cadeia 3/3)", () => {
    expect(up).toMatch(/git rev-parse --short HEAD > \.prod\/app\/standalone\/COMMIT/);
    // A cadeia só fecha se o standalone carimbado for o mesmo que a imagem copia.
    expect(up).toMatch(/cp -r \.next\/standalone \.prod\/app\/standalone/);
    expect(dockerfile).toMatch(/COPY[^\n]*standalone\/ \.\//);
  });

  it("prova.sh lê o carimbo do container e NUNCA usa o HEAD da árvore como sha", () => {
    expect(prova, "prova.sh ainda usa o HEAD da árvore").not.toMatch(/SHA=\$\(git rev-parse/);
    expect(prova).toMatch(/docker (exec|inspect)[^\n]*COMMIT|COMMIT[^\n]*docker (exec|inspect)/);
    expect(prova).toMatch(/desconhecido/);
  });
});
