# Varredura de promessas vazias na interface — 24/09/2026

O que a tela oferece e o produto não entrega. Pedida pelo proprietário depois de
ele achar, só olhando o `/admin`, duas abas que não abrem — e que não estavam
documentadas em lugar nenhum.

Método: `567` arquivos de tela (`.tsx`/`.jsx`, fora de teste), `128` rotas reais
do App Router. Procurou link para rota inexistente, item desligado no código,
texto de promessa ("em breve", "ainda não disponível") e handler vazio.
Régua em `/tmp` (descartável); este documento é o resultado.

## 1. Desatualizado desde D58 (20/09) — a decisão não chegou à tela

A produção tem `PLAN_A=Essencial`, `PLAN_B=Profissional`, `PLAN_C=Empresarial`,
todos com `source=owner` (conferido no banco em 24/09). Mesmo assim:

| Onde | O que a tela diz | Por que está errado |
|---|---|---|
| `app/admin/(protected)/tenants/new/_form.tsx:320-322` | `PLAN_A (placeholder)`, `PLAN_B (placeholder)`, `PLAN_C (placeholder)` | Rótulos FIXOS no código. O proprietário escolhe o plano de um tenant real, com Stripe LIVE, num menu que mente o nome |
| `app/admin/(protected)/billing/page.tsx:110` | "Nome, preço e limites marcados como placeholder ainda não foram decididos pelo proprietário" | Texto INCONDICIONAL. Nome e preço foram decididos (D14/D58); só os LIMITES seguem placeholder (9023) |

Contraste que vale registrar: a mesma frase em `app/app/billing/page.tsx:161` —
a tela do CLIENTE — é condicional (`p.source === "placeholder"`) e some sozinha
na produção. **O cliente vê a verdade; o dono vê o texto velho.**

## 2. Link morto

| Onde | Para onde aponta | Estado |
|---|---|---|
| `components/admin/platform-admins/DBAOnlyNotice.tsx:33` | `/runbook/platform-admin-management.md` | O botão "Ver runbook →" leva a 404: esse arquivo não existe em lugar nenhum do repositório |

## 3. Declaradamente "em breve" (nunca construído)

Estes são honestos com quem lê — dizem que não existem. Ficam registrados para
deixarem de ser surpresa:

| Onde | Promessa |
|---|---|
| `app/admin/(protected)/tenants/[id]/layout.tsx:50-51` | abas **Equipe** e **Uso** do `/admin`, `disabled: true`; não há rota nem `page.tsx` |
| `app/admin/(protected)/inbox/_components/AdminThread.tsx:103` | "Use *Impersonate* (em breve, S-11.07) para responder" |
| `app/app/settings/billing/page.tsx:35` | seção inteira "Em breve — Fase 2" |
| `app/app/settings/profile/_form.tsx:81` | "Trocar email — em breve" |
| `app/app/settings/profile/_form.tsx:140` | "Upload de arquivo — em breve. Cole uma URL pública" |
| `app/app/settings/security/_client.tsx:200` | "Listagem de sessões — em breve" |
| `app/app/settings/notifications/page.tsx:64,90` | "Email ainda não está disponível" (in-app e push funcionam) |

## 4. Falsos positivos, para quem repetir a varredura

- `/` apontado como link morto 5× (páginas 403/500/503/not-found/admin-forbidden):
  a raiz EXISTE (`app/page.tsx`); o detector não registrava a raiz.
- 232 de 331 casamentos de "promessa" eram atributo `placeholder=` de campo de
  formulário, comentário ou nome de variável.
- ~99 dos restantes eram estado vazio legítimo ("Você ainda não cadastrou
  nenhum material") — isso é boa interface, não promessa falsa.

## O que isto ensina

As duas abas do §3 e os rótulos do §1 estavam na tela do proprietário há dias, e
nenhum dos 8.603 testes falhou por causa deles — porque teste nenhum pergunta
"esta tela diz a verdade?". Foi preciso uma pessoa abrir a tela e estranhar.
É a mesma lição do ADR-047 por outro ângulo.
