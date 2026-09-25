# ADR-027 — Hosting do staging: esta VPS, Docker Compose com Supabase local, acesso por Tailscale (D50)

## Contexto

D03 era `[DEFAULT]`: "Docker Compose numa VPS (app Next.js + workers + WAHA +
Redis + Postgres apontando para Supabase gerenciado). Pendência do
proprietário: confirmar antes da Fase F06". §7.7 escreve a pré-condição da F06
como `F05=done`, `hosting_confirmed=yes`, e o BUILD-STATE carregava
`hosting_confirmed: no` desde a F00. A VARREDURA-MELHORIAS §C1 registrou o
portão: a F06 podia ser construída e não podia ser fechada, porque o critério
de saída dela (`STATUS: READY (staging)` rodado DENTRO do staging) exige um
ambiente que só o proprietário podia nomear — e a metade "Supabase gerenciado"
do default é recurso externo com credencial e, dependendo do plano, custo (D11).

Em 11/09/2026 o proprietário decidiu (D50, DIRETRIZ §2):

- **(a)** staging nesta VPS (`srv1958191`) por Docker Compose com **Supabase
  local** (self-hosted; opção C da PENDENCIAS-DONO E8), acesso só por Tailscale.
  Substitui, para o staging, o trecho "Postgres apontando para Supabase
  gerenciado" do default de D03. O critério de saída da F06 vale contra esse
  ambiente. Produção continua decisão separada (D12, D13).
- **(b)** a branch `feat/F03-conversation-inbox` já está no GitHub via SSH; o
  escopo `workflow` do token do `gh` não bloqueia push. O PR é aberto em
  rascunho, sem merge, DEPOIS do READY da F05.
- **(c)** ao fechar a F05 o agente para e aguarda nova mensagem (a pausa de D47
  volta a valer para F05→F06); D49 continua para o que ele decide dentro da fase.

## Decisão

1. `hosting_confirmed: yes` no BUILD-STATE, com a referência a D50 e a esta ADR.
2. **Staging = esta VPS.** Docker Compose com app Next.js, workers (saída,
   lembrete, agent-worker herdado), WAHA, Redis e o Supabase local self-hosted
   (Postgres com `pgvector`, Auth, PostgREST, Storage, Realtime conforme o
   `config.toml` versionado). Nenhum projeto Supabase gerenciado para o staging.
3. **Acesso só por Tailscale.** Nenhuma porta do staging exposta na interface
   pública da VPS; `ufw`/`sshd`/Tailscale continuam portas 1-way do proprietário
   (regras da casa), então a F06 DESCREVE a regra de firewall no runbook e o
   proprietário a aplica — o agente não mexe em `ufw` sozinho.
4. **O sandbox descartável do gate NÃO é o staging.** `scripts/verify/sandbox.sh`
   (portas 5542x/3102, projeto `f02-crm-cadastros`) continua sendo a máquina de
   desenvolvimento do verificador. O staging da F06 é um segundo Compose, com
   identidade, volumes, segredos (`/srv/secrets/<serviço>.env`) e portas próprios,
   e o `READY (staging)` roda dentro DELE. Chamar o sandbox de staging seria o
   contorno que a VARREDURA §C1 recusa.
5. **Capacidade é limite declarado, não resolvido.** A VPS tem 2 núcleos e
   7,9 GB; o gate da F05 levou 65–90 min e, com outro projeto em paralelo, o
   load average passou de 8. O staging convivendo com o gate e com outros
   projetos é um risco a medir na F06 (memória por container, swap, ordem de
   subida), não a assumir.

## Alternativas rejeitadas

- **Manter "Supabase gerenciado" para o staging.** Exige credencial e
  provavelmente custo (D11: ambos do proprietário) e faria a F06 depender de um
  recurso externo para um ambiente que só o proprietário acessa.
- **Declarar o sandbox do verificador como staging.** Ele é descartável por
  desenho (sobe e cai a cada gate) e não tem os workers, o WAHA nem o Redis do
  produto; fechar a F06 nele seria `READY (staging)` sem staging.
- **Expor o staging por porta pública com autenticação.** Contraria a decisão
  do proprietário (Tailscale) e abre superfície num ambiente com dados fictícios
  mas software real.

## Consequências

- A F06 deixa de estar BLOQUEADA por hosting; continua dependendo da mensagem
  do proprietário para começar (D50 c).
- `compose.staging.yml`, `backup.sh`/`restore.sh`, `smoke.sh` e o runbook da F06
  passam a ter um alvo concreto: esta máquina, Supabase local, Tailscale.
- Produção (domínio, Supabase de produção, número real, e-mail, Sentry,
  `platform_admin`) continua na lista de D12/C3 — nada aqui a autoriza.

## Data

2026-09-11

## Commit

O commit que adiciona este arquivo
(`git log --format=%h -1 -- docs/decisions/ADR-027-hosting-do-staging-nesta-vps.md`).
