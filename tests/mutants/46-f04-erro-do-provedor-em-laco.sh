#!/usr/bin/env bash
# F04-T09, G-38: erro do provedor vira handoff SEM LAÇO DE RETRY (§5.9).
#
# Tentar de novo é o reflexo de todo mundo, e é invisível: a conversa termina no
# MESMO `waiting_human`, com o MESMO item de inbox, e nenhuma tela muda. O que
# muda é a conta — cada falha passa a custar N chamadas, e falhas de provedor
# vêm em rajada, quando ele está pior. Este mutante põe uma segunda tentativa
# engolida dentro do `catch` e exige que `provider_calls=1` fique VERMELHO.
#
# Mecânica: mutação em memória sobre a suíte de integração (ver
# tests/mutants/f04-turno-mutante.mjs). Nenhum arquivo do repositório é tocado.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

DE='    const motivo: MotivoDoHandoff =
      erro instanceof EntitlementDenied ? "tenant_rule" : "provider_error";'

PARA='    try {
      estado.chamadas += 1;
      await chamarModelo(
        ctx,
        "ai.reply",
        {
          system: instrucoesDoSistema(contexto),
          messages: [{ role: "user", content: contextoComoTexto(contexto) }],
          conversationId: pedido.conversation_id,
        },
        {
          pool: deps.pool,
          cfg: deps.cfg,
          registry: registroDoProvedor({
            ...(deps.registry === undefined ? {} : { registry: deps.registry }),
          }),
        },
      );
    } catch {
      /* MUTANTE: a segunda tentativa, engolida como todo retry ingênuo */
    }
    const motivo: MotivoDoHandoff =
      erro instanceof EntitlementDenied ? "tenant_rule" : "provider_error";'

exec node tests/mutants/f04-turno-mutante.mjs \
  --arquivo "src/ai/turno.ts" \
  --de "$DE" \
  --para "$PARA" \
  --suite "tests/integration/f04-t09-erro-do-provedor.test.ts" \
  --titulo "provider-error: handoffs=1/1 provider_calls=1" \
  --espera "o turno chamou o provedor mais de uma vez" \
  --nome "f04-erro-do-provedor-em-laco"
