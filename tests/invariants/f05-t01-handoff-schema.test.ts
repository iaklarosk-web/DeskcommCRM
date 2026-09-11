/**
 * F05-T01 — o dossiê de handoff é do BANCO, não do TypeScript (§5.11, D19/D35,
 * migration 9020).
 *
 * O que este arquivo mede, e por que precisa de Postgres: `handoffs` é
 * `service_only` DE VERDADE (a recusa é medida sob `set local role` + JWT, nos
 * dois tenants, nas quatro operações), o motivo é ENUM de OITO valores no CHECK
 * e não no TypeScript (G-78), `last_messages` tem exatamente cinco posições por
 * constraint, UM dossiê ABERTO por conversa é do índice, a coerência
 * `claimed_by ⇔ claimed_at` é do CHECK, e os campos de texto recusam string
 * vazia — que é o que `not null` sozinho aceitaria.
 *
 * Cada bloco imprime contagem COM denominador (G-14).
 */
import { beforeAll, describe, expect, it } from "vitest";

import { motivoDoErro, sql } from "@/tests/invariants/psql-transporte";

const ORG = "f0500002-0000-4000-8000-000000000001";
/**
 * A SEGUNDA organização, com o SEGUNDO usuário, existe para a prova
 * comportamental de RLS: um tenant só provaria "este usuário não alcança", e
 * deixaria de fora a hipótese de o grant existir para UM deles.
 */
const ORG_B = "f0500002-0000-4000-8000-000000000002";
const USER_A = "f0500002-9000-4000-8000-000000000001";
const USER_B = "f0500002-9000-4000-8000-000000000002";
const CONTATO = "f0500002-2000-4000-8000-000000000001";
/** Segundo contato: `uniq_conversations_1to1_per_contact_session` é herdada e
 *  admite UMA conversa por (org, contato, sessão) — duas conversas exigem dois. */
const CONTATO_B = "f0500002-2000-4000-8000-000000000002";
const SESSAO = "f0500002-3000-4000-8000-000000000001";
const CONVERSA = "f0500002-4000-4000-8000-000000000001";
/** Segunda conversa: é nela que a unicidade por conversa é PROVADA não-vácua. */
const CONVERSA_B = "f0500002-4000-4000-8000-000000000002";

/** As QUATRO operações. Nome + SQL: o denominador sai da lista, não do banco. */
const OPERACOES = ["select", "insert", "update", "delete"] as const;

/** Os OITO motivos de §5.11 — AFIRMAÇÃO do teste, não leitura do CHECK. */
const MOTIVOS = [
  "customer_request",
  "high_risk_action",
  "low_confidence",
  "out_of_knowledge",
  "complaint",
  "provider_error",
  "tenant_rule",
  "forbidden_request",
] as const;

const CINCO_VAZIAS = "'[null,null,null,null,null]'::jsonb";

function insercao(
  org: string,
  conversaId: string,
  campos: Partial<{
    reason: string;
    customer: string;
    intent: string;
    summary: string;
    last_messages: string;
    pending_action: string;
    suggested_next_step: string;
    created_by: string;
    claimed_by: string;
    claimed_at: string;
  }> = {},
): string {
  const v = {
    reason: "'customer_request'",
    customer: "'Cliente Fictício'",
    intent: "'pedido_de_atendimento_humano'",
    summary: "'O cliente pediu para falar com uma pessoa.'",
    last_messages: CINCO_VAZIAS,
    pending_action: "null",
    suggested_next_step: "'Assuma a conversa e se apresente.'",
    created_by: "'ai'",
    claimed_by: "null",
    claimed_at: "null",
    ...campos,
  };
  return `insert into public.handoffs
            (organization_id, conversation_id, reason, customer, intent, summary,
             last_messages, pending_action, suggested_next_step, created_by,
             claimed_by, claimed_at)
          values ('${org}','${conversaId}',${v.reason},${v.customer},${v.intent},
                  ${v.summary},${v.last_messages},${v.pending_action},
                  ${v.suggested_next_step},${v.created_by},${v.claimed_by},${v.claimed_at})`;
}

function comandoDe(operacao: (typeof OPERACOES)[number]): string {
  switch (operacao) {
    case "select":
      return "select count(*) from public.handoffs";
    case "insert":
      return insercao(ORG, CONVERSA);
    case "update":
      return "update public.handoffs set intent='x'";
    case "delete":
      return "delete from public.handoffs";
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
  return erroDe(`${script};`) === null;
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
      ('${USER_A}','f05-t01-a@invariant.test'),
      ('${USER_B}','f05-t01-b@invariant.test');
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG}','f05-t01-handoff','F05 T01 Handoff','F05 T01'),
      ('${ORG_B}','f05-t01-handoff-b','F05 T01 Handoff B','F05 T01 B');
    insert into public.user_organizations (organization_id, user_id, role, accepted_at) values
      ('${ORG}','${USER_A}','agent',now()),
      ('${ORG_B}','${USER_B}','agent',now());
    insert into public.contacts (id, organization_id, display_name, phone_number) values
      ('${CONTATO}','${ORG}','Contato F05 T01','+5511900000052'),
      ('${CONTATO_B}','${ORG}','Contato F05 T01 B','+5511900000053');
    insert into public.channel_sessions
      (id, organization_id, waha_session_name, webhook_secret_encrypted)
      values ('${SESSAO}','${ORG}','sessao-f05-t01','\\x00'::bytea);
    insert into public.conversations
      (id, organization_id, contact_id, channel_session_id, channel, status, is_group, saas_state)
      values
      ('${CONVERSA}','${ORG}','${CONTATO}','${SESSAO}','whatsapp','open',false,'waiting_human'),
      ('${CONVERSA_B}','${ORG}','${CONTATO_B}','${SESSAO}','whatsapp','open',false,'waiting_human');
  `);
});

describe("F05-T01 — handoffs é service_only (D35)", () => {
  it("RLS ligada, zero policies e nenhum privilégio de cliente", () => {
    // Arrange + Act — uma leitura de catálogo, com denominador.
    const observado = sql(`
      select
        (select relrowsecurity::int from pg_class where oid='public.handoffs'::regclass) || '|' ||
        (select count(*) from pg_policies where schemaname='public' and tablename='handoffs') || '|' ||
        (select count(*) from pg_class c, aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
          where c.oid='public.handoffs'::regclass and a.grantee='anon'::regrole) || '|' ||
        (select count(*) from pg_class c, aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
          where c.oid='public.handoffs'::regclass and a.grantee='authenticated'::regrole) || '|' ||
        (select count(*) from pg_class c, aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
          where c.oid='public.handoffs'::regclass and a.grantee=0) || '|' ||
        (select least(count(*),1) from pg_class c, aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
          where c.oid='public.handoffs'::regclass and a.grantee='service_role'::regrole);
    `);

    // Assert — rls|policies|anon|authenticated|PUBLIC|service_role
    expect(observado, "handoffs fora do desenho service_only (D35/G-54)").toBe("1|0|0|0|0|1");
    console.info(
      "f05-t01-service-only: tabelas=1/1 rls=1 policies=0 anon=0 authenticated=0 public=0 service_role=1",
    );
  });

  it("não existe um SEGUNDO estado de handoff: a tabela não tem coluna `status`", () => {
    // Arrange + Act — §5.11 (target-state): estado da conversa é
    // `conversations.saas_state` (D16). "Aberto" aqui é `claimed_at is null`.
    const status = sql(
      `select count(*)::int from information_schema.columns
        where table_schema='public' and table_name='handoffs' and column_name='status';`,
    ).trim();
    const saasState = sql(
      `select count(*)::int from information_schema.columns
        where table_schema='public' and table_name='conversations' and column_name='saas_state';`,
    ).trim();

    // Assert
    expect(status, "handoffs ganhou coluna status — segunda verdade sobre a conversa").toBe("0");
    expect(saasState, "conversations.saas_state sumiu — o estado perdeu o dono").toBe("1");
    console.info("f05-t01-estado: handoffs_status=0/0 conversations_saas_state=1/1");
  });

  it("o aviso HERDADO permanece ao lado — a F05 amplia, não substitui", () => {
    // Arrange + Act — `agent_inbox_items(kind='handoff')` tem tela e uso; uma
    // migration que o trocasse passaria em tudo acima.
    const herdado = sql(
      `select count(*)::int from pg_tables where schemaname='public' and tablename='agent_inbox_items';`,
    ).trim();
    const rpcDoClaim = sql(
      `select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname='fn_conversation_assign';`,
    ).trim();

    // Assert
    expect(herdado, "agent_inbox_items sumiu: handoffs não substitui o aviso herdado").toBe("1");
    expect(rpcDoClaim, "fn_conversation_assign sumiu: é ela que o claim reusa").toBe("1");
    console.info("f05-t01-heranca: agent_inbox_items=1/1 fn_conversation_assign=1/1");
  });
});

/**
 * A PROVA COMPORTAMENTAL exigida por `rls-completude-varredura.test.ts`.
 *
 * O caso acima lê o CATÁLOGO — ele descreve a FORMA que a proteção tem de ter, e
 * forma não é proteção: um grant que chegue por outro caminho passa naquela
 * contagem inteira. O que fecha a lacuna é TENTAR — sob `set local role`, com o
 * JWT de um usuário que existe e é membro de uma organização de verdade — e
 * medir a recusa do Postgres pelo nome, nos DOIS tenants.
 *
 * O controle positivo de `service_role` é a guarda de vacuidade: sem ele, uma
 * tabela apagada ou renomeada faria as recusas continuarem "passando" por
 * ausência de tabela, e o teste pararia de medir sem ficar vermelho.
 */
describe("F05-T01 — prova comportamental de RLS nos dois tenants", () => {
  it("authenticated recebe permission denied nas quatro operações, em A e B", () => {
    // Arrange — dois usuários reais, cada um membro da sua organização.
    const casos = [USER_A, USER_B] as const;

    // Act + Assert — 4 operações × 2 usuários = 8 recusas nomeadas.
    let negadas = 0;
    for (const usuario of casos) {
      for (const operacao of OPERACOES) {
        const motivo = erroSob("authenticated", comandoDe(operacao), usuario);
        expect(
          motivo ?? SEM_ERRO,
          `authenticated (${usuario}) alcançou handoffs no ${operacao} — service_only furado (D35/G-54)`,
        ).toContain("permission denied");
        negadas += 1;
      }
    }

    const esperado = OPERACOES.length * casos.length;
    expect(negadas).toBe(esperado);
    console.info(`f05-t01-rls: authenticated_negado=${negadas}/${esperado}`);
  });

  it("anon recebe permission denied nas quatro operações", () => {
    // Arrange + Act — anon não tem JWT: é a sessão da anon key sem login.
    let negadas = 0;
    for (const operacao of OPERACOES) {
      const motivo = erroSob("anon", comandoDe(operacao));
      // Assert
      expect(
        motivo ?? SEM_ERRO,
        `anon alcançou handoffs no ${operacao} — a anon key lê o dossiê do cliente`,
      ).toContain("permission denied");
      negadas += 1;
    }

    expect(negadas).toBe(OPERACOES.length);
    console.info(`f05-t01-rls: anon_negado=${negadas}/${OPERACOES.length}`);
  });

  it("service_role continua escrevendo e lendo (guarda de vacuidade)", () => {
    // Arrange + Act — as mesmas quatro operações, agora pelo dono do dado.
    let permitidas = 0;
    for (const operacao of OPERACOES) {
      const motivo = erroSob("service_role", comandoDe(operacao));
      // Assert — se QUALQUER uma falhar, as recusas acima deixam de significar
      // "grant ausente" e podem significar "tabela ausente".
      expect(
        // Argumento CRU: a asserção é `toBeNull()`, e `?? SEM_ERRO`
        // transformaria o caso verde em vermelho.
        motivo,
        `service_role perdeu o ${operacao} em handoffs — o produto para de registrar`,
      ).toBeNull();
      permitidas += 1;
    }

    // E a linha escrita pelo service_role é LIDA por ele na mesma transação:
    // "não deu erro" sozinho aprovaria um grant que não alcança dado nenhum.
    const lida =
      sql(`
        begin;
        set local role service_role;
        ${insercao(ORG, CONVERSA)};
        select count(*)::text || '/1' from public.handoffs
          where organization_id='${ORG}' and conversation_id='${CONVERSA}';
        rollback;
      `)
        .split("\n")
        .map((linha) => linha.trim())
        .filter((linha) => /^\d+\/\d+$/.test(linha))
        .at(-1) ?? "";
    expect(lida, "service_role escreveu e não leu de volta").toBe("1/1");

    console.info(
      `f05-t01-rls: service_role_permitido=${permitidas}/${OPERACOES.length} linha_lida_de_volta=${lida}`,
    );
  });
});

describe("F05-T01 — o que o BANCO garante sobre o dossiê", () => {
  it("os OITO motivos entram e o texto livre NÃO (G-78)", () => {
    // Arrange — a lista é a AFIRMAÇÃO do teste; o denominador sai dela, não de
    // uma contagem que o próprio CHECK devolveria.
    const aceitos = MOTIVOS.filter((motivo, i) => {
      const ok = aceita(insercao(ORG, CONVERSA, { reason: `'${motivo}'` }));
      // Cada motivo ocupa o único dossiê ABERTO da conversa; liberar em seguida
      // é o que permite medir os oito sem criar oito conversas.
      sql(`delete from public.handoffs where organization_id='${ORG}' and reason='${motivo}';`);
      return ok && i >= 0;
    }).length;

    // Act — o motivo em prosa, que é o que G-78 proíbe.
    const emProsa = erroDe(`${insercao(ORG, CONVERSA, { reason: "'o cliente estava bravo'" })};`);

    // Assert — pelo NOME da constraint: "deu erro" aprovaria um erro qualquer.
    expect(aceitos, "o CHECK recusou um dos oito motivos de §5.11").toBe(MOTIVOS.length);
    expect(emProsa ?? SEM_ERRO, "o banco aceitou motivo em prosa").toContain(
      "handoffs_reason_check",
    );
    console.info(
      `f05-t01-motivos: aceitos=${aceitos}/${MOTIVOS.length} prosa_recusada=1/1 texto_livre=0`,
    );
  });

  it("`last_messages` tem exatamente cinco posições", () => {
    // Arrange + Act — as três formas de errar: menos, mais e não-array.
    const quatro = erroDe(
      `${insercao(ORG, CONVERSA, { last_messages: "'[null,null,null,null]'::jsonb" })};`,
    );
    const seis = erroDe(
      `${insercao(ORG, CONVERSA, { last_messages: "'[1,2,3,4,5,6]'::jsonb" })};`,
    );
    const objeto = erroDe(`${insercao(ORG, CONVERSA, { last_messages: "'{\"a\":1}'::jsonb" })};`);
    const cinco = aceita(insercao(ORG, CONVERSA));
    sql(`delete from public.handoffs where organization_id='${ORG}';`);

    // Assert — pelo NOME da constraint, e o positivo junto: um CHECK que
    // recusasse TUDO passaria nas três negativas.
    for (const [nome, motivo] of [
      ["quatro", quatro],
      ["seis", seis],
      ["objeto", objeto],
    ] as const) {
      expect(motivo ?? SEM_ERRO, `last_messages com ${nome} passou`).toContain(
        "handoffs_cinco_ultimas_mensagens",
      );
    }
    expect(cinco, "o CHECK recusou as cinco posições que §5.11 pede").toBe(true);
    console.info("f05-t01-cinco: recusadas=3/3 cinco_aceita=1/1");
  });

  it("UM dossiê ABERTO por conversa, e é do índice", () => {
    // Arrange — o primeiro entra.
    expect(aceita(insercao(ORG, CONVERSA)), "o primeiro dossiê da conversa foi recusado").toBe(
      true,
    );

    // Act — o segundo, na MESMA conversa, também aberto.
    const segundo = erroDe(`${insercao(ORG, CONVERSA, { reason: "'complaint'" })};`);

    // Assert — pelo NOME do índice.
    expect(segundo ?? SEM_ERRO, "dois dossiês abertos na mesma conversa").toContain(
      "handoffs_um_aberto_por_conversa",
    );

    // O índice é PARCIAL em `claimed_at is null`: assumido o primeiro, a conversa
    // que volta para a IA (`resume_ai`, D34) e cai na fila de novo ganha o
    // SEGUNDO dossiê. Sem esta metade, o índice seria "um handoff por conversa
    // para sempre".
    sql(`update public.handoffs set claimed_by='${USER_A}', claimed_at=now()
          where organization_id='${ORG}' and conversation_id='${CONVERSA}' and claimed_at is null;`);
    const depoisDeAssumir = aceita(insercao(ORG, CONVERSA, { reason: "'complaint'" }));
    expect(depoisDeAssumir, "o índice travou a conversa depois do claim").toBe(true);

    // E OUTRA conversa não é afetada — o índice é por conversa, não por org.
    const outra = aceita(insercao(ORG, CONVERSA_B));
    expect(outra, "o índice bloqueou dossiê de outra conversa").toBe(true);

    sql(`delete from public.handoffs where organization_id='${ORG}';`);
    console.info(
      "f05-t01-unicidade: segundo_aberto_recusado=1/1 apos_claim_aceito=1/1 outra_conversa_aceita=1/1",
    );
  });

  it("assumido ⇔ tem quem e quando: os dois lados da coerência", () => {
    // Arrange + Act — as duas metades do CHECK, em vez de só a que se lembra.
    const semHora = erroDe(`${insercao(ORG, CONVERSA, { claimed_by: `'${USER_A}'` })};`);
    const semDono = erroDe(`${insercao(ORG, CONVERSA, { claimed_at: "now()" })};`);
    const completo = aceita(
      insercao(ORG, CONVERSA, { claimed_by: `'${USER_A}'`, claimed_at: "now()" }),
    );
    sql(`delete from public.handoffs where organization_id='${ORG}';`);

    // Assert — pelo NOME da constraint.
    expect(semHora ?? SEM_ERRO, "dossiê com dono e sem hora passou").toContain(
      "handoffs_claim_coerente",
    );
    expect(semDono ?? SEM_ERRO, "dossiê com hora e sem dono passou").toContain(
      "handoffs_claim_coerente",
    );
    expect(completo, "o CHECK recusou o claim completo").toBe(true);
    console.info("f05-t01-coerencia: casos_certos=3/3");
  });

  it("os campos de texto recusam VAZIO — `not null` sozinho aceitaria", () => {
    // Arrange — é a diferença entre "a coluna existe" e "há o que ler": uma
    // string vazia satisfaz `not null` e deixa o dossiê mudo.
    const brancos = [
      { campo: "customer", campos: { customer: "'   '" } },
      { campo: "intent", campos: { intent: "''" } },
      { campo: "summary", campos: { summary: "'  '" } },
      { campo: "suggested_next_step", campos: { suggested_next_step: "''" } },
    ] as const;

    // Act + Assert
    let recusados = 0;
    for (const caso of brancos) {
      const motivo = erroDe(`${insercao(ORG, CONVERSA, caso.campos)};`);
      expect(motivo ?? SEM_ERRO, `${caso.campo} vazio passou`).toContain(
        "handoffs_campos_preenchidos",
      );
      recusados += 1;
    }

    // `pending_action` é o ÚNICO que aceita NULL, e aceita de propósito: a maior
    // parte das passagens não tem ação pendurada, e um texto fabricado seria
    // dado inventado no dossiê que a pessoa vai ler.
    const semPendencia = aceita(insercao(ORG, CONVERSA));
    expect(semPendencia, "o banco exigiu pending_action — §5.11 não exige").toBe(true);
    sql(`delete from public.handoffs where organization_id='${ORG}';`);

    // E o vocabulário de `created_by`.
    const criadores = ["ai", "system", "human"] as const;
    const criadoresAceitos = criadores.filter((quem, i) => {
      const ok = aceita(insercao(ORG, CONVERSA, { created_by: `'${quem}'` }));
      sql(`delete from public.handoffs where organization_id='${ORG}';`);
      return ok && i >= 0;
    }).length;
    const criadorInventado = aceita(insercao(ORG, CONVERSA, { created_by: "'gerente'" }));
    sql(`delete from public.handoffs where organization_id='${ORG}';`);

    expect(criadoresAceitos).toBe(criadores.length);
    expect(criadorInventado, "o CHECK de created_by virou letra morta").toBe(false);
    console.info(
      `f05-t01-vazios: recusados=${recusados}/${brancos.length} pending_action_nulo_aceito=1/1 ` +
        `created_by=${criadoresAceitos}/${criadores.length} inventado_recusado=1/1`,
    );
  });

  it("apagar a organização leva o dossiê junto (FK cascade)", () => {
    // Arrange — uma organização descartável, com uma linha.
    const ORG_C = "f0500002-0000-4000-8000-000000000003";
    const CONTATO_C = "f0500002-2000-4000-8000-000000000003";
    const SESSAO_C = "f0500002-3000-4000-8000-000000000003";
    const CONVERSA_C = "f0500002-4000-4000-8000-000000000003";
    sql(`
      insert into public.organizations (id, slug, legal_name, display_name)
        values ('${ORG_C}','f05-t01-handoff-c','F05 T01 C','F05 T01 C');
      insert into public.contacts (id, organization_id, display_name, phone_number)
        values ('${CONTATO_C}','${ORG_C}','Contato C','+5511900000054');
      insert into public.channel_sessions
        (id, organization_id, waha_session_name, webhook_secret_encrypted)
        values ('${SESSAO_C}','${ORG_C}','sessao-f05-t01-c','\\x00'::bytea);
      insert into public.conversations
        (id, organization_id, contact_id, channel_session_id, channel, status, is_group, saas_state)
        values ('${CONVERSA_C}','${ORG_C}','${CONTATO_C}','${SESSAO_C}','whatsapp','open',false,'waiting_human');
      ${insercao(ORG_C, CONVERSA_C)};
    `);
    const antes = sql(
      `select count(*)::text from public.handoffs where organization_id='${ORG_C}';`,
    ).trim();

    // Act
    sql(`delete from public.organizations where id='${ORG_C}';`);

    // Assert
    const depois = sql(
      `select count(*)::text from public.handoffs where organization_id='${ORG_C}';`,
    ).trim();
    expect(antes, "o cenário nasceu vazio — a prova seria vácua").toBe("1");
    expect(depois, "dossiê órfão sobreviveu à remoção do tenant").toBe("0");
    console.info(`f05-t01-cascade: antes=${antes}/1 depois=${depois}/0`);
  });
});
