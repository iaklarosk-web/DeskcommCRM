#!/usr/bin/env bash
# F07-T03 (ADR-029 §3, VARREDURA §B13), G-38: o loader do seed grava os blocos
# `products`/`customers`/`faq`. A mutação devolve o loader ao estado da F01 —
# o laço de produtos itera sobre uma lista vazia — e o tenant nasce sem
# catálogo sem que nada lance. Tem de deixar "escreverBlocosDoSeed grava
# products/customers com seed=N banco=N e é idempotente por id" vermelho em
# tests/integration/f07-t03-seed-blocks.test.ts.
#
# Mecânica: mutação em MEMÓRIA (plugin de transform) sobre a suíte de
# INTEGRAÇÃO; nenhum arquivo é tocado. O caso do CLI (subprocesso) não vê o
# transform — por isso a suíte tem o caso em processo.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

exec node tests/mutants/f04-turno-mutante.mjs \
  --arquivo "scripts/seed-blocks.ts" \
  --de 'for (const p of seed.products) {' \
  --para 'for (const p of [] as typeof seed.products) { /* MUTANTE: bloco pulado, como na F01 */' \
  --suite "tests/integration/f07-t03-seed-blocks.test.ts" \
  --titulo "escreverBlocosDoSeed grava products/customers com seed=N banco=N e é idempotente por id" \
  --espera "products: seed=1 banco=0" \
  --nome "f07-loader-pula-blocos-do-seed"
