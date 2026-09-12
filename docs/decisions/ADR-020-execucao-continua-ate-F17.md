# ADR-020 — Execução contínua até F17, sem a pausa por fase de D47

## Contexto

D47 (09/09/2026) mandava pausar ao concluir cada fase e esperar nova mensagem do
proprietário, para administrar o limite semanal da assinatura. Em 11/09/2026 o
proprietário determinou o oposto: seguir até concluir a F17, decidir sozinho o
que antes seria perguntado e entregar, ao final, o que foi resolvido e o que
faltou, mais uma varredura de melhorias.

Isso obriga a separar três coisas que o pedido junta:

1. **O que é escolha técnica** — nome de arquivo, forma de teste, estrutura
   interna, escolha entre libs já presentes (AGENTS §8). Sempre foi do agente.
2. **O que D47 tornava pergunta por cautela de consumo** — seguir para a fase
   seguinte. É exatamente o que esta decisão devolve ao agente.
3. **O que nunca foi de consumo, e sim de consequência externa** — D11/D12/D13:
   produção, mensagem real a pessoa, número real da Deka, restore sobre dados
   reais, custo novo, gateway de pagamento, preço/plano/nome da plataforma.
   Nada disso é preferência; são atos com efeito fora do repositório.

## Decisão

1. A pausa por fase de D47 fica suspensa. O agente encadeia as fases sem
   aguardar mensagem, e o BUILD-STATE continua sendo atualizado a cada
   fechamento para que a retomada por outra sessão siga possível.
2. **D11–D13 continuam valendo na íntegra.** "Assumir o mais recomendado" se
   aplica a decisões de engenharia, não a deploy, dinheiro, número real ou
   mensagem a pessoa. Cada um desses vira **pendência declarada** no
   BUILD-STATE e na entrega final, com o que exatamente falta e de quem é.
3. A ordem executável passa a ser **F03 → F04 → F05 → F06 → F07 → F11 → F12 →
   F13 → F14 → F15 → F16 → F17**. F08 (serviços reais), F09 (piloto Deka) e F10
   (segunda empresa real) ficam fora dessa cadeia porque dependem de
   credencial, autorização e operação real. Não é invenção desta ADR: §7.9 já
   escreve que "F09/F10 são marcos de acompanhamento e validação de mercado …
   não bloqueiam a engenharia de F11–F17".
4. A condição de parada de §8.4 (F07 em staging com `BLOCKER-PROD` aberto)
   deixa de encerrar o trabalho e passa a ser marco intermediário, com o bloco
   `VERIFY SUMMARY` colado no BUILD-STATE como sempre.
5. Fase cuja prova dependa de provedor real fecha com mock e a marcação
   `NOT VALIDATED (real)` (D12), nunca com prova simulada apresentada como real.
6. Ao fim, o agente entrega uma varredura de melhorias e correções **como
   lista**, sem aplicá-la: aplicar achado novo sem pedido seria ampliar escopo
   no mesmo movimento em que se declara o fim.

## Alternativas rejeitadas

- **Tratar "vá até F17" como autorização implícita de produção, gasto e
  mensagem real.** O proprietário suspendeu uma cautela de CONSUMO; ler nisso a
  suspensão das cautelas de CONSEQUÊNCIA transformaria uma instrução de ritmo em
  autorização de deploy e de fatura. D11 existe para exatamente isso.
- **Parar em F07 alegando §8.4.** §8.4 descrevia a condição de parada sob D47;
  com D49 ela vira marco. Parar ali seria entregar menos do que foi pedido
  escudando-se num texto que a decisão nova revisou.
- **Executar F08–F10 com dublês e declará-las concluídas.** Seriam fases de
  operação real fechadas sem operação real — a evidência fabricada que D24 e
  §8.5 nomeiam.
- **Aplicar a varredura final junto com a entrega.** Achado novo aplicado sem
  revisão do proprietário é escopo crescendo depois do "pronto".

## Consequências

O BUILD-STATE passa a registrar, a cada fase, também o que ficou `NOT VALIDATED
(real)` e por quê, para que a lista final de pendências seja somatório
verificável e não memória. `BLOCKER-PROD` permanece aberto. As fases F08–F10
ficam explicitamente fora do que esta execução pode declarar pronto, e o aceite
comercial de F17 (§7.9, "aceite da versão pelo proprietário") continua sendo
ato humano: o agente entrega a engenharia e as provas, não o aceite.

A capacidade real de uma sessão não é ilimitada. Se a execução terminar antes
de F17, o BUILD-STATE e a entrega final dizem em que fase parou, com que
evidência, e qual é a próxima task — sem declarar pronta nenhuma fase que não
tenha `STATUS: READY (Fnn)` do verificador.

## Data

2026-09-11

## Commit

O commit que adiciona este arquivo
(`git log --format=%h -1 -- docs/decisions/ADR-020-execucao-continua-ate-F17.md`).
