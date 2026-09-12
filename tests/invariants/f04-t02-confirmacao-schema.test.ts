/**
 * F04-T02 — a pendência e a auditoria são do BANCO, não do TypeScript
 * (§5.8/§5.17, D33/D35, migration 9017).
 *
 * O que este arquivo mede, e por que precisa de Postgres: `pending_actions` e
 * `audit_events` são `service_only` DE VERDADE (a recusa é medida sob `set
 * local role` + JWT, nos dois tenants, nas quatro operações), UMA pendência por
 * conversa é do índice e não do código, a coerência `status ⇔ resolved_at` é do
 * CHECK, e os vocabulários de `status`, `result` e `actor_type` recusam valor
 * inventado.
 *
 * Cada bloco imprime contagem COM denominador (G-14).
 */
import { beforeAll, describe, expect, it } from "vitest";

import { motivoDoErro, sql } from "@/tests/invariants/psql-transporte";

const ORG = "f0400002-0000-4000-8000-000000000001";
/**
 * A SEGUNDA organização, com o SEGUNDO usuário, existe para a prova
 * comportamental de RLS: um tenant só provaria "este usuário não alcança", e
 * deixaria de fora a hipótese de o grant existir para UM deles.
 */
const ORG_B = "f0400002-0000-4000-8000-000000000002";
const USER_A = "f0400002-9000-4000-8000-000000000001";
const USER_B = "f0400002-9000-4000-8000-000000000002";
const CONTATO = "f0400002-2000-4000-8000-000000000001";
/** Segundo contato: `uniq_conversations_1to1_per_contact_session` é herdada e
 *  admite UMA conversa por (org, contato, sessão) — duas conversas exigem dois. */
const CONTATO_B = "f0400002-2000-4000-8000-000000000002";
const SESSAO = "f0400002-3000-4000-8000-000000000001";
const CONVERSA = "f0400002-4000-4000-8000-000000000001";
/** Segunda conversa: é nela que a unicidade por conversa é PROVADA não-vácua. */
const CONVERSA_B = "f0400002-4000-4000-8000-000000000002";

/** As duas tabelas da 9017. O denominador das provas de catálogo sai daqui. */
const TABELAS = ["pending_actions", "audit_events"] as const;

/** As QUATRO operações. Nome + SQL: o denominador sai da lista, não do banco. */
const OPERACOES = ["select", "insert", "update", "delete"] as const;

function comandoDe(tabela: string, operacao: (typeof OPERACOES)[number]): string {
  if (tabela === "pending_actions") {
    switch (operacao) {
      case "select":
        return "select count(*) from public.pending_actions";
      case "insert":
        return `insert into public.pending_actions
                  (organization_id, conversation_id, action_name, requested_by, expires_at)
                values ('${ORG}','${CONVERSA}','create_order','ai', now() + interval '1 hour')`;
      case "update":
        return "update public.pending_actions set action_name='x'";
      case "delete":
        return "delete from public.pending_actions";
    }
  }
  switch (operacao) {
    case "select":
      return "select count(*) from public.audit_events";
    case "insert":
      return `insert into public.audit_events
                (organization_id, actor_type, action_name, result)
              values ('${ORG}','ai','create_order','pending')`;
    case "update":
      return "update public.audit_events set result='executed'";
    case "delete":
      return "delete from public.audit_events";
  }
}

/** JWT do usuário, no mesmo contrato que o `auth.uid()` do Supabase lê. */
function claims(userId: string): string {
  return `select set_config('request.jwt.claims','{"sub":"${userId}"}',true);`;
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

function aceita(script: string): boolean {
  return erroDe(script) === null;
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
 * diz a coisa certa: o papel EXECUTOU o comando.
 */
const SEM_ERRO = "<o comando PASSOU: o papel alcançou a tabela>";

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${USER_A}','f04-t02-a@invariant.test'),
      ('${USER_B}','f04-t02-b@invariant.test');
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG}','f04-t02-conf','F04 T02 Confirmacao','F04 T02'),
      ('${ORG_B}','f04-t02-conf-b','F04 T02 Confirmacao B','F04 T02 B');
    insert into public.user_organizations (organization_id, user_id, role, accepted_at) values
      ('${ORG}','${USER_A}','agent',now()),
      ('${ORG_B}','${USER_B}','agent',now());
    insert into public.contacts (id, organization_id, display_name, phone_number) values
      ('${CONTATO}','${ORG}','Contato F04 T02','+5511900000042'),
      ('${CONTATO_B}','${ORG}','Contato F04 T02 B','+5511900000043');
    insert into public.channel_sessions
      (id, organization_id, waha_session_name, webhook_secret_encrypted)
      values ('${SESSAO}','${ORG}','sessao-f04-t02','\\x00'::bytea);
    insert into public.conversations
      (id, organization_id, contact_id, channel_session_id, channel, status, is_group, saas_state)
      values
      ('${CONVERSA}','${ORG}','${CONTATO}','${SESSAO}','whatsapp','open',false,'ai_handling'),
      ('${CONVERSA_B}','${ORG}','${CONTATO_B}','${SESSAO}','whatsapp','open',false,'ai_handling');
  `);
});

describe("F04-T02 — pending_actions e audit_events são service_only (D35)", () => {
  it("as duas têm RLS ligada, zero policies e nenhum privilégio de cliente", () => {
    // Arrange + Act — uma leitura de catálogo por tabela, com denominador.
    let conformes = 0;
    for (const tabela of TABELAS) {
      const observado = sql(`
        select
          (select relrowsecurity::int from pg_class where oid='public.${tabela}'::regclass) || '|' ||
          (select count(*) from pg_policies where schemaname='public' and tablename='${tabela}') || '|' ||
          (select count(*) from pg_class c, aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
            where c.oid='public.${tabela}'::regclass and a.grantee='anon'::regrole) || '|' ||
          (select count(*) from pg_class c, aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
            where c.oid='public.${tabela}'::regclass and a.grantee='authenticated'::regrole) || '|' ||
          (select count(*) from pg_class c, aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
            where c.oid='public.${tabela}'::regclass and a.grantee=0) || '|' ||
          (select least(count(*),1) from pg_class c, aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
            where c.oid='public.${tabela}'::regclass and a.grantee='service_role'::regrole);
      `);
      // Assert — rls|policies|anon|authenticated|PUBLIC|service_role
      expect(observado, `${tabela} fora do desenho service_only (D35/G-54)`).toBe("1|0|0|0|0|1");
      conformes += 1;
    }

    expect(conformes).toBe(TABELAS.length);
    console.info(
      `f04-t02-service-only: tabelas=${conformes}/${TABELAS.length} rls=1 policies=0 anon=0 authenticated=0 public=0 service_role=1`,
    );
  });

  it("api_audit_log PERMANECE ao lado — §5.17 põe as duas juntas", () => {
    // Arrange + Act — o herdado é L-10 e tem leitores; a 9017 acrescenta, não
    // substitui. Uma migration que o trocasse passaria em tudo acima.
    const herdado = sql(
      `select count(*)::int from pg_tables where schemaname='public' and tablename='api_audit_log';`,
    ).trim();

    // Assert
    expect(herdado, "api_audit_log sumiu: audit_events não substitui o herdado").toBe("1");
    console.info("f04-t02-auditoria: api_audit_log_presente=1/1 audit_events_presente=1/1");
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
 * tabela apagada ou renomeada faria as recusas continuarem "passando" por
 * ausência de tabela, e o teste pararia de medir sem ficar vermelho.
 */
describe("F04-T02 — prova comportamental de RLS nos dois tenants", () => {
  it("authenticated recebe permission denied nas quatro operações, em A e B, nas duas tabelas", () => {
    // Arrange — dois usuários reais, cada um membro da sua organização.
    const casos = [USER_A, USER_B] as const;

    // Act + Assert — 2 tabelas × 4 operações × 2 usuários = 16 recusas nomeadas.
    let negadas = 0;
    for (const tabela of TABELAS) {
      for (const usuario of casos) {
        for (const operacao of OPERACOES) {
          const motivo = erroSob("authenticated", comandoDe(tabela, operacao), usuario);
          expect(
            motivo ?? SEM_ERRO,
            `authenticated (${usuario}) alcançou ${tabela} no ${operacao} — service_only furado (D35/G-54)`,
          ).toContain("permission denied");
          negadas += 1;
        }
      }
    }

    const esperado = TABELAS.length * OPERACOES.length * casos.length;
    expect(negadas).toBe(esperado);
    console.info(`f04-t02-rls: authenticated_negado=${negadas}/${esperado}`);
  });

  it("anon recebe permission denied nas quatro operações, nas duas tabelas", () => {
    // Arrange + Act — anon não tem JWT: é a sessão da anon key sem login.
    let negadas = 0;
    for (const tabela of TABELAS) {
      for (const operacao of OPERACOES) {
        const motivo = erroSob("anon", comandoDe(tabela, operacao));
        // Assert
        expect(
          motivo ?? SEM_ERRO,
          `anon alcançou ${tabela} no ${operacao} — a anon key lê a pendência/auditoria`,
        ).toContain("permission denied");
        negadas += 1;
      }
    }

    const esperado = TABELAS.length * OPERACOES.length;
    expect(negadas).toBe(esperado);
    console.info(`f04-t02-rls: anon_negado=${negadas}/${esperado}`);
  });

  it("service_role continua escrevendo e lendo (guarda de vacuidade)", () => {
    // Arrange + Act — as mesmas quatro operações, agora pelo dono do dado.
    let permitidas = 0;
    for (const tabela of TABELAS) {
      for (const operacao of OPERACOES) {
        const motivo = erroSob("service_role", comandoDe(tabela, operacao));
        // Assert — se QUALQUER uma falhar, as recusas acima deixam de
        // significar "grant ausente" e podem significar "tabela ausente".
        expect(
          // Argumento CRU: a asserção é `toBeNull()`, e `?? SEM_ERRO`
          // transformaria o caso verde em vermelho.
          motivo,
          `service_role perdeu o ${operacao} em ${tabela} — o produto para de registrar`,
        ).toBeNull();
        permitidas += 1;
      }
    }

    // E a linha escrita pelo service_role é LIDA por ele na mesma transação:
    // "não deu erro" sozinho aprovaria um grant que não alcança dado nenhum.
    const lida =
      sql(`
        begin;
        set local role service_role;
        insert into public.audit_events (organization_id, actor_type, action_name, result)
          values ('${ORG}','ai','create_order','pending');
        select count(*)::text || '/1' from public.audit_events
          where organization_id='${ORG}' and action_name='create_order';
        rollback;
      `)
        .split("\n")
        .map((linha) => linha.trim())
        .filter((linha) => /^\d+\/\d+$/.test(linha))
        .at(-1) ?? "";
    expect(lida, "service_role escreveu e não leu de volta").toBe("1/1");

    const esperado = TABELAS.length * OPERACOES.length;
    console.info(
      `f04-t02-rls: service_role_permitido=${permitidas}/${esperado} linha_lida_de_volta=${lida}`,
    );
  });
});

describe("F04-T02 — o que o BANCO garante sobre a pendência", () => {
  it("UMA pendência aberta por conversa, e é do índice", () => {
    // Arrange — a primeira entra.
    const primeira = aceita(
      `insert into public.pending_actions
         (organization_id, conversation_id, action_name, requested_by, expires_at)
       values ('${ORG}','${CONVERSA}','create_order','ai', now() + interval '1 hour');`,
    );
    expect(primeira, "a primeira pendência da conversa foi recusada").toBe(true);

    // Act — a segunda, na MESMA conversa.
    const motivo = erroDe(
      `insert into public.pending_actions
         (organization_id, conversation_id, action_name, requested_by, expires_at)
       values ('${ORG}','${CONVERSA}','update_order_quantity','ai', now() + interval '1 hour');`,
    );

    // Assert — pelo NOME do índice: "deu erro" aprovaria um erro qualquer.
    expect(motivo ?? SEM_ERRO, "duas pendências abertas na mesma conversa").toContain(
      "pending_actions_uma_por_conversa",
    );

    // O índice é PARCIAL em `status='pending'`: resolvida a primeira, a conversa
    // aceita outra. Sem esta metade, o índice seria "uma pendência por conversa
    // para sempre" — e a conversa nunca mais pediria confirmação de nada.
    sql(
      `update public.pending_actions set status='rejected', resolved_at=now()
        where organization_id='${ORG}' and conversation_id='${CONVERSA}' and status='pending';`,
    );
    const depoisDeResolver = aceita(
      `insert into public.pending_actions
         (organization_id, conversation_id, action_name, requested_by, expires_at)
       values ('${ORG}','${CONVERSA}','update_order_quantity','ai', now() + interval '1 hour');`,
    );
    expect(depoisDeResolver, "o índice travou a conversa depois de resolver a pendência").toBe(
      true,
    );

    // E OUTRA conversa não é afetada — prova de que o índice é por conversa e
    // não por organização.
    const outraConversa = aceita(
      `insert into public.pending_actions
         (organization_id, conversation_id, action_name, requested_by, expires_at)
       values ('${ORG}','${CONVERSA_B}','create_order','ai', now() + interval '1 hour');`,
    );
    expect(outraConversa, "o índice bloqueou pendência de outra conversa").toBe(true);

    console.info(
      "f04-t02-unicidade: segunda_aberta_recusada=1/1 apos_resolver_aceita=1/1 outra_conversa_aceita=1/1",
    );
  });

  it("`pending` ⇔ sem `resolved_at`: os dois lados da coerência", () => {
    // Arrange + Act — as duas metades do CHECK, em vez de só a que lembra.
    const pendenteComHora = erroDe(
      `insert into public.pending_actions
         (organization_id, conversation_id, action_name, requested_by, expires_at,
          status, resolved_at)
       values ('${ORG}',null,'create_order','ai', now() + interval '1 hour','pending', now());`,
    );
    const resolvidaSemHora = erroDe(
      `insert into public.pending_actions
         (organization_id, conversation_id, action_name, requested_by, expires_at, status)
       values ('${ORG}',null,'create_order','ai', now() + interval '1 hour','approved');`,
    );

    // Assert — pelo NOME da constraint.
    expect(pendenteComHora ?? SEM_ERRO, "pendente com resolved_at passou").toContain(
      "pending_actions_desfecho_coerente",
    );
    expect(resolvidaSemHora ?? SEM_ERRO, "aprovada sem resolved_at passou").toContain(
      "pending_actions_desfecho_coerente",
    );
    console.info("f04-t02-coerencia: casos_certos=2/2");
  });

  it("os vocabulários recusam valor inventado e aceitam os declarados", () => {
    // Arrange — as listas são a AFIRMAÇÃO do teste; o denominador sai delas,
    // não de uma contagem que o próprio banco devolveria.
    const STATUS = ["pending", "approved", "rejected", "timeout"] as const;
    const RESULTADOS = ["executed", "pending", "denied", "failed"] as const;
    const ATORES = ["user", "ai", "automation", "system"] as const;

    // Act + Assert — pendência: `pending` sem hora, os outros três com hora.
    const statusAceitos = STATUS.filter((status) =>
      aceita(
        `insert into public.pending_actions
           (organization_id, conversation_id, action_name, requested_by, expires_at, status, resolved_at)
         values ('${ORG}',null,'create_order','ai', now() + interval '1 hour','${status}',
                 ${status === "pending" ? "null" : "now()"});`,
      ),
    ).length;
    expect(statusAceitos, "pending_actions.status recusou desfecho declarado").toBe(
      STATUS.length,
    );
    const statusInventado = aceita(
      `insert into public.pending_actions
         (organization_id, conversation_id, action_name, requested_by, expires_at, status, resolved_at)
       values ('${ORG}',null,'create_order','ai', now() + interval '1 hour','talvez', now());`,
    );
    expect(statusInventado, "o CHECK de status virou letra morta").toBe(false);

    const resultadosAceitos = RESULTADOS.filter((result) =>
      aceita(
        `insert into public.audit_events (organization_id, actor_type, action_name, result)
         values ('${ORG}','ai','create_order','${result}');`,
      ),
    ).length;
    expect(resultadosAceitos, "audit_events.result recusou resultado declarado").toBe(
      RESULTADOS.length,
    );
    const resultadoInventado = aceita(
      `insert into public.audit_events (organization_id, actor_type, action_name, result)
       values ('${ORG}','ai','create_order','mais_ou_menos');`,
    );
    expect(resultadoInventado, "o CHECK de result virou letra morta").toBe(false);

    const atoresAceitos = ATORES.filter((ator) =>
      aceita(
        `insert into public.audit_events (organization_id, actor_type, action_name, result)
         values ('${ORG}','${ator}','create_order','executed');`,
      ),
    ).length;
    expect(atoresAceitos, "audit_events.actor_type recusou ator de §5.17").toBe(ATORES.length);
    const atorInventado = aceita(
      `insert into public.audit_events (organization_id, actor_type, action_name, result)
       values ('${ORG}','gerente','create_order','executed');`,
    );
    expect(atorInventado, "o CHECK de actor_type virou letra morta").toBe(false);

    // `risk` é ANULÁVEL (Conversation, Identity, Jobs e Config escrevem sem
    // risco) mas NÃO é livre: quando existe, é da taxonomia única de §5.8.
    const riscoNulo = aceita(
      `insert into public.audit_events (organization_id, actor_type, action_name, result, risk)
       values ('${ORG}','system','conversation.transition','executed', null);`,
    );
    const riscoInventado = aceita(
      `insert into public.audit_events (organization_id, actor_type, action_name, result, risk)
       values ('${ORG}','ai','create_order','executed','altissimo');`,
    );
    expect(riscoNulo, "audit_events recusou risco NULO, que §5.17 exige aceitar").toBe(true);
    expect(riscoInventado, "audit_events aceitou risco fora da taxonomia de §5.8").toBe(false);

    console.info(
      `f04-t02-vocabulario: status=${statusAceitos}/${STATUS.length} result=${resultadosAceitos}/${RESULTADOS.length} actor_type=${atoresAceitos}/${ATORES.length} inventados_recusados=3/3 risk_nulo_aceito=1/1 risk_inventado_recusado=1/1`,
    );
  });

  it("apagar a organização leva a pendência e a auditoria junto (FK cascade)", () => {
    // Arrange — uma organização descartável, com uma linha em cada tabela.
    const ORG_C = "f0400002-0000-4000-8000-000000000003";
    sql(`
      insert into public.organizations (id, slug, legal_name, display_name)
        values ('${ORG_C}','f04-t02-conf-c','F04 T02 C','F04 T02 C');
      insert into public.pending_actions
        (organization_id, conversation_id, action_name, requested_by, expires_at)
        values ('${ORG_C}',null,'create_order','ai', now() + interval '1 hour');
      insert into public.audit_events (organization_id, actor_type, action_name, result)
        values ('${ORG_C}','ai','create_order','pending');
    `);
    const antes = sql(`
      select (select count(*) from public.pending_actions where organization_id='${ORG_C}')
          || '/' ||
             (select count(*) from public.audit_events where organization_id='${ORG_C}');
    `).trim();

    // Act
    sql(`delete from public.organizations where id='${ORG_C}';`);

    // Assert
    const depois = sql(`
      select (select count(*) from public.pending_actions where organization_id='${ORG_C}')
          || '/' ||
             (select count(*) from public.audit_events where organization_id='${ORG_C}');
    `).trim();
    expect(antes, "o cenário nasceu vazio — a prova seria vácua").toBe("1/1");
    expect(depois, "linha órfã sobreviveu à remoção do tenant").toBe("0/0");
    console.info(`f04-t02-cascade: antes=${antes} depois=${depois}`);
  });
});
