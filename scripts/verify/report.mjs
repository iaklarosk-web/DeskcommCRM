import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closedE2EPlan, hasClosedE2E, parseF02E2E, VERIFY_ENVIRONMENTS } from "./f02-e2e.mjs";

// Dívidas de c85f7d72 saneadas: não podem reaparecer nem em revalidação.
// As identidades e resultados históricos permanecem na evidência de ADR-007.
export const KNOWN_DEBT = [];
const integer = (n) => Number.isSafeInteger(n) && n >= 0;

/**
 * Fases com gate implementado. ADR-018 acrescenta F03 sem afrouxar nada: F03
 * herda TODOS os controles de F02 (sandbox descartável, snapshot SHA-256 dos
 * inputs, E2E fechado) e acrescenta o campo `webhook` medido.
 */
// ADR-033: F08 (produção inicial) fecha com o inventário de F12 e sem campo
// novo no bloco — a produção é medida pela linha `prod:` FORA dele (ADR-032 §4).
// ADR-037: F15 (automação/autonomia) fecha DEPOIS da F13 e mede a linha `autonomy:`.
// ADR-039: F14 (chat do site/agenda) fecha DEPOIS da F15 e mede a linha `channels:`.
const GATED_PHASES = ["F00", "F01", "F02", "F03", "F04", "F05", "F06", "F07", "F08", "F11", "F12", "F13", "F15", "F14"];

/** §8.3: cada campo passa a ser obrigatório a partir da fase que o cria. */
const phaseNumber = (phase) => Number(phase.slice(1));
const requiresWebhook = (phase) => phaseNumber(phase) >= phaseNumber("F03");
const requiresAiEval = (phase) => phaseNumber(phase) >= phaseNumber("F04");
const requiresHandoff = (phase) => phaseNumber(phase) >= phaseNumber("F05");
// ADR-028: hardening (F06) — `logs`, `rate-limit` e `lgpd` gravados pelas
// próprias suítes; `restore:` e `smoke:` ficam no BUILD-STATE, fora do bloco.
const requiresHardening = (phase) => phaseNumber(phase) >= phaseNumber("F06");
// ADR-029: a partir de F07 o navegador roda uma vez por tenant do seed e
// `replicability` deixa de ser `fictitious_A_B` para ser medido (§8.3).
const requiresReplicability = (phase) => phaseNumber(phase) >= phaseNumber("F07"); // MUTANT: replicability-required
// ADR-031: administração/entrada (F11) e assinatura/cobrança (F12), gravadas
// pelas suítes de integração via `gravarLinhaDoVerify`; `pending` antes.
// ADR-033: a F08 fecha DEPOIS de F11/F12 (D51 a, D52) e herda os dois campos;
// a ordem de fechamento, não o número da fase, decide o que é obrigatório.
// ADR-035: a F13 (CRM comercial) fecha DEPOIS da F08 e mede a linha `crm:`;
// ADR-037: a F15 fecha DEPOIS da F13 e mede `autonomy:`; ADR-039: a F14 fecha
// DEPOIS da F15 e mede `channels:`. Fases fora da ordem escrita (F09, F10,
// F16+) contam pelo número contra a ÚLTIMA fase da ordem.
const CLOSING_ORDER = ["F00", "F01", "F02", "F03", "F04", "F05", "F06", "F07", "F11", "F12", "F08", "F13", "F15", "F14"];
const ULTIMA_DA_ORDEM = CLOSING_ORDER[CLOSING_ORDER.length - 1];
// Fase NA ordem escrita conta pela posição; fase FORA dela (F09, F10, F16+)
// conta pelo número contra a última da ordem. As duas cláusulas não se somam:
// com a F14 no fim, a F15 (número maior, posição menor) herdaria `channels:`
// pela cláusula numérica — e a F15 fechou ANTES da F14 (ADR-039 §1).
const closesAtOrAfter = (phase, ref) => (CLOSING_ORDER.includes(phase)
  ? CLOSING_ORDER.indexOf(phase) >= CLOSING_ORDER.indexOf(ref)
  : phaseNumber(phase) > phaseNumber(ULTIMA_DA_ORDEM));
const requiresAdmin = (phase) => closesAtOrAfter(phase, "F11"); // MUTANT: admin-required
const requiresBilling = (phase) => closesAtOrAfter(phase, "F12"); // MUTANT: billing-required
const requiresCrm = (phase) => closesAtOrAfter(phase, "F13"); // MUTANT: crm-required
const requiresAutonomy = (phase) => closesAtOrAfter(phase, "F15"); // MUTANT: autonomy-required
const requiresChannels = (phase) => closesAtOrAfter(phase, "F14"); // MUTANT: channels-required
// ADR-035 §3: a matriz D15 é propriedade da ÁRVORE — quatro papéis a partir
// da F13 (ADR-034 §2 T02), medidos pela fase ativa, não pela fase pedida.
const papeisEsperados = (phase) => (closesAtOrAfter(phase, "F13") ? 4 : 3);

export function phaseContext(state, requestedPhase) {
  const active = /^current_phase:\s*(F\d{2})\b/m.exec(state)?.[1];
  if (!active) throw new Error("BUILD-STATE sem current_phase válido");
  const phase = requestedPhase ?? active;
  if (!/^F\d{2}$/.test(phase)) throw new Error("Fase inválida");
  if (requestedPhase && !new RegExp(`^\\| ${phase} \\|[^\\n]+\\| done\\(verify=`, "m").test(state)) {
    throw new Error(`Revalidação exige fase concluída no BUILD-STATE: ${phase}`);
  }
  const total = Number(/^baseline_n0:\s*(\d+)/m.exec(state)?.[1]);
  const detail = /^baseline_detail:\s*(.+)$/m.exec(state)?.[1] ?? "";
  const unit = Number(/\bunit=(\d+)\//.exec(detail)?.[1]);
  const db = Number(/\bdb=(\d+)\//.exec(detail)?.[1]);
  const baselineCommit = /^f00_commit:\s*([a-f0-9]{7,40})\b/m.exec(state)?.[1];
  if (![total, unit, db].every((n) => integer(n) && n > 0) || total < unit + db || !baselineCommit) {
    throw new Error("Baseline F00 ausente/inválido; não há denominador comparável");
  }
  return { active, phase, revalidation: Boolean(requestedPhase), baseline: { total, unit, db, commit: baselineCommit } };
}

export function parseSuite(report, suite, root) {
  if (!report || !Array.isArray(report.testResults)) throw new Error(`${suite}: relatório ausente/inválido`);
  const counters = ["numTotalTests", "numPassedTests", "numFailedTests", "numPendingTests", "numTodoTests", "numFailedTestSuites"];
  if (!counters.every((key) => integer(report[key]))) throw new Error(`${suite}: contagem inválida`);
  const result = { passed: 0, total: 0, failed: 0, skipped: 0, pending: 0, expectedFailures: 0, debt: [], errors: [] };
  for (const file of report.testResults) {
    if (!Array.isArray(file.assertionResults) || typeof file.name !== "string") throw new Error(`${suite}: arquivo de resultado inválido`);
    if (file.status !== "passed") result.errors.push(`${suite}: módulo falhou: ${file.name}`);
    for (const test of file.assertionResults) {
      if (typeof test.meta?.verifyExpectedFailure !== "boolean") {
        throw new Error(`${suite}: resultado sem metadata do reporter de verificação`);
      }
      result.total++;
      const identity = { suite, file: path.relative(root, file.name).split(path.sep).join("/"), title: test.title };
      if (test.status === "passed") {
        if (test.meta?.verifyExpectedFailure === true) {
          result.expectedFailures++;
          result.debt.push({ ...identity, kind: "expected_failure" });
        } else result.passed++;
      } else if (test.status === "failed") result.failed++;
      else if (["skipped", "todo", "disabled"].includes(test.status)) {
        result.skipped++;
        result.debt.push({ ...identity, kind: test.status });
      } else result.pending++;
    }
  }
  if (result.total === 0 || result.total !== report.numTotalTests ||
      result.passed + result.expectedFailures !== report.numPassedTests || result.failed !== report.numFailedTests ||
      result.skipped + result.pending !== report.numPendingTests + report.numTodoTests) {
    throw new Error(`${suite}: denominadores inconsistentes ou vazios`);
  }
  if (report.success !== true || report.numFailedTestSuites > 0 || result.failed > 0 || result.pending > 0) {
    result.errors.push(`${suite}: falha ou execução incompleta`);
  }
  return result;
}

export function evaluate(input) {
  const errors = [];
  const debt = [];
  const suites = {};
  const context = input.context;
  if (!GATED_PHASES.includes(context.phase)) errors.push(`Fase ${context.phase} ainda sem gate completo; requisitos posteriores pendentes`);
  for (const name of ["typecheck", "lint", "build", "shell", "secrets"]) {
    if (input.exits[name] !== 0) errors.push(`${name}: comando falhou ou não executou`);
  }
  for (const name of ["unit", "integration", "db"]) {
    if (input.exits[name] !== 0) errors.push(`${name}: comando falhou ou não executou`);
    try {
      const parsed = parseSuite(input.reports[name], name, input.root);
      suites[name] = parsed;
      errors.push(...parsed.errors);
      debt.push(...parsed.debt);
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (hasClosedE2E(context.phase)) {
    for (const name of ["inputs-before", "sandbox", "e2e-plan", "e2e", "inputs"]) {
      if (input.exits[name] !== 0) errors.push(`${name}: comando falhou ou não executou`);
    }
    const inputs = input.inputs;
    if (!inputs || inputs.ok !== true || inputs.algorithm !== "sha256" ||
        !integer(inputs.files_before) || inputs.files_before < 1 || inputs.files_after !== inputs.files_before ||
        typeof inputs.hash_before !== "string" || !/^[a-f0-9]{64}$/.test(inputs.hash_before) ||
        inputs.hash_after !== inputs.hash_before) {
      errors.push("inputs: snapshot ausente, inválido ou árvore alterada durante o gate");
    }
    // ADR-028: dois ambientes aceitos, cada um com marcador e portas próprios.
    // A evidência diz qual foi; `environment` sai no bloco e decide o rótulo.
    const sandbox = input.sandbox;
    const perfil = sandbox && Object.hasOwn(VERIFY_ENVIRONMENTS, sandbox.environment ?? "sandbox")
      ? VERIFY_ENVIRONMENTS[sandbox.environment ?? "sandbox"] : null;
    if (!sandbox || !perfil || sandbox.ok !== true || sandbox.sandbox !== perfil.marker ||
        sandbox.api !== `loopback:${perfil.api}` || sandbox.database !== `loopback:${perfil.db}/postgres` ||
        sandbox.app !== `loopback:${perfil.app}` || sandbox.providers?.whatsapp !== "mock" ||
        sandbox.providers?.ai !== "mock" || sandbox.credentials?.anon !== "present" ||
        sandbox.credentials?.service_role !== "present") {
      errors.push("sandbox: evidência segura ausente ou inválida");
    }
    try {
      const parsed = parseF02E2E(input.reports["e2e-plan"], input.reports.e2e, input.root, context.phase);
      suites.e2e = parsed;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "e2e: relatório inválido");
    }
  }
  // ADR-029 §1: cada tenant do seed tem a própria execução do inventário
  // inteiro, conferida contra o MESMO plano; src/ não pode ter mudado entre
  // a primeira e a última. Sem a evidência, a fase é NOT READY.
  const tenantRuns = {};
  if (requiresReplicability(context.phase)) {
    const rep = input.replicability;
    const plan = hasClosedE2E(context.phase) ? closedE2EPlan(context.phase) : null;
    const expectedTenants = plan?.tenants ?? [];
    const tenants = Array.isArray(rep?.tenants) ? rep.tenants.map((t) => t?.slug) : [];
    if (input.exits.replicability !== 0) errors.push("replicability: comando falhou ou não executou");
    if (!rep || rep.ok !== true || !integer(rep.src_diff_lines) || rep.src_diff_lines !== 0 ||
        typeof rep.src_tree_before !== "string" || !/^[a-f0-9]{40}$/.test(rep.src_tree_before) ||
        rep.src_tree_after !== rep.src_tree_before ||
        JSON.stringify(tenants) !== JSON.stringify([...expectedTenants])) {
      errors.push(`replicability: evidência ausente ou fora do contrato (exige e2e em ${expectedTenants.join(" e ")} sem mudança em src/)`);
    }
    for (const slug of expectedTenants) {
      if (input.exits[`e2e-${slug}`] !== 0) errors.push(`e2e-${slug}: comando falhou ou não executou`);
      try {
        tenantRuns[slug] = parseF02E2E(input.reports["e2e-plan"], input.reports[`e2e-${slug}`], input.root, context.phase);
      } catch (error) {
        errors.push(`e2e[${slug}]: ${error instanceof Error ? error.message : "relatório inválido"}`);
      }
    }
  }
  const unknownDebt = debt.filter((entry) => !KNOWN_DEBT.some((known) => Object.keys(known).every((key) => known[key] === entry[key])));
  if (unknownDebt.length > 0) errors.push(`Dívida nova ou não reconhecida: ${unknownDebt.length}`);
  if (new Set(debt.map((entry) => JSON.stringify(entry))).size !== debt.length) errors.push("Identidade de dívida duplicada");
  if (!context.revalidation && debt.length > 0) errors.push(`DoD exige ausência de dívida: ${debt.length}`);
  const corePassed = (suites.unit?.passed ?? 0) + (suites.db?.passed ?? 0);
  const baselineCore = context.baseline.unit + context.baseline.db;
  if (corePassed < baselineCore) errors.push(`Regressão no baseline comparável unit+db: ${corePassed}/${baselineCore}`);
  for (const suite of ["unit", "db"]) {
    if ((suites[suite]?.passed ?? 0) < context.baseline[suite]) errors.push(`Baseline de ${suite} diminuiu`);
  }
  for (const key of ["testsDeleted", "tenantReferences"]) {
    if (input[key] !== 0) errors.push(`${key}: deve ser zero (medido=${input[key] ?? "pending"})`);
  }
  if (!integer(input.mutants?.total) || input.mutants.total < 1 || input.mutants.killed !== input.mutants.total) errors.push("Mutante ausente ou vivo");

  function metric(name, fields) {
    const line = input.metrics[name];
    if (typeof line !== "string" || !line.startsWith(`${name}: `) || /pending/.test(line)) {
      errors.push(`Métrica obrigatória ausente: ${name}`); // MUTANT: required-metric
      return null;
    }
    const numbers = {};
    for (const field of fields) {
      const values = [...line.matchAll(new RegExp(`\\b${field}=(\\d+)(?=\\s|[)/]|$)`, "g"))];
      if (values.length !== 1) {
        errors.push(`Métrica inválida: ${name}.${field}`);
        return null;
      }
      numbers[field] = Number(values[0][1]);
      if (!integer(numbers[field])) errors.push(`Métrica fora de faixa: ${name}.${field}`);
    }
    return numbers;
  }
  const sec = metric("secrets", ["files_scanned", "findings"]);
  if (sec && (sec.files_scanned < 1 || sec.findings !== 0)) errors.push("Segredos: varredura vazia ou achados");
  if (context.phase !== "F00") {
    const isolation = metric("isolation", ["tables", "ops", "dirs", "leaks"]);
    const rls = metric("rls-coverage", ["tables_with_org_id", "policies_found", "missing", "service_only_with_grant"]);
    const rbac = metric("rbac", ["roles", "denied_expected", "denied_actual"]);
    const entitlement = metric("entitlement", ["usage_events_written"]);
    if (isolation && (isolation.tables < 1 || isolation.ops !== 4 || isolation.dirs !== 2 || isolation.leaks !== 0)) errors.push("Isolamento fora do contrato");
    if (rls && (rls.tables_with_org_id < 1 || rls.policies_found < 1 || rls.missing !== 0 || rls.service_only_with_grant !== 0)) errors.push("Cobertura de RLS fora do contrato");
    if (isolation && rls && isolation.tables !== rls.tables_with_org_id) errors.push("Denominadores de isolamento/RLS divergem");
    if (rbac && (rbac.roles !== papeisEsperados(context.active) || rbac.denied_expected < 1 || rbac.denied_expected !== rbac.denied_actual)) errors.push("RBAC fora do contrato");
    if (entitlement && entitlement.usage_events_written < 2) errors.push("Entitlement sem prova mínima de uso");
  }
  // §8.3: mesma fixture 2x; linhas criadas em cada uma das T tabelas do
  // pipeline. `stored=1` é o contrato — a segunda entrega não grava mensagem.
  if (requiresWebhook(context.phase)) {
    const webhook = metric("webhook", ["replay", "stored", "tables_checked"]);
    if (webhook && (webhook.replay < 2 || webhook.stored !== 1 || webhook.tables_checked < 4)) {
      errors.push("Webhook fora do contrato: exige replay>=2, stored=1, tables_checked>=4");
    }
  }
  // §8.3: `cases>=30 pass=cases`, `unknown=6 injection=10 cross_tenant=5` e
  // `provider_calls_at_zero_balance=0`. O dublê de saldo zero é o que separa
  // "o agente respeita o entitlement" de "o entitlement nunca disse não".
  if (requiresAiEval(context.phase)) {
    const ai = metric("ai_eval", [
      "cases", "pass", "unknown", "injection", "cross_tenant", "provider_calls_at_zero_balance",
    ]);
    if (ai && (ai.cases < 30 || ai.pass !== ai.cases || ai.unknown !== 6 ||
        ai.injection !== 10 || ai.cross_tenant !== 5 || ai.provider_calls_at_zero_balance !== 0)) {
      errors.push("ai_eval fora do contrato: exige cases>=30, pass=cases, unknown=6, injection=10, cross_tenant=5, provider_calls_at_zero_balance=0");
    }
    // "≥ casos normais do dataset de F04 em diante" (§8.3, linha entitlement).
    const uso = metric("entitlement", ["usage_events_written"]);
    if (uso && uso.usage_events_written < 6) {
      errors.push("Entitlement abaixo dos casos normais do dataset a partir de F04");
    }
  }
  // §8.3: `handoff` sobre os H handoffs da suíte (H>=3) e `reminder` com o job
  // rodado duas vezes no mesmo período. `handoffs` é o denominador: sem ele,
  // `ai_msgs_after_handoff=0` passaria numa suíte que não produziu handoff
  // nenhum — zero sem denominador não é resultado (G-03).
  if (requiresHandoff(context.phase)) {
    const ho = metric("handoff", ["handoffs", "ai_msgs_after_handoff", "summary", "assignee", "notify"]);
    if (ho && (ho.handoffs < 3 || ho.ai_msgs_after_handoff !== 0 || ho.summary !== 7 ||
        ho.assignee !== ho.handoffs || ho.notify !== ho.handoffs)) {
      errors.push("handoff fora do contrato: exige handoffs>=3, ai_msgs_after_handoff=0, summary=7/7, assignee e notify iguais a handoffs");
    }
    const rem = metric("reminder", ["runs", "sent", "duplicates"]);
    if (rem && (rem.runs !== 2 || rem.sent !== 1 || rem.duplicates !== 0)) {
      errors.push("reminder fora do contrato: exige runs=2, sent=1, duplicates=0");
    }
  }
  // ADR-028 §1: as três métricas do hardening, obrigatórias a partir de F06.
  if (requiresHardening(context.phase)) {
    const logs = metric("logs", ["routes", "routes_logged", "workers", "workers_logged", "request_log_org_id", "sentry_mock_captured", "pii_fields"]);
    if (logs && (logs.routes < 200 || logs.routes_logged !== logs.routes || logs.workers < 4 ||
        logs.workers_logged !== logs.workers || logs.request_log_org_id !== 1 || logs.sentry_mock_captured < 1 ||
        logs.pii_fields !== 4)) {
      errors.push("logs fora do contrato: exige routes_logged=routes (>=200), workers_logged=workers (>=4), request_log_org_id=1, sentry_mock_captured>=1, pii_fields=4");
    }
    const rl = metric("rate-limit", ["requests", "status_429", "auth_requests", "auth_blocked", "routes", "routes_with_schema", "routes_reading_input", "validated"]);
    if (rl && (rl.requests < 101 || rl.status_429 < 1 || rl.auth_requests < 101 || rl.auth_blocked < 1 ||
        rl.routes < 200 || rl.routes_with_schema !== rl.routes || rl.validated !== rl.routes_reading_input)) {
      errors.push("rate-limit fora do contrato: exige requests>=101, status_429>=1, auth_blocked>=1, routes_with_schema=routes, validated=routes_reading_input");
    }
    const lgpd = metric("lgpd", ["tables", "rows", "rows_remaining", "audit_rows"]);
    if (lgpd && (lgpd.tables < 5 || lgpd.rows < 5 || lgpd.rows_remaining !== 0 || lgpd.audit_rows !== 2)) {
      errors.push("lgpd fora do contrato: exige tables>=5, rows>=5, rows_remaining=0, audit_rows=2");
    }
  }
  // ADR-031 §1: a administração e a entrada guiada (F11). `support_reason` e
  // `full_mode_rejected` são o que D39/D51 pedem ("motivo", "só leitura");
  // `orgs_without_subscription=0` é a garantia de D38 sobre as fixtures.
  if (requiresAdmin(context.phase)) {
    const adm = metric("admin", ["tenants_listed", "support_sessions", "support_reason", "support_scope_denied", "support_writes_denied", "full_mode_rejected", "signup_awaiting_payment", "orgs_without_subscription"]);
    if (adm && (adm.tenants_listed < 2 || adm.support_sessions < 2 || adm.support_reason !== adm.support_sessions ||
        adm.support_scope_denied < 2 || adm.support_writes_denied < 4 || adm.full_mode_rejected !== 1 ||
        adm.signup_awaiting_payment !== 1 || adm.orgs_without_subscription !== 0)) {
      errors.push("admin fora do contrato: exige tenants_listed>=2, support_sessions>=2 com support_reason=support_sessions, support_scope_denied>=2, support_writes_denied>=4, full_mode_rejected=1, signup_awaiting_payment=1, orgs_without_subscription=0");
    }
  }
  // ADR-031 §2: a assinatura (F12). `duplicates=1` e `out_of_order=1` são as
  // duas entregas que NÃO podem ativar de novo; `activations=1` é o
  // denominador; `reconciliation_mismatch=0` e `data_preserved` são D44.
  if (requiresBilling(context.phase)) {
    const bil = metric("billing", ["plans", "events", "duplicates", "out_of_order", "activations", "blocked_writes_denied", "grace_days", "reconciliation_mismatch", "cancellations", "data_preserved"]);
    if (bil && (bil.plans < 3 || bil.events < 4 || bil.duplicates < 1 || bil.out_of_order < 1 || bil.activations !== 1 ||
        bil.blocked_writes_denied < 4 || bil.grace_days < 1 || bil.reconciliation_mismatch !== 0 || bil.cancellations !== 1 ||
        bil.data_preserved < 1)) {
      errors.push("billing fora do contrato: exige plans>=3, events>=4, duplicates>=1, out_of_order>=1, activations=1, blocked_writes_denied>=4, grace_days>=1, reconciliation_mismatch=0, cancellations=1, data_preserved>=1");
    }
  }
  // ADR-035 §2: o CRM comercial (F13). Cada campo é uma jornada com
  // denominador; `balanced=1` é o rodízio de verdade, `values_preserved` é
  // "evolução preserva dados", `report_indicators` é "indicador confere com a
  // origem" (§7.9).
  if (requiresCrm(context.phase)) {
    const crm = metric("crm", ["fields_defined", "values_rejected", "values_preserved", "queue_size", "distributed", "balanced", "second_claim_rejected", "history_types", "orders_linked", "cross_org_link_denied", "report_indicators", "roles_denied"]);
    const den = (field) => {
      const m = new RegExp(`\\b${field}=(\\d+)/(\\d+)`).exec(input.metrics.crm ?? "");
      return m ? Number(m[2]) : null;
    };
    if (crm && (crm.fields_defined < 4 || crm.values_rejected < 3 || crm.values_rejected !== den("values_rejected") ||
        crm.values_preserved < 1 || crm.values_preserved !== den("values_preserved") || crm.queue_size < 3 ||
        crm.distributed !== crm.queue_size || crm.distributed !== den("distributed") || crm.balanced !== 1 ||
        crm.second_claim_rejected !== 1 || crm.history_types < 3 || crm.orders_linked !== 1 || crm.cross_org_link_denied !== 1 ||
        crm.report_indicators < 8 || crm.report_indicators !== den("report_indicators") || crm.roles_denied < 3 ||
        crm.roles_denied !== den("roles_denied"))) {
      errors.push("crm fora do contrato: exige fields_defined>=4, values_rejected>=3 (=denominador), values_preserved=denominador (>=1), queue_size>=3, distributed=queue_size, balanced=1, second_claim_rejected=1, history_types>=3, orders_linked=1, cross_org_link_denied=1, report_indicators>=8 (=denominador), roles_denied>=3 (=denominador)");
    }
  }
  // ADR-037 §2: automação e autonomia (F15). `policy_modes=4/4` é D40
  // (permitir/aprovar/bloquear/transferir respeitados), `calls_after_limit=0/K`
  // é "limites" com denominador, `duplicate_runs=0` ao lado de `replays` é
  // "repetição segura", `outside_catalog_denied` é "nenhum efeito fora da
  // política" (§7.9).
  if (requiresAutonomy(context.phase)) {
    const aut = metric("autonomy", ["policy_modes", "ai_task_created", "limit_hits", "calls_after_limit", "paused", "resumed", "handoffs", "balanced", "assignees_distinct", "rules", "runs", "replays", "duplicate_runs", "outside_catalog_denied", "reindexed", "unchanged_skipped", "sources_cited", "roles_denied"]);
    const den = (field) => {
      const m = new RegExp(`\\b${field}=(\\d+)/(\\d+)`).exec(input.metrics.autonomy ?? "");
      return m ? Number(m[2]) : null;
    };
    if (aut && (aut.policy_modes !== 4 || den("policy_modes") !== 4 || aut.ai_task_created !== 1 || aut.limit_hits !== 1 ||
        aut.calls_after_limit !== 0 || !(den("calls_after_limit") >= 3) || aut.paused !== 1 || aut.resumed !== 1 ||
        aut.handoffs < 3 || aut.balanced !== 1 || aut.assignees_distinct < 2 || aut.rules < 4 ||
        aut.runs !== aut.rules || aut.runs !== den("runs") || aut.replays < aut.rules || aut.duplicate_runs !== 0 ||
        aut.outside_catalog_denied !== 1 || aut.reindexed < 1 || aut.reindexed !== den("reindexed") ||
        aut.unchanged_skipped < 1 || aut.unchanged_skipped !== den("unchanged_skipped") ||
        aut.sources_cited < 1 || aut.sources_cited !== den("sources_cited") ||
        aut.roles_denied < 3 || aut.roles_denied !== den("roles_denied"))) {
      errors.push("autonomy fora do contrato: exige policy_modes=4/4, ai_task_created=1, limit_hits=1, calls_after_limit=0/K (K>=3), paused=1, resumed=1, handoffs>=3, balanced=1, assignees_distinct>=2, rules>=4, runs=rules (=denominador), replays>=rules, duplicate_runs=0, outside_catalog_denied=1, reindexed/unchanged_skipped/sources_cited >=1 (=denominador), roles_denied>=3 (=denominador)");
    }
  }
  // ADR-039 §2: canais e agenda (F14). `cross_org_denied` é "mensagens e
  // eventos reais isolados por empresa", `conflicts_blocked`/`tz_ok` é
  // "disponibilidade, fuso e conflitos", `flood_calls_capped` é o freio do
  // endpoint público (ADR-038 §6, objeção 2), `denied_by_policy` liga a
  // ferramenta de agenda à política da F15 (§7.9).
  if (requiresChannels(context.phase)) {
    const ch = metric("channels", ["webchat_sessions", "identified", "contacts_created", "messages_in", "ai_replies", "ai_outside_window", "handoff_queued", "ip_limited", "org_limited", "flood_calls_capped", "cross_org_denied", "appointments", "conflicts_blocked", "revoked_blocked", "tz_ok", "proposed", "approved", "denied_by_policy", "roles_denied"]);
    const den = (field) => {
      const m = new RegExp(`\\b${field}=(\\d+)/(\\d+)`).exec(input.metrics.channels ?? "");
      return m ? Number(m[2]) : null;
    };
    const exatos = ["ai_outside_window", "handoff_queued", "ip_limited", "org_limited", "flood_calls_capped", "cross_org_denied", "conflicts_blocked", "revoked_blocked", "tz_ok", "approved", "denied_by_policy"];
    const iguais = ["identified", "contacts_created", "ai_replies", "proposed"];
    if (ch && (ch.webchat_sessions < 3 || ch.messages_in < 3 || ch.appointments < 2 ||
        exatos.some((f) => ch[f] !== 1 || den(f) !== 1) ||
        iguais.some((f) => ch[f] < 1 || ch[f] !== den(f)) ||
        ch.roles_denied < 2 || ch.roles_denied !== den("roles_denied"))) {
      errors.push("channels fora do contrato: exige webchat_sessions>=3, messages_in>=3, appointments>=2, identified/contacts_created/ai_replies/proposed >=1 (=denominador), ai_outside_window/handoff_queued/ip_limited/org_limited/flood_calls_capped/cross_org_denied/conflicts_blocked/revoked_blocked/tz_ok/approved/denied_by_policy =1/1, roles_denied>=2 (=denominador)");
    }
  }
  const clean = errors.length === 0;
  // ADR-028 §2: a partir de F06, o gate limpo rodado no ambiente `staging`
  // sai `READY (staging)`; no sandbox sai `READY (Fnn)` — prova de código.
  const environment = input.sandbox?.environment ?? "sandbox";
  const staging = requiresHardening(context.phase) && environment === "staging";
  const status = !clean ? "NOT READY" : context.revalidation
    ? `${debt.length ? "REVALIDATED WITH DEBT" : "REVALIDATED"} (${context.phase})`
    : staging ? "READY (staging)" : `READY (${context.phase})`;
  return { status, exitCode: clean ? 0 : 1, errors, debt, suites, corePassed, baselineCore, environment, tenantRuns };
}

function read(file) {
  try { return readFileSync(file, "utf8").trim(); } catch { return null; }
}
function git(args, root) { return execFileSync("git", args, { cwd: root, encoding: "utf8" }); }

export function collect(root, directory, context) {
  const reports = {}, exits = {}, metrics = {};
  for (const name of ["typecheck", "lint", "build", "shell", "unit", "integration", "db", "secrets", "inputs-before", "sandbox", "e2e-plan", "e2e", "inputs"]) {
    const raw = read(path.join(directory, `${name}.exit`));
    exits[name] = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
  }
  for (const suite of ["unit", "integration", "db"]) {
    try { reports[suite] = JSON.parse(readFileSync(path.join(directory, `${suite}.json`), "utf8")); } catch { reports[suite] = null; }
  }
  for (const name of ["e2e-plan", "e2e"]) {
    try { reports[name] = JSON.parse(readFileSync(path.join(directory, `${name}.json`), "utf8")); } catch { reports[name] = null; }
  }
  // ADR-029: na F07 o navegador tem uma execução por tenant (`e2e-<slug>`);
  // `e2e` do bloco é a PRIMEIRA delas, e as demais entram em `replicability`.
  let replicability = null;
  try { replicability = JSON.parse(readFileSync(path.join(directory, "replicability.json"), "utf8")); } catch { replicability = null; }
  {
    const raw = read(path.join(directory, "replicability.exit"));
    exits.replicability = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
  }
  const tenantSlugs = Array.isArray(replicability?.tenants) ? replicability.tenants.map((t) => t?.slug).filter((s) => typeof s === "string") : [];
  for (const slug of tenantSlugs) {
    const name = `e2e-${slug}`;
    const raw = read(path.join(directory, `${name}.exit`));
    exits[name] = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
    try { reports[name] = JSON.parse(readFileSync(path.join(directory, `${name}.json`), "utf8")); } catch { reports[name] = null; }
  }
  if (tenantSlugs.length > 0 && exits.e2e === null && reports.e2e === null) {
    exits.e2e = exits[`e2e-${tenantSlugs[0]}`];
    reports.e2e = reports[`e2e-${tenantSlugs[0]}`];
  }
  let sandbox = null;
  try { sandbox = JSON.parse(readFileSync(path.join(directory, "sandbox.json"), "utf8")); } catch { sandbox = null; }
  let inputs = null;
  try { inputs = JSON.parse(readFileSync(path.join(directory, "inputs.json"), "utf8")); } catch { inputs = null; }
  // O nome do CAMPO e o nome do ARQUIVO divergem em `ai_eval` de propósito:
  // `gravarLinhaDoVerify` só aceita [a-z0-9-] no nome do arquivo (o underscore
  // reprova), enquanto §8.3 fixa o rótulo do campo com underscore. O mapa é o
  // único lugar onde essa diferença existe.
  const ARQUIVO_DA_METRICA = { ai_eval: "ai-eval" };
  for (const name of ["isolation", "rls-coverage", "rbac", "entitlement", "webhook", "ai_eval", "handoff", "reminder", "logs", "rate-limit", "lgpd", "admin", "billing", "crm", "autonomy", "channels"]) {
    metrics[name] = read(path.join(directory, "metrics", `${ARQUIVO_DA_METRICA[name] ?? name}.line`));
  }
  metrics.secrets = read(path.join(directory, "secrets.log"));
  let testsDeleted = null, tenantReferences = null, skipOnlyOccurrences = null;
  try {
    testsDeleted = git(["diff", "--diff-filter=D", "--name-only", context.baseline.commit, "--"], root)
      .split("\n").filter((file) => file.startsWith("tests/") || /\.(test|spec)\.[cm]?[jt]sx?$/.test(file)).length;
    const files = git(["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "src", "tests"], root).split("\0").filter(Boolean);
    tenantReferences = 0;
    skipOnlyOccurrences = 0;
    for (const file of new Set(files)) {
      const contents = readFileSync(path.join(root, file), "utf8");
      if (file.startsWith("src/") && /deka/i.test(contents)) tenantReferences++;
      skipOnlyOccurrences += [...contents.matchAll(/\.(?:skip|only)\(/g)].length;
    }
  } catch {
    testsDeleted = null; tenantReferences = null; skipOnlyOccurrences = null;
  }
  const mutantCounts = (read(path.join(directory, "mutants.count")) ?? "").split("/").map(Number);
  return { root, context, exits, reports, sandbox, inputs, replicability, metrics, testsDeleted, tenantReferences, skipOnlyOccurrences,
    mutants: { killed: mutantCounts[0], total: mutantCounts[1] } };
}

export function render(input, result) {
  const fraction = (name) => result.suites[name] ? `${result.suites[name].passed}/${result.suites[name].total}` : "pending";
  const ok = (name) => input.exits[name] === 0 ? "ok" : "fail";
  const closed = hasClosedE2E(input.context.phase);
  const expectedSuiteCount = closed ? 4 : 3;
  const count = (key) => Object.keys(result.suites).length === expectedSuiteCount
    ? Object.values(result.suites).reduce((sum, suite) => sum + suite[key], 0) : "pending";
  const e2e = result.suites.e2e;
  const requiredSpecs = closed ? closedE2EPlan(input.context.phase).specs.length : null;
  const specFraction = e2e ? `${e2e.specs}/${e2e.requiredSpecs}` : requiredSpecs ? `pending/${requiredSpecs}` : "pending";
  let replicability;
  if (requiresReplicability(input.context.phase)) {
    // ADR-029 §1: `ok` só com o inventário inteiro passado limpo naquele tenant.
    const tenants = closed ? closedE2EPlan(input.context.phase).tenants ?? [] : [];
    const runs = result.tenantRuns ?? {};
    const ok = (slug) => (runs[slug] ? "ok" : input.reports?.[`e2e-${slug}`] ? "fail" : "pending");
    const detail = tenants.map((slug) => `${slug}=${runs[slug] ? `${runs[slug].passed}/${runs[slug].total}` : "pending"}`).join(" ");
    const diff = integer(input.replicability?.src_diff_lines) ? input.replicability.src_diff_lines : "pending";
    replicability = `replicability: ${tenants.map((slug) => `e2e[${slug}]=${ok(slug)}`).join(" ")} src_diff_lines=${diff} grep_deka_in_src=${input.tenantReferences ?? "pending"} (${detail} specs=${specFraction} org_a=${input.replicability?.org_a ?? "pending"})`;
  } else {
    replicability = closed
      ? `replicability: e2e[fictitious_A_B]=${fraction("e2e")} specs=${specFraction} grep_deka_in_src=${input.tenantReferences ?? "pending"}`
      : `replicability: e2e[deka]=pending e2e[demo2]=pending src_diff_lines=pending grep_deka_in_src=${input.tenantReferences ?? "pending"}`;
  }
  return [
    "VERIFY SUMMARY",
    `scope=${input.context.revalidation ? "revalidation" : "phase"} phase=${input.context.phase} current_phase=${input.context.active} environment=${result.environment ?? "sandbox"}`,
    `build=${ok("build")} lint=${ok("lint")} typecheck=${ok("typecheck")} shell=${ok("shell")}`,
    `unit=${fraction("unit")} integration=${fraction("integration")} db=${fraction("db")} e2e=${fraction("e2e")} baseline_n0=${input.context.baseline.total}`,
    `baseline_comparable: scope=unit+db passed=${result.corePassed} required=${result.baselineCore} full_n0=pending`,
    `e2e_scope: ${input.context.phase}-required passed=${fraction("e2e")} specs=${specFraction}`,
    ...["isolation", "rls-coverage", "rbac", "entitlement"].map((name) => input.metrics[name] ?? `${name}: pending`),
    input.metrics.ai_eval ?? "ai_eval: cases=pending pass=pending unknown=pending injection=pending cross_tenant=pending provider_calls_at_zero_balance=pending",
    input.metrics.handoff ?? "handoff: ai_msgs_after_handoff=pending summary=pending assignee=pending notify=pending",
    input.metrics.reminder ?? "reminder: runs=pending sent=pending duplicates=pending",
    input.metrics.webhook ?? "webhook: replay=pending stored=pending tables_checked=pending",
    input.metrics.logs ?? "logs: routes=pending routes_logged=pending workers=pending workers_logged=pending request_log_org_id=pending sentry_mock_captured=pending pii_fields=pending",
    input.metrics["rate-limit"] ?? "rate-limit: requests=pending status_429=pending auth_requests=pending auth_blocked=pending routes=pending routes_with_schema=pending routes_reading_input=pending validated=pending",
    input.metrics.lgpd ?? "lgpd: tables=pending rows=pending rows_remaining=pending audit_rows=pending",
    input.metrics.admin ?? "admin: tenants_listed=pending support_sessions=pending support_reason=pending support_scope_denied=pending support_writes_denied=pending full_mode_rejected=pending signup_awaiting_payment=pending orgs_without_subscription=pending",
    input.metrics.billing ?? "billing: plans=pending events=pending duplicates=pending out_of_order=pending activations=pending blocked_writes_denied=pending grace_days=pending reconciliation_mismatch=pending cancellations=pending data_preserved=pending",
    input.metrics.crm ?? "crm: fields_defined=pending values_rejected=pending values_preserved=pending queue_size=pending distributed=pending balanced=pending second_claim_rejected=pending history_types=pending orders_linked=pending cross_org_link_denied=pending report_indicators=pending roles_denied=pending",
    input.metrics.autonomy ?? "autonomy: policy_modes=pending ai_task_created=pending limit_hits=pending calls_after_limit=pending paused=pending resumed=pending handoffs=pending balanced=pending assignees_distinct=pending rules=pending runs=pending replays=pending duplicate_runs=pending outside_catalog_denied=pending reindexed=pending unchanged_skipped=pending sources_cited=pending roles_denied=pending",
    input.metrics.channels ?? "channels: webchat_sessions=pending identified=pending contacts_created=pending messages_in=pending ai_replies=pending ai_outside_window=pending handoff_queued=pending ip_limited=pending org_limited=pending flood_calls_capped=pending cross_org_denied=pending appointments=pending conflicts_blocked=pending revoked_blocked=pending tz_ok=pending proposed=pending approved=pending denied_by_policy=pending roles_denied=pending",
    replicability,
    input.metrics.secrets ?? "secrets: pending",
    `tests_deleted=${input.testsDeleted ?? "pending"} tests_skipped=${count("skipped")} expected_failures=${count("expectedFailures")} tests_failed=${count("failed")} tests_pending=${count("pending")} mutants_killed=${input.mutants.killed ?? "pending"}/${input.mutants.total ?? "pending"}`,
    `debt_known=${result.debt.filter((entry) => KNOWN_DEBT.some((known) => Object.keys(known).every((key) => known[key] === entry[key]))).length} skip_only_occurrences=${input.skipOnlyOccurrences ?? "pending"} violations=${result.errors.length}`,
    ...result.debt.map((entry) => `debt: ${entry.suite} ${entry.kind} ${entry.file} :: ${entry.title}`),
    ...result.errors.map((error) => `violation: ${error}`),
    `STATUS: ${result.status}`,
  ].join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, root, directory, phase] = process.argv.slice(2);
  try {
    const context = phaseContext(readFileSync(path.join(root, "BUILD-STATE.md"), "utf8"), phase);
    if (mode === "context") {
      process.stdout.write(JSON.stringify(context));
    } else if (mode === "report") {
      const input = collect(root, directory, context);
      const result = evaluate(input);
      writeFileSync(path.join(directory, "summary.json"), JSON.stringify({ ...result, context, metrics: input.metrics }, null, 2));
      process.stdout.write(`${render(input, result)}\n`);
      process.exitCode = result.exitCode;
    } else throw new Error("Modo inválido");
  } catch (error) {
    process.stderr.write(`[verify] ${error.message}\n`);
    process.stdout.write("VERIFY SUMMARY\nSTATUS: NOT READY\n");
    process.exitCode = 1;
  }
}
