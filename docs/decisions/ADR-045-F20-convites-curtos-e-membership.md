# ADR-045 — F20: convite curto no banco, ação no `/admin` e membership do criador

Decisões da F20 que afetam mais de um módulo (AGENTS.md §8). As escolhas de
produto são do proprietário: **D59** (link curto, revogação, TTL 7 dias) e
**D60** (o criador do tenant deixa de virar admin permanente quando o convite é
para outra pessoa), com quatro respostas em cards de 23/09/2026 registradas em
§3. O verificador muda em [ADR-046](ADR-046-verify-v1.13-F20.md).

## Contexto

O convite de equipe é um token **stateless**: `issueInvite`
(`lib/auth/issue-invite.ts:48`) assina email + organização + papel +
`interface_settings` + `invited_by` + `iat`/`exp` com HMAC e põe tudo na URL.
Medido em 22/09: **559 caracteres**, e o WhatsApp do proprietário linkifica só
até `/accept-invite/` — a pessoa convidada não consegue clicar (§B27). Sem linha
no banco não há revogação, lista de pendentes, nem como recuperar o link depois
de sair da tela de criação.

O caminho de hoje, medido no código: `/team/accept-invite/[token]` é rota
pública (`lib/auth/public-paths.ts:70`) com teto de 60 tentativas por IP/hora
(`AUTH_LIMITS.invite_accept`), valida com `verifyInviteToken`, e
`acceptInviteAction` (`app/actions/team/acceptInvite.ts:32`) confere o e-mail do
JWT contra o do token e chama o RPC `fn_accept_team_invite`, que é idempotente
(`result.changed`). Nada disso muda de forma: a F20 troca **de onde vem o
payload** (linha em vez de URL) e acrescenta o ciclo de vida que faltava.

`fn_create_tenant_with_owner` insere, sem condição,
`user_organizations(org, p_actor, 'admin', now(), …)` — é a porta lateral de
§B28, e é também o que hoje salva o dono quando ele perde o link (ele entra na
organização e convida de novo). Por isso a ordem de D60 importa.

## Decisão

### 1. Migration 9035 — `team_invites`

Tabela nova, tenant-aware, **service_only** (D35, como as quatro da F12): o id
curto é credencial e não pode ser legível pelo PostgREST com a anon key.

| Coluna | Papel |
|---|---|
| `id uuid pk` | identidade interna |
| `organization_id` | FK `organizations(id) on delete cascade` |
| `token` | **16 chars base64url (96 bits)**, único — é o `<id>` da URL `/i/<token>` |
| `email`, `role`, `interface_settings` | o que o token stateless carregava |
| `invited_by`, `created_at`, `updated_at` | procedência |
| `expires_at` | `now() + 7 dias` (D59 c) |
| `accepted_at`, `accepted_by` | aceite (uma vez só) |
| `revoked_at`, `revoked_by`, `revoked_reason` | revogação (`manual` ou `reenviado`) |

Índice único **parcial** `(organization_id, lower(email)) where accepted_at is
null and revoked_at is null`: um convite VIVO por pessoa por organização — é o
que faz "reenviar revoga o anterior" (§3 b) ser uma garantia do banco, não uma
promessa da aplicação. Prova comportamental de RLS no mesmo commit (dois
tenants, quatro operações, `anon`/`authenticated` negados, `service_role` como
guarda de vacuidade) e entrada em `PROVA_PROPRIA`/MANIFEST.

### 2. Emissão, aceite e compatibilidade

- `issueInvite` grava a linha e devolve `/i/<token>` (**≈ 60 chars**); o e-mail
  do convite leva o mesmo link.
- **Reenviar** cria linha nova e marca a anterior `revoked_at` com
  `revoked_reason='reenviado'` (§3 b): um link vivo por convite; o que vazou
  morre no reenvio.
- **Aceitar**: `/i/<token>` é rota pública, com o MESMO teto por IP do aceite
  atual, e cai no fluxo existente — e-mail do JWT contra e-mail do convite,
  `fn_accept_team_invite`. A migration 9035 estende o RPC por `create or
  replace` com `p_invite uuid default null` (compatível com chamadas antigas):
  quando vem preenchido, a mesma transação cria a membership e marca
  `accepted_at`/`accepted_by`. Sem transação separada não há janela para um
  convite ser aceito duas vezes.
- **Links antigos continuam valendo até expirar** (§3 a): `/team/accept-invite/[token]`
  segue validando token assinado. Um caminho só cria membership (o RPC); a rota
  antiga apenas traduz o token no mesmo `AcceptInviteResult`.

### 3. As quatro respostas do proprietário (cards de 23/09/2026)

(a) convites em voo continuam funcionando até expirar; (b) reenviar **revoga** o
anterior; (c) veem pendentes e revogam: `tenant_admin` e `manager` na própria
organização (matriz da F13), `platform_admin` em qualquer uma pelo `/admin`;
(d) o e-mail do convite entra no ciclo de vida do dado pessoal.

**Adaptação declarada de (d)** — a cascata da LGPD do produto é disparada pela
anonimização de um **contato** (`fn_lgpd_cascade_redact_contact`, gatilho em
`contacts.is_anonymized`), e o invariante que a vigia
(`lgpd-cascata-alcanca-quem-guarda-pessoa`) tem por escopo a interseção "FK para
`contacts`" × "coluna com conteúdo pessoal". Um convidado é pessoa da EQUIPE,
não contato do CRM: `team_invites` não tem FK para `contacts` e a cascata não a
alcança — nem deveria, porque o titular é outro. O equivalente honesto, que a
F20 implementa: **ao aceitar, o e-mail é apagado da linha** (o vínculo passa a
ser `accepted_by`, que é o usuário); **convite revogado ou expirado é apagado**
pelo cron `data-retention` depois de 30 dias. Assim nenhum e-mail de equipe fica
guardado além do que o convite precisa. Se um dia existir anonimização de
USUÁRIO da plataforma (não existe hoje), o gancho é `accepted_by`.

### 4. Telas

- **Equipe do tenant** (`/app/team`): lista de convites pendentes com e-mail,
  papel, quem convidou, quando vence; ações **reenviar** e **revogar** para
  `tenant_admin` e `manager`; o link curto copiável (é o que vai para o
  WhatsApp).
- **`/admin/tenants`**: convites da organização com as mesmas ações, para
  `platform_admin` — é o que destrava o caso "criei o tenant e perdi o link", e
  é pré-requisito de D60.
- **Tela de criação de tenant**: o texto "Se o convite vencer, abra Equipe na
  organização para gerar outro" é substituído por instrução que diz onde
  recuperar o convite (`/admin` → organização → Convites).

### 5. D60 — membership do criador (migration 9036, depois de §4)

`fn_create_tenant_with_owner` passa a inserir a membership do ator **somente
quando `owner_email` é o e-mail dele**. Para outra pessoa, a organização nasce
com a assinatura (`operator`, F11-T03), o convite pendente e **zero membros** —
o acesso do dono da plataforma volta a ser a sessão de suporte só-leitura de
D51, com motivo, escopo e vencimento. **A ordem não se inverte** (D60 b): sem a
ação de convite no `/admin` (§4), um convite que expire sem aceite deixaria a
organização órfã — ninguém entra e o suporte não pode convidar
(`requireSupportWrite` nega `POST /api/v1/team/invite`).

Organizações existentes não mudam (D60 c): `kn-tecnologia`, `deka` e
`deka-sucos` seguem com o proprietário como admin até ele mandar remover.

### 6. Tasks

| Task | Entrega | Critério de saída (número com denominador) |
|---|---|---|
| T00 | ADR-045/046, branch, inventário do caminho do convite, D59/D60 na DIRETRIZ | `gate.cases` verde; nenhuma régua nova vermelha |
| T01 | Migration 9035 + apêndice + MANIFEST + prova de RLS + retenção de convite morto | `9035 aplicada=1/1 colunas=13/13 indice_parcial=1/1 rls_service_only=4/4 retencao=1/1` |
| T02 | Emissão pelo banco, `/i/<token>`, reenviar que revoga, aceite atômico, compatibilidade com o link antigo | `link_len<=64=1/1 aceite=1/1 reenvio_revoga=1/1 duas_aceitacoes=1/1 token_antigo_aceito=1/1 email_apagado_no_aceite=1/1` |
| T03 | Telas de Equipe e `/admin` (listar/reenviar/revogar/copiar) + texto da criação | `pendentes_listados=N/N acoes=3/3 roles_negados=2/2` |
| T04 | D60: migration 9036 + org sem membro na tela do `/admin` | `criador_membro_quando_e_dele=1/1 criador_fora_quando_e_de_outro=1/1 org_sem_membro_mostra_convite=1/1` |
| T05 | Spec `f20-convites` no gate, linha `invites:`, mutantes, gate, `demo3`, `from-scratch`, fechamento | spec × 2 tenants; `mutants_killed=Q/Q`; READY (staging); `prod:` |

## Alternativas rejeitadas

- **Só encurtar o payload do token** (sem tabela): chegaria a ~320 chars, ainda
  quebra no WhatsApp e não traz revogação nem lista de pendentes.
- **Domínio curto próprio** para o link: DNS + certificado são 1-way e custo;
  `/i/<token>` no domínio atual já resolve o tamanho.
- **Guardar o token stateless dentro da linha** (híbrido): duas verdades do
  mesmo convite, sem ganho — quem valida passa a ser a linha.
- **Inverter a ordem de D60** (regra de membership antes da ação no `/admin`):
  cria organização órfã; recusado por D60 (b).

## Consequências

- O link de convite cai de **559 para ~60 caracteres** e passa a ser revogável;
  o que vazou morre no reenvio.
- Passam a existir dois caminhos de aceite por até 7 dias (token antigo e id
  curto) — ambos desembocam no mesmo RPC, e a spec exercita os dois.
- Depois de D60, organização criada para terceiro nasce **sem membro**: a tela
  do `/admin` precisa mostrar "convite pendente" em vez de "0 usuários" sem
  explicação, e o dono da plataforma volta a depender da sessão de suporte.
- `team_invites` guarda e-mail de equipe com prazo: apagado no aceite e expurgado
  30 dias depois quando morre. Nenhum e-mail fica sem dono nem sem prazo.

## Data

2026-09-23.
