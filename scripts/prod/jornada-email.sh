#!/usr/bin/env bash
# scripts/prod/jornada-email.sh — UM e-mail real, ao PROPRIETÁRIO, pela produção (F08-T06).
#
# A jornada é a recuperação de senha do próprio dono: o mesmo
# `POST /auth/v1/recover` que `app/actions/auth/requestPasswordReset.ts` chama,
# pelo domínio (Caddy → kong → GoTrue), e o GoTrue entrega pela Resend por
# SMTP (compose.prod.yml: `GOTRUE_SMTP_HOST=smtp.resend.com`). Destinatário =
# `OWNER_EMAIL`, e só ele (regra da casa: nunca mensagem a terceiros).
#
# Evidência (sem corpo, sem valor de segredo): o GoTrue aceitou (HTTP 200), a
# linha `user_recovery_requested` em `auth.audit_log_entries` cresceu em 1, e a
# Resend lista o e-mail entregue (id, remetente, assunto) pela API de leitura.
# Saída: `email: ok id=<id da Resend> from=<remetente> ...` — o que
# `scripts/prod/prova.sh` lê em docs/ops/prod-jornadas.log.
source "$(dirname "$0")/_env.sh"
APP_URL=$(prod_env NEXT_PUBLIC_APP_URL)
DB_URL=$(prod_db_url)
DESTINO=$(prod_env OWNER_EMAIL)
REMETENTE=$(prod_env RESEND_FROM_EMAIL)
CHAVE=$(prod_env RESEND_API_KEY)
[ -n "$DESTINO" ] && [ -n "$REMETENTE" ] && [ -n "$CHAVE" ] || { echo "==> OWNER_EMAIL/RESEND_FROM_EMAIL/RESEND_API_KEY vazios" >&2; exit 1; }

ANTES=$(psql "$DB_URL" -Atc "select count(*) from auth.audit_log_entries where payload->>'action' = 'user_recovery_requested'")
INICIO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
CODIGO=$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 -X POST "$APP_URL/auth/v1/recover" \
  -H "apikey: $(prod_env ANON_KEY)" -H "content-type: application/json" \
  --data-binary "$(node -e 'process.stdout.write(JSON.stringify({email:process.argv[1],gotrue_meta_security:{}}))' "$DESTINO")")
[ "$CODIGO" = 200 ] || { echo "==> /auth/v1/recover respondeu $CODIGO" >&2; exit 1; }
sleep 5
DEPOIS=$(psql "$DB_URL" -Atc "select count(*) from auth.audit_log_entries where payload->>'action' = 'user_recovery_requested'")
[ "$DEPOIS" -gt "$ANTES" ] || { echo "==> auth.audit_log_entries não registrou user_recovery_requested ($ANTES → $DEPOIS)" >&2; exit 1; }

# A Resend lista os envios (leitura): pega o mais recente para o dono, depois do início.
ID=""; FROM=""; ASSUNTO=""; ESTADO=""
for i in $(seq 1 12); do
  LEITURA=$(curl -s --max-time 30 -H "Authorization: Bearer $CHAVE" "https://api.resend.com/emails?limit=20")
  eval "$(node -e '
    let d=""; process.stdin.on("data",c=>d+=c).on("end",()=>{
      const [destino, inicio] = process.argv.slice(1);
      let j; try { j = JSON.parse(d); } catch { return; }
      const lista = Array.isArray(j.data) ? j.data : [];
      const m = lista.find((e) => (e.to ?? []).map((t) => String(t).toLowerCase()).includes(destino.toLowerCase()) && String(e.created_at) >= inicio);
      if (!m) return;
      const q = (s) => "\x27" + String(s ?? "").replace(/\x27/g, "") + "\x27";
      process.stdout.write(`ID=${q(m.id)}; FROM=${q(m.from)}; ASSUNTO=${q(m.subject)}; ESTADO=${q(m.last_event)}`);
    })' "$DESTINO" "$INICIO" <<<"$LEITURA")"
  [ -n "$ID" ] && break
  sleep 5
done
[ -n "$ID" ] || { echo "==> a Resend não listou e-mail para o dono desde $INICIO (o GoTrue aceitou; confira o remetente/DKIM)" >&2; exit 1; }
FROM_OK=0; case "$FROM" in *"$REMETENTE"*) FROM_OK=1 ;; esac
[ "$FROM_OK" = 1 ] || { echo "==> remetente inesperado na Resend: $FROM" >&2; exit 1; }
echo "email: ok id=$ID from=$REMETENTE subject=\"$ASSUNTO\" state=$ESTADO recovery_audit=$((DEPOIS-ANTES))/1 via=gotrue-smtp-resend"
