# ADR-038 — F14: chat do site, agenda adotada do herdado e IA que marca horário (canais comerciais da primeira versão)

Decisões da F14 que afetam mais de um módulo (AGENTS.md §8). §7.9 manda
decompor a fase em tasks antes de executar; a mensagem do proprietário de
18/09/2026 (retomada depois da F15, D50 c/D54) escolheu a F14 entre F14 /
Stripe + padrão KN do `/admin` / F16 / F17, respondeu sete decisões de
produto em cards e aprovou o brief com as três objeções do `contraponto`
aceitas como testes (§6). As escolhas de produto são dele, registradas como
**D55** em `docs/DIRETRIZ.md` §2. O verificador muda em
[ADR-039](ADR-039-verify-v1.10-F14.md).

## Contexto

O que §7.9 pede da F14 — "jornadas integradas dos canais comerciais e agenda
de clientes/equipe com Google Agenda sincronizada; conexão guiada,
disponibilidade, fuso e conflitos; mensagens e eventos reais isolados por
empresa; criar/alterar/cancelar consistente; reconexão/revogação testadas" —
contra o que a árvore tem em `eac2db65`:

| Existe | Onde | O que falta para a F14 |
|---|---|---|
| Agenda completa herdada: 7 tabelas `calendar_*` (`appointments`, `availability_exceptions`, `connection_calendars`, `connections`, `event_types`, `external_events`, `oauth_nonces`), OAuth Google por MEMBRO (`calendar_connections.user_id`), sincronização em três vias com conflito para humano (`fn_google_resolve`), 3 crons (`agenda-google-{push,refresh,sync}`), 18 rotas `/api/v1/agenda/*`, telas `/app/agenda` e `/app/settings/tenant/agenda` já na navegação (`lib/navigation/catalogo.ts:138,266`), 24 invariantes de banco (`agenda-google-reconciliacao`, `agenda-ida-ao-google-termina`) | `lib/agenda/`, `app/app/agenda`, `app/api/v1/agenda` | nada foi MEDIDO pelo gate do SaaS: as 18 specs herdadas de agenda (6.186 linhas) estão fora do inventário e duas pulam sem credencial Google (VARREDURA §B); disponibilidade/fuso/conflito nunca entraram numa linha do bloco; não há ligação com a conversa |
| Conversa, contato e mensagem por canal: `conversations.channel` com CHECK `= 'whatsapp'` (`baseline.sql:1392`), `channel_sessions`/`channel_accounts` com `provider in (waha, meta_cloud, zernio, mock)`, entrada por `recebeEntrada` (`fn_upsert_wa_contact` por telefone), saída pelo caminho único `enviarMensagem` → `entregarSaida` → adapter por `provider` | `src/channels/`, `src/actions/outbound.ts` | um canal SEM telefone, SEM login e SEM transporte externo: sessão do visitante, contato por nome + e-mail/telefone, adapter que "entrega" gravando, endpoint público com freios |
| Turno de IA adiado fora da janela anti-ban (`inbound-turn.ts:1504`), cap diário e warm-up no gate de envio (`before-send.ts:565`) — tudo por `channel_knobs` da sessão do WhatsApp | `lib/agent-engine/pacing/` | no site não há ban: a IA responde 24 h; a janela vale só para o humano (fila de handoff) |
| Catálogo D17 com 13 ações, política por ação (F15), aprovação pendurada na conversa (`pending_actions`) | `src/actions/` | ação `schedule_appointment` (consulta horários livres, propõe, cria pendente) |
| WhatsApp: conexão guiada (wizard F11), `POST /channel-sessions/[id]/reconnect` (suave e `force`), cron `channel-health`, exclusão/arquivamento | `app/api/v1/channel-sessions/`, `app/api/v1/cron/channel-health` | nada de engenharia: reconexão e revogação já existem e só medem algo REAL com transporte real (número, D12-4) |

## Decisão

### 1. Vocabulário e o que NÃO muda

"Chat do site" é um canal do produto (`conversations.channel='webchat'`) no
MESMO modelo de conversa, contato, mensagem, handoff, política e limite dos
outros canais: o atendente o vê no inbox, a IA o atende pelo mesmo turno, a
política por ação (F15) e o limite diário valem nele. O que muda é a
ENTRADA (visitante anônimo por token, sem telefone) e a SAÍDA (adapter
`webchat`, que entrega gravando a mensagem que a página do visitante lê). A
agenda herdada é ADOTADA (D41 fechado pelo proprietário: conexão Google por
membro, sem redesenho); a F14 a expõe no fluxo do CRM, mede e liga à
conversa. **A F14 não toca no WhatsApp**: reconexão/revogação herdadas ficam
NOT VALIDATED (real) até haver número (objeção 3 do contraponto, §6). Nada da
Deka em código (D06). Nenhuma mensagem a pessoa real; Google OAuth real fora
(escolha do proprietário).

### 2. Tasks (critério de saída com denominador)

| Task | Entrega | Critério de saída | Depende de |
|---|---|---|---|
| **F14-T00** | Esta ADR + ADR-039 (verify v1.10) + D55 + branch `feat/F14-canais-e-agenda` a partir de `eac2db65` + **migration 9030** (§3: `webchat` nos CHECKs de `conversations.channel`, `channel_sessions.provider`/`provider_ref`, `channel_accounts.provider`, `messages.provider`; tabela `webchat_sessions` tenant-aware, service-only; apêndice idempotente no baseline + MANIFEST + prova de RLS no mesmo commit) + chaves `webchat.enabled` (bool, default `false`) e `webchat.allowed_origins` (lista, default `[]` = qualquer origem) em `tenant_settings` + mutante 73 + **teste da objeção 1** (§6: as 4 specs herdadas de agenda sem Google, rodadas no sandbox, resultado N/4 na evidência) | `node --test tests/verify/gate.cases.mjs` verde com os casos F14 (168/168); `tests/invariants/f14-t00-webchat-sessions-service-only.test.ts`: RLS 1\|0\|0\|0\|0\|1, `authenticated` negado 8/8, `anon` 4/4, `service_role` lê de volta, os 4 CHECKs aceitam `webchat`; objeção 1: N/4 specs herdadas verdes | F15 fechada (`eac2db65`) |
| **F14-T01** | **Chat do site — servidor**: `src/webchat/` (sessão do visitante: token aleatório, `token_hash` no banco, `last_seen_at`; identificação nome + e-mail/telefone → contato por `fn_upsert_wa_contact`-equivalente para e-mail (`contacts.email_normalized`) ou telefone; conversa `channel='webchat'` na `channel_sessions` `provider='webchat'` da organização — criada sob demanda, uma por organização; mensagem de entrada pelo MESMO `recebeEntrada`-equivalente (`src/webchat/entrada.ts` grava `messages` inbound com `provider='webchat'` e dispara `ai_agent.dispatch_requested`); adapter `webchat` em `src/channels/webchat.ts` (`send` grava `status='sent'`, `provider_message_id = id da mensagem`; sem transporte); rotas PÚBLICAS `POST /api/public/webchat/[slug]/session`, `POST …/identify`, `POST …/messages`, `GET …/messages?after=` (sem login; `withTenant` pela organização do slug; `webchat.enabled=false` → 404); **três freios com número** (objeção 2): por IP 30 sessões/h e 60 mensagens/h; por organização 600 mensagens/h; teto diário de turnos da F15 — e o caso "50 sessões" (`flood_calls_capped`); pacing (janela, warm-up, cap) NÃO se aplica ao `webchat` (`turnoVaiFalarComOLead` continua; a checagem de janela em `inbound-turn.ts` e o `decidePacing` em `before-send.ts` são pulados quando `conversations.channel='webchat'`) | integração: `webchat_sessions=N identified=N/N contacts_created=C/C messages_in=M ai_replies=A/A ai_outside_window=1/1 ip_limited=1/1 org_limited=1/1 flood_calls_capped=1/1 cross_org_denied=1/1` (token da org A não lê nem escreve na org B; sessão de A com slug de B → 404) `roles_denied=D/D` | T00 |
| **F14-T02** | **Chat do site — telas**: página pública `/chat/[slug]` (Next, sem layout do app; `frame-ancestors` por `webchat.allowed_origins`; polling de 3 s; identificação inline antes da 1ª resposta; aviso "fora do horário: a assistente responde agora; um atendente continua a partir das Hh" quando o handoff cai fora da janela); `/embed/[slug].js` (script de uma linha: balão + iframe da página); inbox: conversa `webchat` listada com rótulo do canal, resposta do atendente pelo mesmo `send_message`; handoff fora da janela fica `queued` com `next_human_at` no resumo; tela `/app/settings/tenant/webchat` (`settings.manage`): ligar/desligar, origens, código de embed para copiar | integração: `handoff_queued=1/1`; navegador (T05): visitante conversa → atendente responde no inbox (2 tenants) | T01 |
| **F14-T03** | **Agenda adotada** (D41): ANTES de codar, rodar contra o staging as specs herdadas de agenda que não dependem do Google (`agenda-tela-do-produto`, `agenda-marcar-pela-tela`, `agenda-remarcar-e-cancelar`, `agenda-escopo-da-organizacao`) — objeção 1: se passarem, a task é EXPOR; se não, consertar e registrar; então: `src/agenda/` (fachada SaaS sobre `lib/agenda`: `horariosLivres(ctx, tipo, dia, fuso)`, `marcar`, `remarcar`, `cancelar` — com `withTenant`, auditoria, e a conversa/contato ligados ao `calendar_appointments.metadata`); conflito = `409` com o compromisso que colide; fuso da organização (`organizations.timezone`) e do visitante respeitados; conexão Google por membro pela tela herdada; revogação (`desconectar`) bloqueia publicação e é medida com o dublê do executor (`tests/invariants/agenda-google-reconciliacao` já cobre; a integração da F14 mede pela fachada) | integração: `appointments=P conflicts_blocked=1/1 revoked_blocked=1/1 tz_ok=1/1` (mesmo instante em dois fusos = mesma linha, exibição diferente) | T00; objeção 1 medida |
| **F14-T04** | **IA marca horário**: **catálogo 14** — entrada `schedule_appointment` (executores `ai`+`human`, risco `medium`, `confirmation: by_risk` ⇒ `approve` por D33 sem entrada na política) no MESMO commit da ferramenta (`src/actions/tools/agenda.ts`), para o catálogo nunca listar ação sem executor: entrada `{event_type_id, starts_at, timezone, notes?}`; consulta `horariosLivres`; cria `calendar_appointments` com `status='pending_approval'` ligado à conversa e ao contato; passa pelo caminho único `execute()` → política (`approve` padrão pendura em `pending_actions`; `allow` cria confirmado; `block`/`transfer` como F15); aprovação pelo atendente confirma e dispara o push ao Google (se houver conexão); prompt do turno ganha a ferramenta só quando `webchat.enabled` ou agenda com ao menos 1 tipo ativo | integração: `proposed=Q/Q approved=1/1 denied_by_policy=1/1`; `toolsFor(ctx,"ai")` passa a 10 | T03 |
| **F14-T05** | Spec `tests/e2e/f14-canais-e-agenda.spec.ts` (3 jornadas × 2 tenants + 1 = **7 testes**: visitante → identificação → resposta da IA (mock) → atendente responde no inbox; agenda: marcar pela tela → conflito recusado → remarcar; IA propõe horário → pendência → aprovação; + 1 do painel do dono lendo conversas `webchat` por organização), suíte de integração com a linha `channels:`, mutantes 73–76, i18n espanhol, `e2e.yml`, smoke (+1 passo: sessão de webchat criada e recusada com `webchat.enabled=false`), `demo3` + `from-scratch`, **linha `webchat_real:`** (§4), evidência, BUILD-STATE, FINAL-VALIDATION, RETOMADA, COMECE-AQUI, produção (`up.sh` + `prova.sh` DEPOIS do READY), custo | gate `READY (staging)` com `channels:` medida; `mutants_killed` sobe 4; `demo3:`; `from-scratch:`; `webchat_real: turns=N/N`; `prod: sha=<commit da F14>` | T01–T04 |

### 3. Migration 9030 — o canal `webchat` no schema

- `conversations_channel_check` → `channel in ('whatsapp','webchat')`.
- `channel_sessions_provider_check` e `channel_sessions_provider_ref_check`
  ganham `webchat` (a chave da sessão é `waha_session_name = 'webchat:<org>'`
  — coluna herdada NOT NULL reaproveitada como chave, comentário na coluna;
  renomear a coluna é retrabalho sem ganho, ADR-034 §1).
- `channel_accounts_provider_conhecido` e `messages_provider_conhecido`
  ganham `webchat`.
- Tabela nova **`webchat_sessions`** (tenant-aware): `id`, `organization_id`
  FK, `token_hash text unique` (SHA-256 do token; o token nunca é gravado),
  `contact_id` FK nulo, `conversation_id` FK nulo, `visitor_name`,
  `visitor_contact` (e-mail ou E.164), `ip_hash`, `user_agent`, `page_url`,
  `identified_at`, `last_seen_at`, `created_at`; índice
  `(organization_id, created_at)`. **Service-only** (D35, como
  `notifications`): RLS ligada, zero policies, `revoke all from anon,
  authenticated` — o visitante não tem JWT; só as rotas públicas (service
  pool + `withTenant`) tocam nela. Prova comportamental no mesmo commit.
- Apêndice idempotente em `supabase/baseline.sql`, linha no MANIFEST,
  `PROVA_PROPRIA`.

### 4. A linha `channels:` (o que a fase mede) e a linha `webchat_real:` (fora do bloco)

Gravada pela suíte `tests/integration/f14-canais-e-agenda.test.ts` via
`gravarLinhaDoVerify("channels", …)`:

```
channels: webchat_sessions=N identified=N/N contacts_created=C/C messages_in=M ai_replies=A/A ai_outside_window=1/1 handoff_queued=1/1 ip_limited=1/1 org_limited=1/1 flood_calls_capped=1/1 cross_org_denied=1/1 appointments=P conflicts_blocked=1/1 revoked_blocked=1/1 tz_ok=1/1 proposed=Q/Q approved=1/1 denied_by_policy=1/1 roles_denied=D/D
```

Contrato (ADR-039): `webchat_sessions>=3`; `identified`, `contacts_created`,
`ai_replies`, `proposed` ≥ 1 e iguais ao denominador; `messages_in>=3`;
`appointments>=2`; os `=1/1` exatos; `roles_denied>=2` e igual ao denominador.

**Turnos reais ficam FORA do bloco** (ADR-036 §3): `webchat_real:` é medido
por `scripts/prod/jornada-webchat.ts` na organização do proprietário com o
provedor real, dentro do teto (**≤ 20 turnos `claude-haiku-4-5`**):
`webchat_real: sessions=1/1 identified=1/1 turns=N/N ai_replies=N/N cost_cents=… flood_capped=1/1 cleaned=1/1 at=<data>`
— o visitante é o próprio proprietário; a sessão, o contato e a conversa
de teste são apagados ao fim (`cleaned`).

### 5. Defaults declarados, nunca fato

`webchat.enabled=false` (o chat do site só existe quando a organização
liga); `webchat.allowed_origins=[]` (qualquer origem pode embutir; a
organização restringe); freios fixos em código (30 sessões/h e 60
mensagens/h por IP, 600 mensagens/h por organização) — números declarados,
sem tela na v1; `schedule_appointment=approve`; janela do humano no webchat =
a do pacing da organização (`channel_knobs`); polling de 3 s (sem websocket:
o realtime herdado não é medido nesta bancada, RETOMADA regra 7).

### 6. As objeções do contraponto, como testes

1. **"A agenda herdada dá para adotar"** → T03 começa rodando as 4 specs
   herdadas de agenda sem Google contra o staging; o resultado (N/4) entra
   na evidência ANTES de qualquer código de agenda. Se < 4/4, a T03 vira
   "consertar" e o brief ganha o custo. **Medido na T00 (18/09, 06:04Z, sandbox
   5542x sobre `eac2db65` + 9030): 4/4 specs, 11/11 testes, 1,4 min**
   ([evidência](../migration/evidence/f14-objecao1-agenda-20260918.txt)) — a T03 é EXPOR. A primeira tentativa
   caiu porque a porta 3001 do `webServer` estava ocupada por outro projeto
   desta VPS (`E2E_PORT=3102` resolve).
2. **"Endpoint público com IA 24 h é seguro"** → três freios com número (§2
   T01) + caso de 50 sessões medindo `ai_calls ≤ teto` (`flood_calls_capped`);
   sem os três medidos, `webchat.enabled` fica `false` em produção.
3. **"Três subprodutos cabem em 3–4 gates"** → a T05 de WhatsApp SAIU: não
   media nada além do que o mock já mede; a F14 tem 6 tasks e 2 subprodutos.

## Alternativas rejeitadas

- **Websocket/realtime para o visitante.** O realtime herdado do inbox não
  passa nesta bancada (specs fora do CI); polling de 3 s é medível e basta
  para um chat de site. Realtime é melhoria declarada (FINAL-VALIDATION §8).
- **Widget nativo em CSS no site do cliente.** Superfície de CSS/CSP alheia;
  página hospedada em iframe isola estilo e origem. Escolha do proprietário.
- **Contato só quando o atendente pedir (anônimo total) ou formulário antes
  de escrever.** Escolha do proprietário: anônimo até a 1ª mensagem, depois
  identificação — não perde lead e não cria contato vazio.
- **Janela do WhatsApp valendo para o site.** A janela existe pelo ban; no
  site não há ban. Escolha do proprietário (IA 24 h, humano na janela).
- **Redesenhar a agenda / conexão por organização.** 24 invariantes e 18
  rotas herdadas funcionam; escolha do proprietário: adotar por membro.
- **Tabela de sessões do visitante com RLS por `anon`.** Um visitante não
  tem JWT; policy para `anon` abriria a tabela a qualquer um com a URL.
  Service-only é o padrão D35.
- **Reconexão/revogação do WhatsApp com mock nesta fase.** Mock provando
  mock (objeção 3); as rotas herdadas existem; a prova real depende do número.
- **Google OAuth real na prova.** Exige conta Google do proprietário no
  staging/produção; ele escolheu não autorizar nesta fase — NOT VALIDATED (real).

## Consequências

- `tenant_settings` ganha 2 chaves (`webchat.enabled`, `webchat.allowed_origins`);
  1 migration (9030) com 4 CHECKs alargados e 1 tabela nova service-only.
- Catálogo passa de 13 para 14 (`schedule_appointment`, `ai`+`human`,
  `medium`); `toolsFor(ctx,"ai")` passa de 9 para 10; `automation` continua 7.
- `SaasChannelProvider` ganha `webchat`; `ADAPTERS` passa a 3; a prova
  `channel-adapter-contract` passa a `adapters=3`.
- O turno de IA passa a olhar `conversations.channel` para pular o pacing;
  WhatsApp continua exatamente como antes.
- Gate da F14 = gate da F15 + 1 spec (7 testes × 2 tenants) + 1 suíte de
  integração + 4 mutantes; ≈ 125–135 min com a máquina livre.

## Data

2026-09-18

## Commit

O commit que adiciona este arquivo
(`git log --format=%h -1 -- docs/decisions/ADR-038-F14-chat-do-site-agenda-e-canais.md`).
