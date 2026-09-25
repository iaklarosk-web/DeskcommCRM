# ADR-048 — F21: a aba Equipe do `/admin`

**Data:** 2026-09-25 · **Estado:** aceito · **Fase:** F21 · Decisões do proprietário em cards de 25/09 (§3).

## Contexto

Em 24/09 o proprietário abriu o `/admin`, entrou num tenant e perguntou por que
as abas **Equipe** e **Uso** não abriam. Estavam `disabled: true` no código
(`app/admin/(protected)/tenants/[id]/layout.tsx:50-51`), sem rota, sem `page.tsx`
e **sem registro em documento nenhum** — nem BUILD-STATE, nem FINAL-VALIDATION,
nem DIRETRIZ. A decisão dele na hora foi documentar e seguir (BACKLOG §3).

Horas depois a ausência cobrou o preço. Fechado o D60, o proprietário pediu para
sair do `deka-sucos`. **Não havia tela**: a remoção saiu por `DELETE` em `psql`,
direto no banco de produção. Funcionou e foi conferida, mas:

- não gerou linha em `api_audit_log` — a associação sumiu sem rastro no produto;
- a regra "não deixar a organização sem admin" existia só na minha cabeça e na
  conferência manual que fiz antes de apertar o gatilho;
- o caminho depende de um agente com acesso ao banco.

Uma aba desligada não é dívida cosmética quando a função que falta é a que o
dono da plataforma precisa exercer.

## Decisão

### 1. `/admin/tenants/[id]/team` — ler, mudar papel, remover
Lista os membros de qualquer empresa com e-mail, papel e data de aceite. Permite
**mudar papel** e **remover membro**. Toda ação auditada com `organization_id`,
ator e estado anterior.

### 2. NÃO adicionar membro por aqui
Adicionar já é o convite (F20), que é auditado, revogável e exige aceite da
pessoa. Uma segunda porta de entrada seria pior que a ausência da tela.

### 3. Acesso, no padrão de F11/F20
- **Ler:** qualquer `platform_admin`.
- **Escrever:** só escopo `full`, mais `requireSupportWrite` — sessão de
  acompanhamento continua **só leitura** (D51). O que a F21 abre é gestão de
  ACESSO, não operação: o dono da plataforma não vê conversa nem dado de cliente
  por esta tela.

### 4. A organização nunca fica sem admin — recusa dura
Remover ou rebaixar o **último** admin é **recusado no servidor**, com motivo
nomeado (`ultimo_admin`), não com erro genérico. Vale para a tela, para a API e
para qualquer chamador futuro. A tela explica e sugere convidar ou promover
alguém antes.

Escolha do proprietário entre recusar sempre, avisar-e-confirmar, ou recusar só
a remoção: **recusar sempre**. Empresa sem admin não pode existir nem por engano.

### 5. Mudança de papel vale na requisição seguinte
O RBAC lê o papel do banco a cada requisição. Rebaixar alguém com sessão aberta
tem de valer imediatamente, não no próximo login — senão a pessoa segue agindo
como admin depois de rebaixada. Vira teste.

## Consequência

O que hoje exige um agente com `psql` passa a ser tela, com auditoria e com a
regra do último admin imposta por código em vez de por atenção humana.

Fica **fora** desta fase: a aba **Uso**, que segue declarada e desligada.
