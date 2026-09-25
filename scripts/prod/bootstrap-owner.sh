#!/usr/bin/env bash
# scripts/prod/bootstrap-owner.sh — o platform_admin REAL da produção (F08-T04, D12-7).
#
# Roda `scripts/bootstrap-owner.ts` DENTRO do container do app (ADR-032 §3): o
# compose já resolveu o env (`OWNER_EMAIL`, `OWNER_PASSWORD`, `OWNER_ORG_NAME`,
# `AI_PROVIDER`, chaves do Supabase), então as aspas do `segredo` não chegam ao
# script e nenhum valor passa por este shell. O standalone do Next não traz o
# `tsx`; a imagem do worker traz a árvore inteira (`/app/scripts`), o `tsx` e
# o `tsconfig` — o script roda lá, na mesma rede, contra o kong.
#
# Idempotente (o script herdado já é): dono existente = senha atualizada; org
# existente = reaproveitada; associação e platform_admins garantidas. Depois,
# a organização-plataforma ganha assinatura `active/operator` PLAN_C (sem
# limite) — a garantia de D38 ("ninguém sem assinatura") vale para o dono
# também, e o smoke/prova cobram `orgs_without_subscription=0/N`.
#
# Saída: contagens (usuários, organizações, platform_admins, assinaturas) —
# nunca a senha, nunca o e-mail além do que o BUILD-STATE já registra.
source "$(dirname "$0")/_env.sh"
DB_URL=$(prod_db_url)
ORG_NAME=$(prod_env OWNER_ORG_NAME)
[ -n "$(prod_env OWNER_EMAIL)" ] && [ -n "$(prod_env OWNER_PASSWORD)" ] && [ -n "$ORG_NAME" ] \
  || { echo "==> OWNER_EMAIL/OWNER_PASSWORD/OWNER_ORG_NAME vazios em $PROD_ENV_FILE" >&2; exit 1; }

echo "==> bootstrap do dono dentro do container do worker (env resolvido pelo compose)"
# `-e` com os valores LIDOS AGORA do arquivo de segredos: `compose exec` entra num
# container que já existe, e o ambiente dele é o de quando foi CRIADO. Medido em
# 25/09/2026: o proprietário trocou OWNER_PASSWORD no arquivo, rodou este script
# e o GoTrue regravou a senha ANTIGA (24 chars, a do container) — a nova (8 chars)
# ficou só no arquivo, e a tela dizia "incorreta". Sem o `-e`, este script só
# funciona enquanto ninguém mudou nada desde o último `up.sh`.
"${PROD_COMPOSE[@]}" exec -T -w /app \
  -e OWNER_EMAIL="$(prod_env OWNER_EMAIL)" \
  -e OWNER_PASSWORD="$(prod_env OWNER_PASSWORD)" \
  -e OWNER_ORG_NAME="$ORG_NAME" \
  worker sh -c \
  'TSX_TSCONFIG_PATH=/app/tsconfig.json node --import /app/node_modules/tsx/dist/loader.mjs /app/scripts/bootstrap-owner.ts' \
  | sed -E 's/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/<uuid>/g'

echo "==> assinatura da organização-plataforma (active/operator, PLAN_C) — idempotente"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
insert into public.subscriptions (organization_id, plan_code, status, origin, current_period_start, current_period_end)
select o.id, 'PLAN_C', 'active', 'operator', now(), now() + interval '30 days'
  from public.organizations o
 where o.slug = (select slug from public.organizations order by created_at asc limit 1)
   and not exists (select 1 from public.subscriptions s where s.organization_id = o.id);
SQL

psql "$DB_URL" -Atc "
select 'bootstrap: users=' || (select count(*) from auth.users)
    || ' organizations=' || (select count(*) from public.organizations)
    || ' platform_admins=' || (select count(*) from public.platform_admins where revoked_at is null)
    || ' subscriptions_active=' || (select count(*) from public.subscriptions where status = 'active')
    || ' orgs_without_subscription=' || (select count(*) from public.organizations o where not exists (select 1 from public.subscriptions s where s.organization_id = o.id))
    || '/' || (select count(*) from public.organizations)"
