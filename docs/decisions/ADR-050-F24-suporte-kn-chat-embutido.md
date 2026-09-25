# ADR-050 — F24: Suporte KN — o chat do site embutido nos sistemas da KN

**Data:** 2026-09-25 · **Estado:** proposto (branch `feat/F24-suporte-kn`, sem deploy) · **Fase:** F24 · Pedido do fundador em `Nucleo/operacoes/suporte-kn/README.md` e `Nucleo/operacoes/PARECER-ATENDIMENTO-PROPRIO-20260925.md` (decisões de 25/09/2026).

## Contexto

A KN vai embutir o chat do site (F14, ADR-038) na área logada de cada sistema
dela, uma organização por produto (`suporte-one-desk`, `suporte-pdv-os`,
`suporte-transportes-os`, `suporte-oferta-os`, `suporte-crm-os`). O teste
visual de 25/09 achou três defeitos em produção, e o parecer listou seis
mudanças de produto. Tudo entra em branch, com testes, sem deploy e sem
merge em `main`; o fundador aplica.

## Os três defeitos (vêm primeiro)

**0a — o script de embed apontava para a origem interna.** `GET
/embed/<slug>.js` montava o iframe com `request.nextUrl.origin`, que atrás do
Caddy é `https://0.0.0.0:3000` (o host de escuta do standalone). Em qualquer
site externo o balão aparecia e o clique abria um iframe morto. Correção:
`src/http/origem-publica.ts` — `x-forwarded-proto` + `x-forwarded-host`
(o Caddy sobrescreve o que o cliente mandou), depois `Host` (o Caddy o passa
adiante), depois `NEXT_PUBLIC_APP_URL`, e só por último a URL interna; host
de escuta e host malformado são ignorados. A mesma função dá o link direto e
o código de embed da tela `/app/settings/tenant/webchat`. Varredura: era o
ÚNICO uso de `nextUrl.origin` para URL absoluta; convites (`/i/<token>`),
e-mails, OAuth e Stripe já usam `env.NEXT_PUBLIC_APP_URL`.
Secundário: `/chat/<slug>` saía com `X-Frame-Options: DENY` (duas vezes) ao
lado de `frame-ancestors *` e só embutia pela precedência do CSP. O DENY
global agora exclui `/chat/` e `/embed/` (`lib/http/cabecalhos-de-seguranca.ts`,
regra `/((?!chat/|embed/).*)`, validada com o `checkCustomRoutes` do próprio
Next); quem decide a moldura é o CSP por organização.

**0b — o envio falhava em site http.** Iframe https dentro de página http não
é contexto seguro (`isSecureContext=false`, medido); `crypto.randomUUID`
não existe ali; o fallback (`Date.now()+'-'+Math.random()`) não era UUID; o
servidor respondia 422 e o visitante lia "Não foi possível enviar. Tente de
novo." — para sempre. Correção: a página gera UUID v4 por
`crypto.getRandomValues` (e por `Math.random` se nem isso houver); o servidor
continua exigindo UUID (`z.string().uuid()`), sem afrouxar. E os avisos
passaram a distinguir rede que FALHA (`semRede`: "Sem conexão…") de servidor
que RECUSA (`recusada`: "A mensagem não foi aceita. Recarregue…"); antes o
`fetch` rejeitado nem mostrava aviso (promessa sem `catch`). Prova: a página
roda no jsdom com `crypto.randomUUID` ausente
(`tests/unit/f24-t00-pagina-http-uuid-e-rede.test.ts`).

**0c — rascunho nunca publicado deixava a organização muda.** O portão do
drain (`lib/agent-engine/edge/crm/drain.ts`) só desviava para o motor novo
(`ai.engine=saas`, o padrão) quando `tem_agente_qualquer === false`, e essa
flag era `exists(select 1 from ai_agents …)` — sem olhar publicação. A KN
Tecnologia tinha dois rascunhos de teste (14 e 15/09) sem versão publicada; o
worker registrava "nenhum agente publicado para a sessão — turno pulado" e o
visitante não recebia resposta. Arquivar não resolvia; não existe exclusão.
Correção: a pergunta virou "já TEVE versão publicada?" (`status in
(published, superseded)` ou `published_at` carimbado). Pausado e
arquivado-depois-de-publicado continuam sendo a decisão "pare de responder"
e continuam parando o gasto; rascunho puro é ausência de decisão, e o motor
novo atende. Três casos novos no invariante
`tests/invariants/portao-de-capacidade-mede-quem-executa.test.ts`.

## Decisões de produto

1. **Fila com prazo, por organização.** Duas configurações novas na lista
   única (`src/tenant-config/schema.ts`):
   `webchat.handoff_mode` (`atendente` | `retorno`, padrão `atendente`) e
   `webchat.return_deadline_text` (texto, padrão `1 dia útil` — decisão do
   fundador). Em `retorno`, quando a conversa vai para `waiting_human` o
   visitante lê "Recebemos sua pergunta. {empresa} responde por {contato} em
   até {prazo}." — `{contato}` é o que ele informou na identificação
   (`visitor_contact`, que `GET /api/public/webchat/<slug>/messages` passou a
   devolver), `{prazo}` é o texto configurado. O padrão mantém a frase antiga
   ("Sua conversa está na fila para um atendente."): Deka não muda. Expostas
   em `/app/settings/tenant/webchat` e em `GET/PATCH /api/v1/settings/webchat`
   (`handoff_mode`, `return_deadline_text`).
2. **Pré-preenchimento da identificação.** Contrato: o site define
   `window.__crmWebchatPrefill = { name, contact }` ANTES do script; o script
   passa `name` e `contact` URL-encoded para `/chat/<slug>`; a página
   pré-preenche os dois campos, que continuam `required` e editáveis. Validação
   igual à do `/identify` (nome 2..120, contato 5..200); fora disso, o campo
   fica em branco. **A identidade continua declarada, não autenticada** — está
   escrito na tela, no código e aqui. Identidade autenticada é a fase 2.
3. **Chat de suporte embutido no próprio CRM-OS.** `SUPPORT_WEBCHAT_SLUG`
   (env, vazia por padrão): definida, a casca de `/app` monta
   `SuporteEmbutido` (`app/app/_components/SuporteEmbutido.tsx`), que injeta
   `/embed/<slug>.js` com nome e e-mail de quem está logado no prefill; sem a
   variável, nada muda. Ao desmontar (logout), balão, janela e guarda saem.
4. **Temas proibidos na tela.** `ai.forbidden_topics` entrou na lista fechada
   da tela de IA (`lib/settings/ia-do-tenant.ts`, `/app/settings/tenant/ia`,
   `PATCH /api/v1/settings/ai`): um tema por linha, ≤ 50 de ≤ 120 caracteres,
   linha em branco descartada. O turno já lia a chave (`src/ai/turno.ts`,
   gatilho `tenant_rule`).
5. **Leitura cruzada para o dono.** `GET /api/admin/handoffs`, com o MESMO
   bearer do cockpit (`ADMIN_SUMMARY_TOKEN`; guarda compartilhada em
   `lib/admin/cockpit.ts`): conversas não resolvidas em `waiting_human` ou
   com repasse não assumido, de TODAS as organizações, com `organization
   {id, slug, name}`, `contact_name`, `reason`, `summary`,
   `suggested_next_step`, `waiting_since`, `inbox_path` (`/app/inbox?id=…`) e
   `admin_path` (`/admin/inbox/…`). `?slug=a&slug=b` filtra; `?limit=` 1..200.
   Só leitura (um `select`). Preferido a cinco tokens `dsk_…`: uma pergunta,
   um segredo. Caminho em `PUBLIC_PATHS`, ancorado.
6. **Assinatura e chat público — o que se mediu** (integração
   `tests/integration/f24-suporte-kn-assinatura.test.ts`): as rotas públicas
   olham só `organizations.status='active'` e `webchat.enabled`. `past_due`
   é `full` (D44): a IA responde. `blocked` é `read_only`: o chat ACEITA a
   pergunta, o entitlement `ai.reply` nega, a conversa cai em
   `waiting_human`, e a escrita humana é negada pelo guarda — a janela aceita
   e ninguém responde. O que fecha o chat é `organizations.status <> 'active'`
   (suspender o tenant no /admin). **Marcação "interna": não criar.** A
   isenção já existe e não expira: `subscriptions.origin = 'operator'` (o
   "provisionar na mão" do /admin), sem gateway, sem evento de cobrança, sem
   `trial_ends_at`. Um flag separado seria um segundo estado para a mesma
   coisa, com um segundo caminho a manter em `acesso.ts`, no entitlement e no
   cockpit. O que faltava era LER: a tabela de `/admin/billing` passa a
   rotular `operator` como "interna (provisionada na mão)". Para as cinco
   organizações de suporte, o ato do fundador é "provisionar na mão" no plano
   que quiser (`PLAN_C` não tem limite de `ai.reply`).

## Backlog (registrado, não construído)

- Notificação de SAÍDA do evento `handoff.created` (webhook ou Telegram) por
  organização — hoje só aviso in-app e e-mail mock (`src/notifications`). A
  rota do item 5 é a leitura que a rotina do Núcleo usa até isso existir.
- Fase 2 do suporte: identidade autenticada passada pelo OS e leituras de
  conta por ferramenta autorizada (MCP).

## Consequências

- Nenhuma migration: as duas chaves novas vivem no schema de `tenant_settings`
  (linha só quando a organização grava). Nenhuma tela nova (as duas telas
  tocadas já têm porta).
- Variável nova com default que não quebra `.env` antigo
  (`SUPPORT_WEBCHAT_SLUG=`); `.env.example` regerado.
- O `X-Frame-Options` deixa de proteger `/chat/*` e `/embed/*` — por desenho:
  são as duas rotas feitas para viver em iframe, e o CSP `frame-ancestors`
  por organização é a política que vale para elas.
- Texto da página do visitante mudou em `erro` (agora cita nome e contato,
  porque é o `/identify` que o devolve) e ganhou `semRede`, `recusada`,
  `retornoCombinado`, `seuContato` nos dois idiomas.

## Gate

A F24 entra no `verify.sh` sem linha nova e sem spec nova, como a F06
(ADR-028): `scripts/verify.sh` (`F24) EXPECTED_SPECS=19`),
`scripts/verify/f02-e2e.mjs` (`REQUIRED_F24_E2E_SPECS = REQUIRED_F21_E2E_SPECS`)
e `scripts/verify/report.mjs` (`F24` em `GATED_PHASES` e no fim de
`CLOSING_ORDER`, herdando todas as linhas exigidas até F21). O gate corre no
staging (ADR-028 §2) como `f24-gate-01`. F22 e F23 fecham nas próprias
branches; quando forem mescladas, a ordem passa a ser F21 → F22 → F23 → F24
e o inventário da F24 herda o delas — mudança de uma linha, por ADR.

## Provas (25/09/2026, worktree `~/projetos/_worktrees/crm-suporte-kn`, branch `feat/F24-suporte-kn`)

- Unidade F24: 8 arquivos, 59/59 (`tests/unit/f24-*`); suíte inteira
  `pnpm test:unit`: 837 arquivos, 8.694/8.696 — as duas reprovas eram
  `f06-t01-logs-por-rota` (a guarda nova do cockpit não estava na lista de
  emissores; adicionada) e `branding` (chave de localStorage da F23, anterior
  a esta branch; registrada como INFRA) — 35/35 e 29/29 depois.
- `pnpm typecheck` 0 erros; `eslint` limpo nos arquivos tocados;
  `lint:channels` e `lint:role-rank` verdes; `release:conferir` aceita os dois
  fragmentos (1.17.0 → 1.18.0).
- Invariante do portão no Postgres descartável
  (`scripts/test-db.sh tests/invariants/portao-de-capacidade-mede-quem-executa.test.ts`):
  10/10 — os 7 casos antigos e os 3 da F24 (rascunhos em organização própria).
- Integração da assinatura
  (`scripts/test-integration.sh tests/integration/f24-suporte-kn-assinatura.test.ts`):
  4/4 — `past_due`: sessão, identificação e mensagem passam, `ai.reply`
  permitido, conversa em `ai_handling`; `blocked`: passam, `ai.reply` negado
  (`subscription_blocked`), conversa em `waiting_human`; `origin=operator`
  ativa: permitido, sem gateway/carência; organização suspensa: sessão
  recusada (`unknown_organization`).
- Gate `f24-gate-01` (staging, 25/09 18:58): typecheck, lint, lint-channels
  e build verdes; `shell` reprovou no caso (6) de
  `hostgator-setup-kit/test-validators.sh` — hex inválido em `APP_ACCENT_HEX`
  deveria cair no accent do produto, mas o gerador (`marca-emails.sh`) ainda
  caía na Sage `#506d48` e a régua lia "as duas primeiras `background:`" do
  e-mail, que nos modelos da F23 são o fundo `#f5f4ef`. Defeito da base (F23),
  consertado aqui: fallback `#0b7374` (grau 600 da régua, ADR-049) e a régua
  passou a procurar o PAR do botão. O gate foi interrompido (veredito já
  condenado) e relançado como `f24-gate-02`.
- Não medido nesta entrega: `next build`, Playwright contra `next start`, e a
  prova visual em site externo — ficam para o `verify.sh` e para o fundador
  no staging (o `.env` de lá recebe `SUPPORT_WEBCHAT_SLUG` para provar o
  item 3 pela tela).
