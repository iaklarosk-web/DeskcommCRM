#!/usr/bin/env bash
# scan-secrets (F01-T10, DIRETRIZ §5.18) — varredura de segredos no repositório.
#
# Varre as QUATRO pastas da §5.18 (src, scripts, supabase, workers) pelos
# padrões de credencial conhecidos; docs/ fica fora e linha de COMENTÁRIO é
# excluída (a §5.18 manda: o repositório DOCUMENTA padrões de segredo — o
# audit doc cita "sk-ant-|ghp_" — e um scanner que late para documentação é
# scanner desligado na primeira semana). O custo dessa exclusão é conhecido e
# aceito: segredo colado em linha comentada não é pego AQUI — é pego pelo
# grep de pre-commit do CLAUDE.md, que olha o diff inteiro.
#
# FIXTURE NEGATIVA (G-51): tests/fixtures/secrets/negativa.txt contém
# credenciais FALSAS que casam os padrões. O scanner PRECISA achá-las — se não
# achar, ele está morto e o exit é 1 mesmo com findings=0. A fixture não conta
# como finding.
#
# Saída (grafia de §8.3): `secrets: files_scanned=F findings=N`; exit 0 só com
# findings=0 E fixture detectada.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

DIRS=(src scripts supabase workers)
FIXTURE="tests/fixtures/secrets/negativa.txt"

PADRAO='sk-ant-[A-Za-z0-9_-]{8,}|sk-proj-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY|postgres(ql)?://[A-Za-z0-9_]+:[^@ ]{8,}@|xox[baprs]-[A-Za-z0-9-]{10,}|[0-9]{8,10}:AA[A-Za-z0-9_-]{30,}'

FILES=$(git ls-files "${DIRS[@]}")
F=$(echo "$FILES" | wc -l | tr -d ' ')

# findings: match do padrão, fora de linha de comentário (primeiro caractere
# útil é //, #, * ou --). Exclusão NOMEADA (G-14: allowlist explícita, nunca
# padrão afrouxado): `postgres:postgres@127.0.0.1|localhost` é a convenção do
# Postgres efêmero/local de dev — a mesma dos testes de invariante — e não é
# credencial de nada. Qualquer outra senha em URL continua sendo finding.
ACHADOS=$(echo "$FILES" | xargs grep -nE "$PADRAO" 2>/dev/null \
  | grep -vE '^[^:]+:[0-9]+:\s*(//|#|\*|--)' \
  | grep -vE 'postgres(ql)?://postgres:postgres@(127\.0\.0\.1|localhost)' || true)
N=$(if [ -z "$ACHADOS" ]; then echo 0; else echo "$ACHADOS" | wc -l | tr -d ' '; fi)

# G-51: a fixture negativa PRECISA ser pega pelo mesmo padrão.
#
# `grep -c` IMPRIME a contagem mesmo quando sai 1 (zero acertos), então o
# `|| echo 0` antigo produzia "0\n0" nesse caso, o `[ -lt 2 ]` reclamava de
# "integer expression expected" e o script SAÍA 0 — o scanner com padrão
# quebrado passava. Medido pelo mutante 56 (F06-T04): a guarda estava morta
# desde a F01. Agora a contagem é lida como está e só o vazio vira 0.
FIXTURE_HITS=$(grep -cE "$PADRAO" "$FIXTURE" 2>/dev/null)
FIXTURE_HITS=${FIXTURE_HITS:-0}

echo "secrets: files_scanned=$F findings=$N"
if [ "$N" != 0 ]; then
  echo "$ACHADOS" | head -20 >&2
  exit 1
fi
if [ "$FIXTURE_HITS" -lt 2 ]; then
  echo "FATAL: a fixture negativa ($FIXTURE) não foi pega pelo padrão — o scanner está morto (G-51)" >&2
  exit 1
fi
exit 0
