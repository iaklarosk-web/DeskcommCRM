#!/usr/bin/env bash
#
# O SANDBOX DESCARTÁVEL DO GATE FECHADO — reproduzível, não artesanal.
#
# ═══ POR QUE ESTE ARQUIVO EXISTE ═══
#
# A F02 provou o gate de navegador num Supabase local próprio, em portas 554xx,
# separado do projeto local de 543xx que outro checkout usa. A receita, porém,
# só sobreviveu como uma CÓPIA de `supabase/config.toml` guardada na evidência:
# quem viesse depois teria de adivinhar quais portas, qual project_id e o que
# tinha sido desligado. Um ambiente que só uma sessão sabe levantar não é
# reproduzível — e o gate inteiro depende dele.
#
# Aqui a receita é derivada do `supabase/config.toml` versionado por
# substituições explícitas e CONFERIDAS. Se o config do repositório mudar de
# forma que alguma substituição não se aplique, o script para: é melhor recusar
# do que subir um sandbox que aponta para o projeto errado.
#
# ═══ POR QUE PORTAS PRÓPRIAS ═══
#
# `supabase start` no config do repositório subiria o projeto `deskcomm-crm` em
# 54321/54322 — que é o Supabase local de DESENVOLVIMENTO, com dados de outro
# checkout. O sandbox tem project_id e portas próprios para que `stop` derrube
# exatamente o que este script subiu, e nada mais.
#
# Uso:
#   scripts/verify/sandbox.sh up      # sobe, aplica o baseline, confere
#   scripts/verify/sandbox.sh status  # o que está de pé, sem tocar em nada
#   scripts/verify/sandbox.sh down    # derruba SÓ o que é deste sandbox
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

PROJECT_ID="f02-crm-cadastros"   # identidade herdada da F02 (ADR-018)
API_PORT=55421
DB_PORT=55422
SHADOW_PORT=55420
POOLER_PORT=55429
STUDIO_PORT=55423
INBUCKET_PORT=55424
APP_PORT=3102
WORKDIR="${SANDBOX_WORKDIR:-.verify-logs/sandbox-workdir}"

SUPABASE="supabase"
command -v supabase >/dev/null 2>&1 || SUPABASE="npx supabase"

# Substituição obrigatória: aplica e confere. `sed` que não casa nada devolve o
# arquivo intacto e em silêncio — que é como um sandbox aponta para o banco de
# desenvolvimento sem ninguém perceber.
trocar() {
  local arquivo=$1 de=$2 para=$3 esperado=${4:-1}
  local achados
  achados=$(grep -cF -- "$de" "$arquivo" || true)
  if [ "$achados" != "$esperado" ]; then
    echo "==> config.toml mudou: '$de' apareceu $achados vezes, esperava $esperado" >&2
    exit 1
  fi
  local tmp; tmp=$(mktemp)
  # `awk` e não `sed`: o valor pode conter barra e outros metacaracteres.
  awk -v de="$de" -v para="$para" '{
    n = index($0, de)
    while (n > 0) { $0 = substr($0, 1, n-1) para substr($0, n + length(de)); n = index($0, de) }
    print
  }' "$arquivo" > "$tmp"
  mv "$tmp" "$arquivo"
}

preparar_workdir() {
  rm -rf "$WORKDIR"
  mkdir -p "$WORKDIR/supabase"
  cp supabase/config.toml "$WORKDIR/supabase/config.toml"
  cp -r supabase/templates "$WORKDIR/supabase/templates"
  local cfg="$WORKDIR/supabase/config.toml"

  trocar "$cfg" 'project_id = "deskcomm-crm"' "project_id = \"$PROJECT_ID\""
  trocar "$cfg" 'port = 54321' "port = $API_PORT"
  trocar "$cfg" 'port = 54322' "port = $DB_PORT"
  trocar "$cfg" 'shadow_port = 54320' "shadow_port = $SHADOW_PORT"
  trocar "$cfg" 'port = 54329' "port = $POOLER_PORT"
  trocar "$cfg" 'port = 54323' "port = $STUDIO_PORT"
  trocar "$cfg" 'port = 54324' "port = $INBUCKET_PORT"
  trocar "$cfg" 'api_url = "http://127.0.0.1:54321"' "api_url = \"http://127.0.0.1:$API_PORT\""
  trocar "$cfg" 'http://localhost:3000' "http://localhost:$APP_PORT" 3
  trocar "$cfg" 'http://localhost:3001' "http://localhost:$APP_PORT"

  # realtime e studio desligados: esta VPS tem dois núcleos, e nenhuma spec do
  # gate fechado usa nenhum dos dois. Foi assim que a F02 rodou.
  python3 - "$cfg" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p, encoding="utf8").read()
for secao in ("realtime", "studio"):
    novo, n = re.subn(rf"(\[{secao}\]\nenabled = )true", r"\1false", s, count=1)
    if n != 1:
        raise SystemExit(f"==> nao achei [{secao}].enabled = true no config derivado")
    s = novo
open(p, "w", encoding="utf8").write(s)
PY
  echo "==> workdir preparado em $WORKDIR (project_id=$PROJECT_ID)"
}

portas_ocupadas() {
  local ocupadas=()
  for porta in "$API_PORT" "$DB_PORT" "$APP_PORT" "$INBUCKET_PORT"; do
    if ss -ltn 2>/dev/null | grep -qE "[:.]$porta\b"; then ocupadas+=("$porta"); fi
  done
  printf '%s\n' "${ocupadas[@]+"${ocupadas[@]}"}"
}

case "${1:-}" in
  up)
    preparar_workdir
    $SUPABASE start --workdir "$WORKDIR"
    # O baseline vem de `pg_dump`: ele REFERENCIA `public.vector`, `public.citext`,
    # `gin_trgm_ops` e `extensions.uuid_generate_v4`, mas não cria nenhuma delas.
    # Sem este passo o `psql` morre na primeira referência e o sandbox sobe com
    # meio schema — que foi o que aconteceu na primeira execução deste script.
    # A lista é a mesma de `scripts/test-db.sh:213-217`, o outro lugar que
    # levanta banco do zero; divergir das duas seria criar duas verdades.
    echo "==> criando as extensões que o baseline referencia e não cria"
    PGPASSWORD=postgres psql -h 127.0.0.1 -p "$DB_PORT" -U postgres -d postgres \
      -v ON_ERROR_STOP=1 >"$WORKDIR/extensoes.log" <<'SQL'
create schema if not exists extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema public;
create extension if not exists citext with schema public;
create extension if not exists pg_trgm with schema public;
SQL

    echo "==> aplicando supabase/baseline.sql no banco do sandbox"
    PGPASSWORD=postgres psql -h 127.0.0.1 -p "$DB_PORT" -U postgres -d postgres \
      -v ON_ERROR_STOP=1 -f supabase/baseline.sql > "$WORKDIR/baseline.log"
    echo "==> baseline aplicado; $(wc -l < "$WORKDIR/baseline.log") linhas de saída em $WORKDIR/baseline.log"
    echo "==> portas de pé: $(portas_ocupadas | tr '\n' ' ')"
    echo "==> antes de rodar o navegador, exporte E2E_PORT=$APP_PORT: o"
    echo "    playwright.config.ts lê process.env.E2E_PORT ANTES de publicar o"
    echo "    .env.e2e, então sem isso ele tenta a porta 3001 e o build sobe no"
    echo "    lugar errado. Medido na F03-T09."
    echo "==> [realtime] fica DESLIGADO neste sandbox, como na F02: nenhuma spec"
    echo "    do inventário obrigatório usa realtime, e o container custa RAM que"
    echo "    esta VPS de dois núcleos não tem. A spec inbox-tempo-real NÃO roda"
    echo "    aqui — ela já está declarada fora do CI."
    echo "==> .env.e2e NÃO é regravado por este script: as chaves locais do"
    echo "    Supabase são determinísticas por projeto, então o arquivo privado"
    echo "    preservado continua valendo. Para regerar: pnpm e2e:env com o"
    echo "    workdir apontado, e nunca imprima o conteúdo."
    ;;
  status)
    echo "containers do sandbox:"
    docker ps -a --filter "name=supabase_.*_${PROJECT_ID}" --format '{{.Names}}\t{{.Status}}' || true
    echo "portas ocupadas entre as do sandbox: $(portas_ocupadas | tr '\n' ' ')"
    ;;
  down)
    $SUPABASE stop --project-id "$PROJECT_ID" --no-backup --yes || true
    # A rede rotulada fica para trás quando não há mais container nela.
    docker network ls --filter "name=${PROJECT_ID}" --format '{{.Name}}' \
      | while read -r rede; do [ -n "$rede" ] && docker network rm "$rede" >/dev/null 2>&1 || true; done
    restantes=$(docker ps -aq --filter "name=supabase_.*_${PROJECT_ID}" | wc -l)
    echo "==> containers restantes deste sandbox: $restantes"
    echo "==> portas ainda ocupadas: $(portas_ocupadas | tr '\n' ' ')"
    [ "$restantes" = "0" ] || { echo "==> limpeza incompleta" >&2; exit 1; }
    ;;
  *)
    echo "Uso: scripts/verify/sandbox.sh {up|status|down}" >&2
    exit 2
    ;;
esac
