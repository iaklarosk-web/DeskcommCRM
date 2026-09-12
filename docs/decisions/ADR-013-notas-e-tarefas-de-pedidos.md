# ADR-013 — Notas humanas e tarefas vinculadas a pedidos

## Contexto

A F02-T03 precisa registrar trabalho e histórico do cliente/pedido sem criar
um lead fictício. A v1.17.0 já tem `crm_tasks`, escrita REST e atividades de
negócios. Tarefas legadas podem ser excluídas fisicamente; usar esse fluxo para
uma tarefa com journal descartaria a rastreabilidade do pedido. Notas de
memória da IA e notas de conversa têm finalidades diferentes das notas humanas
desse contexto. A construção está autorizada por D45/ADR-011.

## Decisão

Reaproveitar `crm_tasks`, acrescentando vínculo opcional ao pedido e revisão.
Tarefas sem pedido preservam seu fluxo legado. Tarefas vinculadas usam o
serviço transacional novo: criação, edição e mudança de situação geram um
recibo privado e um evento único. Cancelar substitui a exclusão física nesse
contexto. A tarefa pode ser reaberta por comando autorizado; a máquina de
estados comerciais do pedido não é aplicada à tarefa.

O vínculo de tarefa ao pedido/contato é fixo e validado por chaves compostas
com a organização. Não existe atribuição automática de responsável. Quando
informado, o responsável precisa ser membro aceito, não revogado e com
permissão operacional na mesma empresa. A alteração da tarefa não muda a
revisão comercial do pedido.

Três policies restritivas impedem que o JWT crie, edite ou exclua tarefas
vinculadas pela tabela. PATCH/DELETE legados recusam esses registros
explicitamente; a interface direciona sua gestão ao pedido. A leitura continua
autorizada. A adaptação também fecha escrita de suporte somente leitura na
tabela legada, respeitando o contrato já existente de suporte.

`crm_notes` guarda notas humanas append-only de um contato, com pedido
opcional. O ID fornecido pelo cliente permite repetir a mesma gravação sem
duplicá-la. Reuso com conteúdo, vínculo ou ator diferentes é conflito. O
serviço valida a autoria; o cliente não recebe INSERT/UPDATE/DELETE direto.
A própria nota é o registro canônico, sem uma cópia em um journal paralelo.

O núcleo de autorização humana passa a ser compartilhado pelo CRM, com
permissões explícitas `orders.write`, `orders.confirm`, `tasks.create` e
`notes.create`. A exportação antiga de pedidos permanece compatível. Sessão,
identidade do ator, organização ativa e membership são reconferidos na
transação, antes do replay. A posição de administrador da plataforma não se
transforma em autoridade operacional. As APIs novas recusam escrita em
acompanhamento de suporte, inclusive full, enquanto esse executor não fizer
parte do TenantContext.

Tarefas usam a ordem de bloqueios contato → chave do comando → recibo →
tarefa. Revisão vencida e chave reutilizada com dados diferentes retornam
conflito. Recibos devolvem apenas identidade/revisão/situação; seu hash é
privado. O journal registra ator, instante, revisão e situação, sem copiar
título/descrição. Nota nova ou comando de tarefa novo também gera auditoria
na mesma transação, sem texto pessoal; replay não a duplica.

A anonimização participa da transação de contato por trigger privado e
redige o corpo da nota, preservando identidade técnica e autoria. Replay de
nota redigida retorna 410. Tarefas conservam a anonimização legada e o serviço
recusa novas alterações de conteúdo em contato anonimizado. Exportação e
ficha do cliente precisam incluir as novas fontes, com organização e vínculo
explícitos; a timeline de negócios é preservada e sua origem continua visível.

O upgrade precisa tratar duas lacunas anteriores sem descartar tarefa. A 0210
aceitava um `contact_id` global, portanto uma linha legada podia atravessar a
organização e impedir a FK composta da 9008 de ser validada. A migration
pré-requisito 9009 roda imediatamente antes da 9008: bloqueia escrita, redige o
texto se o contato antigo já estiver anonimizado, audita apenas IDs, motivo e
campos tocados, e desvincula somente esses casos. A segunda aplicação não cria
novo reparo ou audit. O rótulo 9009 é um forward-fix; seu timestamp anterior é
a dependência explícita para instalações que ainda não aplicaram a 9008.

No baseline idempotente, esse vínculo tem um único ponto canônico de
reconstrução: o bloco 9009 saneia os dados, cria e valida
`crm_tasks_contact_tenant_fkey`; o bloco 9008 pressupõe essa pós-condição e não
a declara novamente. Isso não reescreve as migrations aplicadas: ambas
preservam suas guardas históricas. Os dois apêndices precedem a varredura final
de privilégios de `anon`, que continua sendo o último bloco do baseline.

A redação antiga reagia apenas à transição inicial de anonimização. Para que
uma escrita tardia não recoloque texto pessoal, um trigger privado de tarefa
trava o contato com `FOR SHARE` e mantém título e descrição redigidos quando o
contato já está anonimizado. A ordem oposta entre uma atualização legada e o
trigger de anonimização pode provocar detecção de deadlock pelo PostgreSQL; a
vítima perde a transação inteira. A prova de concorrência exige o estado final
fechado: ou a anonimização não confirmou, ou confirmou com todo texto redigido.

O histórico é apresentado por origem: atividades de negócios continuam na
timeline herdada, pedidos no histórico comercial, notas em sua lista cronológica
e eventos de tarefas no painel reutilizado entre contato e pedido. Os leitores
existentes conservam autorização e cursores; não se grava um espelho em lead.
Uma edição de tarefa identifica ocorrência, autor e revisão, sem prometer
uma comparação de títulos/descrições anteriores que o journal não guarda.

## Alternativas rejeitadas

Duplicar todas as tarefas criaria duas listas concorrentes. Tornar o journal
obrigatório para toda tarefa legada mudaria contratos além da F02. Permitir
DELETE de tarefa vinculada ou CASCADE do journal nessa exclusão apagaria sua
rastreabilidade. Tratar notas de IA/conversa como notas humanas misturaria
autoria e finalidade. Consultar recibos ou notas apenas pelo ID sob service
role carregaria dados fora do escopo, mesmo se fossem recusados depois.

## Consequências e provas

A migration é aditiva e precisa passar por instalação/reaplicação, ACL com
privilégios padrão amplos, RLS entre duas empresas, vínculos cruzados,
concorrência, repetição, revisão vencida, rollback e anonimização/exportação.
A exclusão da organização descartável deve ser comprovada com tarefa,
recibo, evento e nota, mantendo a compatibilidade do SET NULL legado de
contato. Leituras novas usam paginação por data/ID, sem apresentar erro como
lista vazia nem truncamento silencioso como lista completa.

Esta decisão não conclui a T03 ou a F02. Provas preparatórias em banco
descartável e arquivos externos ao worktree são identificados como tal;
somente código promovido e validado entra no BUILD-STATE da construção.

## Data e commit

2026-09-09. Continuação técnica da ADR-012 sobre a branch
`codex/f02-crm-pedidos`. O commit desta decisão será identificado por
`git log -1 -- docs/decisions/ADR-013-notas-e-tarefas-de-pedidos.md` após sua
promoção; nenhum hash futuro é presumido.
