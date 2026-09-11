/**
 * F03-T07/T08 — a fila de saída é do BANCO, não do TypeScript.
 *
 * O que este arquivo mede, e por que precisa de Postgres: os dois CHECKs de
 * `job_queue` passaram a aceitar `outbound_message` e `blocked` SEM perder
 * nenhum valor herdado (os dois lados são contados, com denominador — provar só
 * o valor novo aprovaria uma constraint que tivesse jogado `dead` fora), a
 * CHECK de coerência `kind ⇔ contact_id` continua de pé, `job_runs` é
 * `service_only` de verdade (D35) e o índice de tentativa recusa a segunda
 * linha do mesmo par.
 *
 * Cada bloco imprime contagem COM denominador (G-14).
 */
import { beforeAll, describe, expect, it } from "vitest";

import { motivoDoErro, sql } from "@/tests/invariants/psql-transporte";

const ORG = "f0300007-0000-4000-8000-000000000001";
const CONTATO = "f0300007-2000-4000-8000-000000000001";
const JOB_DA_TENTATIVA = "f0300007-5000-4000-8000-000000000001";

/**
 * Os kinds do vocabulário DEPOIS da 9016. Os oito primeiros são herdados; o
 * nono é o desta task. A lista é a AFIRMAÇÃO do teste — o denominador sai dela,
 * não de uma contagem que o próprio banco devolveria (que concordaria com
 * qualquer coisa que estivesse lá).
 */
const KINDS_HERDADOS = [
  "inbound_turn",
  "followup_turn",
  "watchdog",
  "flywheel",
  "case_reply_turn",
  "operator_turn",
  "transactional_delivery",
  "approved_reply",
] as const;
const KIND_NOVO = "outbound_message";

/** Os kinds que a CHECK de coerência EXIGE ter contato. */
const KINDS_COM_CONTATO = new Set<string>([
  "inbound_turn",
  "followup_turn",
  "case_reply_turn",
  "operator_turn",
  "transactional_delivery",
  "approved_reply",
]);

const STATUS_HERDADOS = ["pending", "running", "done", "failed", "dead"] as const;
const STATUS_NOVO = "blocked";

const INDICE_DE_TENTATIVA = "job_runs_org_job_attempt_unique";
const INDICE_DE_IDEMPOTENCIA = "job_queue_outbound_message_uk";

/** `true` quando o script rodou sem erro; `false` quando o Postgres recusou. */
function aceita(script: string): boolean {
  try {
    sql(script);
    return true;
  } catch {
    return false;
  }
}

function inserirJob(id: string, kind: string, status = "pending"): string {
  const contato = KINDS_COM_CONTATO.has(kind) ? `'${CONTATO}'` : "null";
  return `insert into public.job_queue (id, organization_id, contact_id, kind, status, payload)
          values ('${id}','${ORG}',${contato},'${kind}','${status}','{}'::jsonb);`;
}

beforeAll(() => {
  sql(`
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG}','f03-t07-fila','F03 T07 Fila de saida','F03 T07');
    insert into public.contacts (id, organization_id, display_name, phone_number)
      values ('${CONTATO}','${ORG}','Contato F03 T07','+5511900000007');
  `);
});

describe("F03-T07 — o CHECK de job_queue.kind cresceu sem perder nada", () => {
  it("aceita os oito kinds herdados E o outbound_message", () => {
    // Arrange + Act — um insert por kind, cada um no seu id.
    const aceitos = [...KINDS_HERDADOS, KIND_NOVO].filter((kind, i) =>
      aceita(inserirJob(`f0300007-6000-4000-8000-${String(i).padStart(12, "0")}`, kind)),
    );

    // Assert — os dois lados, com denominador: o novo sozinho não prova nada.
    const herdados = aceitos.filter((k) => k !== KIND_NOVO).length;
    const novos = aceitos.filter((k) => k === KIND_NOVO).length;
    expect(
      herdados,
      `a 9016 ESTREITOU job_queue.kind: kinds herdados aceitos=${herdados}/${KINDS_HERDADOS.length}`,
    ).toBe(KINDS_HERDADOS.length);
    expect(novos, "job_queue.kind não aceitou outbound_message").toBe(1);

    // Controle negativo: o instrumento tem de saber REPROVAR.
    const inventado = aceita(
      inserirJob("f0300007-6000-4000-8000-000000000099", "kind_que_nao_existe"),
    );
    expect(inventado, "o CHECK de kind virou letra morta: aceitou valor inventado").toBe(false);

    console.log(
      `f03-t07-kind: herdados=${herdados}/${KINDS_HERDADOS.length} novo=${novos}/1 inventado_recusado=1/1`,
    );
  });
});

describe("F03-T07 — o CHECK de job_queue.status cresceu sem perder `dead`", () => {
  it("aceita os cinco status herdados E o blocked", () => {
    // Arrange + Act
    const aceitos = [...STATUS_HERDADOS, STATUS_NOVO].filter((status, i) =>
      aceita(
        inserirJob(`f0300007-7000-4000-8000-${String(i).padStart(12, "0")}`, "watchdog", status),
      ),
    );

    // Assert
    const herdados = aceitos.filter((s) => s !== STATUS_NOVO).length;
    const novos = aceitos.filter((s) => s === STATUS_NOVO).length;
    expect(
      herdados,
      `a 9016 ESTREITOU job_queue.status: herdados aceitos=${herdados}/${STATUS_HERDADOS.length}`,
    ).toBe(STATUS_HERDADOS.length);
    expect(novos, "job_queue.status não aceitou blocked").toBe(1);

    // `dead` por NOME: é o valor que uma leitura apressada da task trocaria
    // por `blocked`, e contá-lo junto dos outros esconderia justamente isso.
    const definicao = sql(
      `select pg_get_constraintdef(oid) from pg_constraint
        where conrelid='public.job_queue'::regclass and conname='job_queue_status_check';`,
    );
    expect(definicao, "job_queue_status_check perdeu 'dead'").toContain("'dead'");
    expect(definicao, "job_queue_status_check não ganhou 'blocked'").toContain("'blocked'");

    console.log(
      `f03-t07-status: herdados=${herdados}/${STATUS_HERDADOS.length} novo=${novos}/1 dead_presente=1/1`,
    );
  });
});

describe("F03-T07 — a coerência kind ⇔ contact_id continua valendo", () => {
  it("job de saída SEM contato passa; com contato é recusado; turno sem contato é recusado", () => {
    // Arrange — três afirmações, denominador três.
    const saidaSemContato = aceita(
      `insert into public.job_queue (organization_id, contact_id, kind, payload)
       values ('${ORG}', null, 'outbound_message', '{}'::jsonb);`,
    );
    const saidaComContato = aceita(
      `insert into public.job_queue (organization_id, contact_id, kind, payload)
       values ('${ORG}', '${CONTATO}', 'outbound_message', '{}'::jsonb);`,
    );
    const turnoSemContato = aceita(
      `insert into public.job_queue (organization_id, contact_id, kind, payload)
       values ('${ORG}', null, 'inbound_turn', '{}'::jsonb);`,
    );

    // Assert
    expect(saidaSemContato, "outbound_message com contact_id nulo foi recusado").toBe(true);
    expect(
      saidaComContato,
      "outbound_message com contato passou: a coerência kind/contact_id foi afrouxada",
    ).toBe(false);
    expect(turnoSemContato, "inbound_turn sem contato passou: a coerência foi afrouxada").toBe(
      false,
    );

    const certos = [saidaSemContato, !saidaComContato, !turnoSemContato].filter(Boolean).length;
    console.log(`f03-t07-coerencia: casos_certos=${certos}/3`);
  });
});

describe("F03-T07 — job_runs é service_only (D35)", () => {
  it("tem RLS ligada, zero policies e nenhum privilégio de cliente", () => {
    // Arrange
    const observado = sql(`
      select
        (select relrowsecurity::int from pg_class where oid='public.job_runs'::regclass) || '|' ||
        (select count(*) from pg_policies where schemaname='public' and tablename='job_runs') || '|' ||
        (select count(*) from pg_class c, aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
          where c.oid='public.job_runs'::regclass and a.grantee='anon'::regrole) || '|' ||
        (select count(*) from pg_class c, aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
          where c.oid='public.job_runs'::regclass and a.grantee='authenticated'::regrole) || '|' ||
        (select count(*) from pg_class c, aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
          where c.oid='public.job_runs'::regclass and a.grantee=0) || '|' ||
        (select least(count(*),1) from pg_class c, aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
          where c.oid='public.job_runs'::regclass and a.grantee='service_role'::regrole);
    `);

    // Assert — rls|policies|anon|authenticated|PUBLIC|service_role
    expect(observado, "job_runs fora do desenho service_only (D35/G-54)").toBe("1|0|0|0|0|1");
    console.log(
      "f03-t07-job-runs: rls=1/1 policies=0/0 anon=0/0 authenticated=0/0 public=0/0 service_role=1/1",
    );
  });
});

describe("F03-T08 — os índices que fazem a idempotência ser do banco", () => {
  it("o índice de tentativa recusa a segunda linha do mesmo (job_id, attempt)", () => {
    // Arrange
    sql(inserirJob(JOB_DA_TENTATIVA, "outbound_message"));
    sql(`insert into public.job_runs (organization_id, job_id, attempt)
         values ('${ORG}','${JOB_DA_TENTATIVA}',1);`);

    // Act
    let motivo = "";
    try {
      sql(`insert into public.job_runs (organization_id, job_id, attempt)
           values ('${ORG}','${JOB_DA_TENTATIVA}',1);`);
    } catch (erro) {
      motivo = motivoDoErro(erro);
    }

    // Assert — pelo NOME do índice: "deu erro" aprovaria um erro qualquer.
    expect(motivo, "a segunda tentativa 1 do mesmo job foi aceita").toContain(
      INDICE_DE_TENTATIVA,
    );

    // A tentativa 2 do MESMO job passa — o índice separa tentativas, não as proíbe.
    const segunda = aceita(
      `insert into public.job_runs (organization_id, job_id, attempt)
       values ('${ORG}','${JOB_DA_TENTATIVA}',2);`,
    );
    expect(segunda, "o índice bloqueou a tentativa 2, que é legítima").toBe(true);

    const linhas = sql(
      `select count(*)::int from public.job_runs where job_id='${JOB_DA_TENTATIVA}';`,
    );
    expect(linhas.trim()).toBe("2");
    console.log(`f03-t07-tentativa: duplicada_recusada=1/1 tentativas_distintas=2/2`);
  });

  it("o índice de idempotência recusa o segundo job da mesma mensagem", () => {
    // Arrange — o par (organização, message_id) é o árbitro.
    const mensagem = "f0300007-8000-4000-8000-000000000001";
    sql(`insert into public.job_queue (organization_id, contact_id, kind, payload)
         values ('${ORG}', null, 'outbound_message',
                 jsonb_build_object('organization_id','${ORG}','message_id','${mensagem}'));`);

    // Act
    let motivo = "";
    try {
      sql(`insert into public.job_queue (organization_id, contact_id, kind, payload)
           values ('${ORG}', null, 'outbound_message',
                   jsonb_build_object('organization_id','${ORG}','message_id','${mensagem}'));`);
    } catch (erro) {
      motivo = motivoDoErro(erro);
    }

    // Assert
    expect(motivo, "a fila aceitou dois jobs para a mesma mensagem").toContain(
      INDICE_DE_IDEMPOTENCIA,
    );

    // O índice é PARCIAL: job herdado (outro kind) não é tocado por ele.
    const herdado = aceita(
      `insert into public.job_queue (organization_id, contact_id, kind, payload)
       values ('${ORG}', '${CONTATO}', 'inbound_turn',
               jsonb_build_object('message_id','${mensagem}'));`,
    );
    expect(herdado, "o índice novo passou a bloquear job do motor herdado").toBe(true);

    console.log(`f03-t08-idempotencia: segundo_job_recusado=1/1 herdado_intocado=1/1`);
  });
});
