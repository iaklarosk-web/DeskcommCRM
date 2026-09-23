/**
 * F08-T07 — UM evento de teste no Sentry PRÓPRIO da produção (ADR-032 §2).
 *
 * Roda dentro do container do worker (env resolvido pelo compose), com a
 * MESMA inicialização de `workers/agent-worker/main.ts`: DSN por
 * `resolveSentryDsn`, hooks de scrub, `sendDefaultPii: false`. Recusa o DSN da
 * comunidade (`isCommunityDsn` tem de ser false — é o §B11 fechado) e manda o
 * erro pelo caminho do produto, `capturarErro`, com um contexto que MISTURA
 * campos permitidos e campos de PII: só a allowlist sai (`kept/existing`).
 *
 * Saída: uma linha `sentry: ok id=<event_id> community=false kept=K/E
 * pii_fields=0/P flushed=1/1` — o que `scripts/prod/prova.sh` lê no log de
 * jornadas. Nada de PII é impresso nem enviado.
 */
import * as Sentry from "@sentry/nextjs";

import { isCommunityDsn, resolveSentryDsn } from "@/lib/sentry/dsn";
import { sentryScrubHooks } from "@/lib/sentry/scrub";
import { CAMPOS_QUE_SAEM, capturarErro } from "@/src/obs/erros";

const dsn = resolveSentryDsn(process.env.SENTRY_DSN);
if (!dsn) throw new Error("SENTRY_DSN vazio/off: a produção precisa do DSN próprio (D12-6)");
if (isCommunityDsn(dsn))
  throw new Error("SENTRY_DSN aponta para o Sentry da comunidade: recusado (§B11)");

let eventId = "";
Sentry.init({
  dsn,
  tracesSampleRate: 0,
  enableLogs: false,
  sendDefaultPii: false,
  ...sentryScrubHooks,
  // O id do evento é lido no MESMO hook de scrub do produto, depois dele:
  // capturarErro não o expõe e o namespace ESM do SDK não se remenda.
  beforeSend(event, hint) {
    void hint;
    const limpo = sentryScrubHooks.beforeSend(event);
    eventId = limpo?.event_id ?? "";
    return limpo;
  },
});

const PII = {
  email: "ninguem@example.invalid",
  phone_number: "+5500000000000",
  cpf: "00000000000",
  display_name: "Pessoa",
};
const contexto = {
  request_id: `f08-t07-${Date.now().toString(36)}`,
  organization_id: null,
  job_type: "f08-t07-teste",
  error_code: "F08Teste",
  ...PII,
};

async function main(): Promise<void> {
  const filtrado = capturarErro(
    new Error("F08-T07: evento de teste da produção inicial (sem PII)"),
    contexto,
  );
  const flushed = await Sentry.flush(10_000);

  const piiVazou = Object.keys(PII).filter((k) => Object.hasOwn(filtrado.captured, k)).length;
  if (!eventId || !flushed || piiVazou !== 0 || filtrado.kept !== CAMPOS_QUE_SAEM.length) {
    console.error(
      `sentry: FALHOU id=${eventId || "-"} flushed=${flushed ? 1 : 0} kept=${filtrado.kept}/${filtrado.existing} pii_fields=${piiVazou}/${Object.keys(PII).length}`,
    );
    process.exit(1);
  }
  console.info(
    `sentry: ok id=${eventId} community=false kept=${filtrado.kept}/${filtrado.existing} pii_fields=${piiVazou}/${Object.keys(PII).length} flushed=1/1`,
  );
}

void main();
