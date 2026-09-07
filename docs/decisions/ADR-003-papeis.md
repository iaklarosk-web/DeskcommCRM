# ADR-003 — Mapa dos papéis do Deskcomm para `platform_admin` / `tenant_admin` / `attendant` (D15)

## Contexto
D15 define três papéis na Fase 1. O Deskcomm, medido @ `c85f7d7`:

- Membership: `user_organizations(user_id, organization_id, role, revoked_at, …)` — `supabase/baseline.sql:1833`; `CONSTRAINT user_organizations_role_check CHECK (role = ANY (ARRAY['viewer','agent','manager','admin']))` — `:1844`. Confirmado no banco de dev (`pg_get_constraintdef`): os quatro valores.
- Administrador de plataforma **não é valor de `role`**: é linha em `platform_admins` (`baseline.sql:1768`), lida por `fn_is_platform_admin()` (`:312`) e por `lib/auth/requirePlatformAdmin.ts:34`.
- Ranking em código: `lib/auth/types.ts:22-27` — `viewer=1, agent=2, ai_operator=3, manager=4, admin=5`. `ai_operator` **só existe no TypeScript** (0 ocorrências em `supabase/`): é o papel do agente publicado, restrito ao escopo do token (`types.ts:6`), nunca de uma pessoa.
- Gate: `requireRole(min)` (`lib/auth/require-role.ts:52`) compara rank e ainda impõe MFA de sessão (`:110-130`); 155/235 rotas `/api/v1` o chamam; 8 comparações `role ===` soltas (auditoria A).
- Policies RLS usam os literais `'admin'`/`'manager'` via `fn_role_at_least` (ex.: `baseline.sql:4037`, `:4140`, `:4159`, `:4260`).
- Usuários existentes por valor: **0 em todos** — o banco de dev nasceu vazio do `baseline.sql` e o projeto não herda nenhum banco de produção do Deskcomm (é upstream open-source, não uma instalação nossa). Consulta: `select role, count(*) from user_organizations group by 1` → 0 linhas; `select count(*) from platform_admins` → 0.

## Decisão
Mapa (valor real → papel D15 → destino dos usuários):

| Valor real no Deskcomm | Papel D15 | Destino dos usuários existentes | Observação |
|---|---|---|---|
| linha em `platform_admins` | `platform_admin` | nenhum existe | criado só por `scripts/create-tenant.sh`/bootstrap, nunca à mão |
| `user_organizations.role = 'admin'` | `tenant_admin` | nenhum existe | |
| `user_organizations.role = 'agent'` | `attendant` | nenhum existe | |
| `'manager'` | — (Fase 2) | nenhum existe | seeds da Fase 1 nunca criam; se surgir, tratar como `tenant_admin` até a Fase 2 |
| `'viewer'` | descartado na Fase 1 | nenhum existe | seeds nunca criam |
| `ai_operator` (só TS) | não é papel de pessoa | — | vira o executor `ai` do Action Policy (§5.8); sai de `Role` quando a F04 fechar |

**O CHECK do banco não muda na Fase 1.** O vocabulário D15 vive em `src/rbac/matrix.ts` (F01-T07), que traduz `tenant_admin → 'admin'` e `attendant → 'agent'` ao gravar e ao comparar; `validateSeed` só aceita os nomes D15. O invariante (1) da §5.4 ("coluna `role` restrita ao enum D15") é cumprido na camada de seed/RBAC, não pelo CHECK — desvio resolvido pela hierarquia D09 (nível (a) da D10), registrado aqui.

## Alternativas rejeitadas
- Trocar o CHECK para `{platform_admin, tenant_admin, attendant}`: quebra `fn_role_at_least` em 155 policies e os literais `'admin'`/`'manager'` em rotas, `requireRole`, `bootstrap-owner.ts:203` e 9+ testes herdados; custo alto e nenhum ganho de isolamento.
- Mover o `platform_admin` para dentro de `user_organizations.role`: perde a separação que o Deskcomm já tem (admin de plataforma não é membro de tenant) e contraria a §5.4.
- Manter `ai_operator` como papel: o agente não é pessoa e a D17 põe a autoridade da IA no catálogo de ações, não no RBAC.

## Consequências
- F01-T07 escreve a matriz com os nomes D15 e o tradutor para os valores herdados; a prova `rbac: roles=3 denied_expected=D denied_actual=D` usa identidades criadas com `'admin'` e `'agent'`.
- As 21 rotas `/api/v1` que hoje chamam `getUser()` sem `requireRole` (auditoria A, achado 3) entram na F01-T07 como dívida a fechar ou a listar em `public_routes`.
- Fase 2 reabre esta ADR para `manager`, `sales`, `finance` e papéis personalizados.

## Data
2026-09-07

## Commit
O commit que adiciona este arquivo (`git log --format=%h -1 -- docs/decisions/ADR-003-papeis.md`).
