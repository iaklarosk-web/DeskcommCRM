# ADR-006 — Integrar DeskcommCRM v1.17.0 preservando a fundação

## Contexto
Em 08/09/2026, o proprietário autorizou integrar a v1.17.0, revalidar a F01 e revisar o desenho da F02 para pedidos do dia. A fundação está em `960a46907449fcd4a7e773e40016742c25c0a09d`; a release escolhida é `db58c3fb3ef7acbf6ae9d0eaec278cb968958c5d`. O ancestral comum é a v1.16.1 (`c85f7d72eebe33649812fe5cae174b7dd80e0e9f`). O merge textual não basta: baseline, manifest, autorização e verificador têm contratos que mudaram nos dois lados.

## Decisão
1. Integrar a tag fixada em worktree próprio, branch `codex/integracao-v1.17.0`, conservando a história dos dois lados. Commits posteriores à release exigem avaliação separada. Não há deploy nem alteração do banco em uso nesta integração.
2. Preservar as regras CRM-OS em AGENTS, as fixtures F01 e as novas fixtures upstream. Reordenar o apêndice F01 do baseline segundo os timestamps, sem alterar o SQL das migrations já existentes. Reconciliar o manifest e declarar as novas tabelas privadas como `service_only`; provar existência, RLS e privilégios. Preservar a versão aplicada (timestamp) e o conteúdo SQL; a renomeação rastreável dos rótulos legíveis F01, sem mudar esses dois elementos, segue a [ADR-010](ADR-010-rotulos-das-migrations-F01.md).
3. O novo `AuthUser.support` representa acompanhamento temporário, inclusive sem membership real. `fromSession()` da F01 rejeitará esse contexto com `support_session_not_supported` antes de `resolveActiveOrg()`: o `TenantCtx` atual não transporta modo, expiração e identidade da sessão de suporte. As jornadas upstream conservam suas guardas próprias. A adaptação de suporte para os novos módulos será explícita na F11, com auditoria e bloqueio de efeitos em modo somente leitura.
4. Reconciliar o teste de autorização com os handlers delegados da release, conservando provas negativas. Não tratar import solto, rota autenticada sem papel ou aumento da dívida como autorização comprovada.
5. Corrigir a régua de revalidação por ADR-007. Resultado de F01 revalidada não fecha F02; dívida herdada identificada não pode ser apresentada como `READY`. Validar em bancos descartáveis e registrar comandos, contagens, limitações e referência Git no BUILD-STATE.
6. Preservar o motor de IA, handoff e `ServiceBoundary` existentes e adaptar os requisitos do CRM-OS sobre eles. O desenho F02 e as decisões comerciais ficam em ADRs próprios. Deka usará WAHA agora, conforme confirmação do proprietário.

## Alternativas rejeitadas
- Atualizar para `main` sem fixar a release: acrescentaria mudanças ainda não incluídas no pedido de integração.
- Converter suporte em um tenant admin comum: perderia a restrição de escrita e a rastreabilidade da sessão.
- Alterar a versão (timestamp) ou o conteúdo SQL de migrations aplicadas, ou aceitar apenas ausência de conflitos: altera a história instalada ou deixa incompatibilidades sem prova. A troca dos rótulos legíveis autorizada pela ADR-010 preserva ambos e não altera o histórico do banco.
- Reescrever o motor de atendimento: descartaria controles de revisão, demanda e silêncio já disponíveis.

## Consequências
Novos módulos `src/` exigem uma sessão normal com membership; acompanhamento administrativo nesses módulos depende da F11. A injeção de `organization_id` por `withTenant` não elimina o dever de escopo e autorização de cada consulta com service role. A validação local usa mocks e não demonstra WhatsApp, IA, pagamentos nem produção reais. F02 permanece por construir.

## Data
2026-09-08

## Commit
O commit que adiciona este arquivo (`git log --format=%h -1 -- docs/decisions/ADR-006-integracao-v1.17.0.md`).
