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
/**
 * A SEGUNDA organização, com o SEGUNDO usuário, existe para a prova
 * comportamental de RLS de `job_runs`: um tenant só provaria "este usuário não
 * alcança", e deixaria de fora a hipótese de o grant existir para UM deles.
 */
const ORG_B = "f0300007-0000-4000-8000-000000000002";
const USER_A = "f0300007-9000-4000-8000-000000000001";
const USER_B = "f0300007-9000-4000-8000-000000000002";
const CONTATO = "f0300007-2000-4000-8000-000000000001";
const JOB_DA_TENTATIVA = "f0300007-5000-4000-8000-000000000001";
/** Job usado só pelo controle positivo de `service_role` (guarda de vacuidade). */
const JOB_DA_VACUIDADE = "f0300007-5000-4000-8000-000000000002";

/** As QUATRO operações. Nome + SQL: o denominador sai da lista, não do banco. */
const OPERACOES = ["select", "insert", "update", "delete"] as const;

function comandoDe(operacao: (typeof OPERACOES)[number], org: string, job: string): string {
  switch (operacao) {
    case "select":
      return "select count(*) from public.job_runs";
    case "insert":
      return `insert into public.job_runs (organization_id, job_id, attempt)
              values ('${org}','${job}',9)`;
    case "update":
      return "update public.job_runs set outcome='ok'";
    case "delete":
      return "delete from public.job_runs";
  }
}

/** JWT do usuário, no mesmo contrato que o `auth.uid()` do Supabase lê. */
function claims(userId: string): string {
  return `select set_config('request.jwt.claims','{"sub":"${userId}"}',true);`;
}

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

/** `null` quando o script rodou; o motivo do Postgres quando ele recusou. */
function erroDe(script: string): string | null {
  try {
    sql(script);
    return null;
  } catch (erro) {
    return motivoDoErro(erro);
  }
}

/**
 * Roda UM comando sob UM papel — e, quando há usuário, sob o JWT dele.
 *
 * `set local role` + claim é o que separa esta prova da leitura de catálogo:
 * quem tenta é a sessão que o PostgREST abriria para o navegador, não o
 * superusuário do harness (que passaria com ou sem grant).
 */
function erroSob(
  papel: "anon" | "authenticated" | "service_role",
  comando: string,
  usuario?: string,
): string | null {
  return erroDe(`
    begin;
    set local role ${papel};
    ${usuario ? claims(usuario) : ""}
    ${comando};
    rollback;
  `);
}

/**
 * O que vai para a asserção quando o comando NÃO deu erro.
 *
 * `toContain` sobre `null` reprova — mas reprova falando do TIPO do argumento,
 * não do que aconteceu. Trocando o `null` por esta frase, o vermelho do gate
 * (e o do mutante que sabota o grant) diz a coisa certa: o papel EXECUTOU o
 * comando.
 */
const SEM_ERRO = "<o comando PASSOU: o papel alcançou a tabela>";

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${USER_A}','f03-t07-a@invariant.test'),
      ('${USER_B}','f03-t07-b@invariant.test');
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG}','f03-t07-fila','F03 T07 Fila de saida','F03 T07'),
      ('${ORG_B}','f03-t07-fila-b','F03 T07 Fila de saida B','F03 T07 B');
    insert into public.user_organizations (organization_id, user_id, role, accepted_at) values
      ('${ORG}','${USER_A}','agent',now()),
      ('${ORG_B}','${USER_B}','agent',now());
    insert into public.contacts (id, organization_id, display_name, phone_number)
      values ('${CONTATO}','${ORG}','Contato F03 T07','+5511900000007');
    ${inserirJob(JOB_DA_VACUIDADE, "outbound_message")}
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

/**
 * A PROVA COMPORTAMENTAL exigida por `rls-completude-varredura.test.ts`.
 *
 * O caso acima lê o CATÁLOGO (`relrowsecurity`, `pg_policies`, `relacl`) — ele
 * descreve a FORMA que a proteção tem de ter, e forma não é proteção: um grant
 * que chegue por outro caminho, ou uma policy que exista e não isole, passam
 * naquela contagem inteira. O que fecha a lacuna é TENTAR — sob `set local
 * role`, com o JWT de um usuário que existe e é membro de uma organização de
 * verdade — e medir a recusa do Postgres pelo nome (`permission denied`), nos
 * DOIS tenants.
 *
 * O controle positivo de `service_role` é a guarda de vacuidade: sem ele, uma
 * tabela apagada ou renomeada faria as oito recusas continuarem "passando" por
 * ausência de tabela, e o teste pararia de medir sem ficar vermelho.
 */
describe("F03-T07 — job_runs: prova comportamental de RLS nos dois tenants", () => {
  it("authenticated recebe permission denied nas quatro operações em A e B", () => {
    // Arrange — dois usuários reais, cada um membro da sua organização.
    const casos = [
      [USER_A, ORG],
      [USER_B, ORG_B],
    ] as const;

    // Act + Assert — 4 operações × 2 usuários = 8 recusas nomeadas.
    let negadas = 0;
    for (const [usuario, org] of casos) {
      for (const operacao of OPERACOES) {
        const motivo = erroSob("authenticated", comandoDe(operacao, org, JOB_DA_VACUIDADE), usuario);
        expect(
          motivo ?? SEM_ERRO,
          `authenticated (${usuario}) alcançou job_runs no ${operacao} — service_only furado (D35/G-54)`,
        ).toContain("permission denied");
        negadas += 1;
      }
    }

    const esperado = OPERACOES.length * casos.length;
    expect(negadas).toBe(esperado);
    console.info(`f03-t07-job-runs-rls: authenticated_negado=${negadas}/${esperado}`);
  });

  it("anon recebe permission denied nas quatro operações", () => {
    // Arrange + Act — anon não tem JWT: é a sessão da anon key sem login.
    let negadas = 0;
    for (const operacao of OPERACOES) {
      const motivo = erroSob("anon", comandoDe(operacao, ORG, JOB_DA_VACUIDADE));
      // Assert
      expect(
        motivo ?? SEM_ERRO,
        `anon alcançou job_runs no ${operacao} — a anon key lê o registro de execução`,
      ).toContain("permission denied");
      negadas += 1;
    }

    console.info(`f03-t07-job-runs-rls: anon_negado=${negadas}/${OPERACOES.length}`);
  });

  it("service_role continua escrevendo e lendo (guarda de vacuidade)", () => {
    // Arrange + Act — as mesmas quatro operações, agora pelo dono do dado.
    let permitidas = 0;
    for (const operacao of OPERACOES) {
      const motivo = erroSob("service_role", comandoDe(operacao, ORG, JOB_DA_VACUIDADE));
      // Assert — se QUALQUER uma falhar, as recusas acima deixam de significar
      // "grant ausente" e podem significar "tabela ausente".
      expect(
        // Aqui o argumento é o `motivo` CRU: a asserção é `toBeNull()`, e
        // `?? SEM_ERRO` transformaria o caso verde em vermelho.
        motivo,
        `service_role perdeu o ${operacao} em job_runs — o worker para de registrar tentativa`,
      ).toBeNull();
      permitidas += 1;
    }

    // E a linha escrita pelo service_role é LIDA por ele na mesma transação:
    // "não deu erro" sozinho aprovaria um grant que não alcança dado nenhum.
    const lida =
      sql(`
        begin;
        set local role service_role;
        insert into public.job_runs (organization_id, job_id, attempt)
          values ('${ORG}','${JOB_DA_VACUIDADE}',9);
        select count(*)::text || '/1' from public.job_runs
          where organization_id='${ORG}' and job_id='${JOB_DA_VACUIDADE}' and attempt=9;
        rollback;
      `)
        .split("\n")
        .map((linha) => linha.trim())
        .filter((linha) => /^\d+\/\d+$/.test(linha))
        .at(-1) ?? "";
    expect(lida, "service_role escreveu e não leu de volta").toBe("1/1");

    console.info(
      `f03-t07-job-runs-rls: service_role_permitido=${permitidas}/${OPERACOES.length} linha_lida_de_volta=${lida}`,
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
