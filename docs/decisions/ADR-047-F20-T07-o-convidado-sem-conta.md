# ADR-047 — F20-T07: o convidado sem conta consegue entrar

**Data:** 2026-09-23 · **Estado:** aceito · **Fase:** F20 · Estende [ADR-045](ADR-045-F20-convites-curtos-e-membership.md).

## Contexto

Em 23/09 o proprietário mandou a um convidado real (tenant `deka-sucos`) o link
emitido pela tela de criação do tenant. A pessoa não conseguiu entrar. A
investigação achou uma cadeia de quatro elos, e os dois últimos **sobrevivem à
F20 como ela está construída**:

1. O link antigo tem 559 caracteres e o WhatsApp linkifica só até
   `/accept-invite/` (já medido no ADR-045 §Contexto). O convidado abriu a URL
   **sem o token**.
2. `/team/accept-invite/` → 308 → `/team/accept-invite` → 307 →
   `/login?next=…`. A tela de login oferece `href="/signup"`. Sem conta, a
   pessoa clicou ali e caiu em **"Criar conta"**, que pede *Nome da empresa* —
   ou seja, o caminho oferecido criava uma organização SEPARADA, não o aceite.
   (Medido por `curl` contra a produção em 23/09.)
3. Ela preencheu e recebeu *"Não foi possível criar a conta. Tente novamente."*
   e tentou 4 vezes. O GoTrue da produção respondeu **422 `signup_disabled`**
   (`2026-09-23T21:09:07Z` … `21:10:10Z`, `docker logs crm-prod-auth`):
   `GOTRUE_DISABLE_SIGNUP=true` na produção, **`false` no staging**.
4. A F20 encurta o link e conserta o elo 1–2, mas **não conserta 3**, e
   introduz um elo novo: `app/i/[token]/page.tsx:82` manda o token CURTO para
   `/signup?invite=`, e `app/(public)/signup/page.tsx:27` valida com
   `verifyInviteToken` — o verificador **HMAC do token antigo**. Um token de 16
   caracteres aleatórios não verifica: a pessoa convidada lê "convite expirado".

O gate não pegou nada disso por duas razões, e as duas são minhas:
a spec `tests/e2e/f20-convites.spec.ts` cobre *gerente vê pendente*, *cancelar*
e *painel do dono* — **nenhuma jornada de aceite**, que é o ponto da
funcionalidade; e o staging tem `GOTRUE_DISABLE_SIGNUP=false`, então o elo 3 é
invisível ali por construção.

## Decisão

### 1. `/signup?invite=` entende os dois tokens
Resolve primeiro pelo token novo (`lerConvitePorToken`, linha em `team_invites`),
e só então cai no `verifyInviteToken` legado. Convite antigo em trânsito continua
valendo até vencer.

### 2. Convite válido cria a conta mesmo com o cadastro público desligado
Com convite vivo, não vencido, não revogado e e-mail idêntico, a conta nasce pelo
**service role** (`auth.admin.createUser`), que não passa pelo `DISABLE_SIGNUP`.
Sem convite, nada muda: o cadastro público segue recusado (D13).

O e-mail nasce confirmado. O token do convite **já é** o segredo portador — quem
o tem já pode entrar na organização —, então confirmar o e-mail não concede nada
que o token não conceda. O que isso evita é a tela impossível do §B29: pedir
confirmação num ambiente sem remetente configurado (`email_dispatched: false`).

### 3. A jornada que faltava vira teste
`tests/e2e/f20-convites.spec.ts` ganha **o convidado sem conta abre o link, cria
a conta e cai na empresa certa com o papel certo** — nos dois tenants.

### 4. Régua para a divergência de ambiente
O elo 3 existiu porque staging e produção discordam num flag que porteia um fluxo
de usuário. Régua nova confere os flags do GoTrue que porteiam fluxo entre o
compose do staging e o da produção e FALHA na divergência não declarada.
Régua e conserto em arquivos separados (G-45).

## Consequência

A F20 passa a entregar o que prometia. Sem a T07 o link fica curto e bonito e a
pessoa convidada continua sem conseguir entrar — que é exatamente o estado de
hoje, só que com uma URL menor.
