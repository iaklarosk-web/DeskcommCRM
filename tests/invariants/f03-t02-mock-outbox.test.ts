/**
 * F03-T02 — `mock_outbox` no banco (migration 9014, ADR-017 decisão 1).
 *
 * Mede o que o TypeScript não alcança. A prova do contrato
 * (`tests/unit/f03-t02-channel-adapter-contract.test.ts`) roda contra um pool
 * falso que IMITA o índice único; aqui o índice é o de verdade, e é ele — não o
 * código do adapter — que faz o reenvio da mesma chave não virar uma segunda
 * mensagem.
 *
 * Mede também a postura `service_only` de D35: RLS ligada com ZERO policies e
 * privilégio NENHUM para `anon`/`authenticated`. Nessas tabelas o controle É o
 * grant, então a ausência dele é o invariante — não um detalhe de configuração.
 */
import { describe, expect, it, beforeAll } from "vitest";

import { motivoDoErro, sql } from "@/tests/invariants/psql-transporte";

const ORG = "f0300002-0000-4000-8000-000000000001";
/**
 * A SEGUNDA organização, com o SEGUNDO usuário, existe só para a prova
 * comportamental de RLS: um tenant só provaria "este usuário não alcança" e
 * deixaria de fora a hipótese de o grant ter sido dado a UM deles.
 */
const ORG_B = "f0300002-0000-4000-8000-000000000002";
const USER_A = "f0300002-9000-4000-8000-000000000001";
const USER_B = "f0300002-9000-4000-8000-000000000002";
const CONVERSA = "f0300002-1000-4000-8000-000000000001";
const CHAVE = "f03-t02-chave-repetida";

/** Papéis de cliente que NÃO podem ter privilégio nenhum nesta tabela. */
const PAPEIS_DE_CLIENTE = ["anon", "authenticated"] as const;

/** As QUATRO operações. Nome + SQL: a contagem sai da lista, não do banco. */
const OPERACOES = ["select", "insert", "update", "delete"] as const;

function comandoDe(operacao: (typeof OPERACOES)[number], org: string): string {
  switch (operacao) {
    case "select":
      return "select count(*) from public.mock_outbox";
    case "insert":
      return `insert into public.mock_outbox
                (organization_id,conversation_id,to_e164,body,idempotency_key)
              values('${org}','${CONVERSA}','+5511900000002','forjado','f03-t02-forjado')`;
    case "update":
      return "update public.mock_outbox set body='forjado'";
    case "delete":
      return "delete from public.mock_outbox";
  }
}

/** JWT do usuário, no mesmo contrato que o `auth.uid()` do Supabase lê. */
function claims(userId: string): string {
  return `select set_config('request.jwt.claims','{"sub":"${userId}"}',true);`;
}

function ultimaLinha(saida: string): string {
  const linhas = saida
    .split("\n")
    .map((linha) => linha.trim())
    .filter((linha) => linha.length > 0);
  const ultima = linhas.at(-1);
  if (ultima === undefined) throw new Error(`psql não devolveu linha nenhuma: ${saida}`);
  return ultima;
}

function erroDe(script: string): string | null {
  try {
    sql(script);
    return null;
  } catch (error) {
    return motivoDoErro(error);
  }
}

/**
 * Roda UM comando sob UM papel — e, quando há usuário, sob o JWT dele.
 *
 * `set local role` + claim é o que separa esta prova da leitura de catálogo:
 * aqui quem tenta é a sessão que o PostgREST abriria para o navegador, não o
 * superusuário do harness (que passaria em qualquer tabela, com ou sem grant).
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
    insert into auth.users(id,email) values
      ('${USER_A}','f03-t02-a@invariant.test'),
      ('${USER_B}','f03-t02-b@invariant.test');
    insert into public.organizations(id,slug,legal_name,display_name) values
      ('${ORG}','f03-t02','F03 T02','F03 T02'),
      ('${ORG_B}','f03-t02-b','F03 T02 B','F03 T02 B');
    insert into public.user_organizations(organization_id,user_id,role,accepted_at) values
      ('${ORG}','${USER_A}','agent',now()),
      ('${ORG_B}','${USER_B}','agent',now());
  `);
});

describe("F03-T02 — a tabela existe e é service_only (D35)", () => {
  it("mock_outbox existe com as colunas do contrato e a FK de organização", () => {
    // Arrange — as colunas vêm da lista do contrato; a contagem tem denominador.
    const colunas = [
      "id",
      "organization_id",
      "conversation_id",
      "to_e164",
      "body",
      "idempotency_key",
      "created_at",
    ];

    // Act
    const observado = ultimaLinha(
      sql(`
        select
          (select count(*) from information_schema.columns
            where table_schema='public' and table_name='mock_outbox'
              and column_name in (${colunas.map((c) => `'${c}'`).join(",")})),
          (select count(*) from information_schema.columns
            where table_schema='public' and table_name='mock_outbox'),
          (select count(*) from information_schema.columns
            where table_schema='public' and table_name='mock_outbox'
              and column_name='organization_id' and is_nullable='NO'),
          (select count(*) from pg_constraint
            where conrelid='public.mock_outbox'::regclass
              and contype='f' and confrelid='public.organizations'::regclass
              and confdeltype='c' and convalidated);
      `),
    );

    // Assert — as sete do contrato E sete no total: coluna a mais reprova aqui.
    expect(observado, "mock_outbox fora do desenho da F03-T02").toBe(
      `${colunas.length}|${colunas.length}|1|1`,
    );
    console.info(
      `f03-t02: mock_outbox_colunas=${colunas.length}/${colunas.length} org_not_null=1/1 fk_cascade=1/1`,
    );
  });

  it("RLS está ligada e a tabela tem ZERO policies", () => {
    // Arrange + Act
    const observado = ultimaLinha(
      sql(`
        select
          (select relrowsecurity::int from pg_class where oid='public.mock_outbox'::regclass),
          (select count(*) from pg_policies
            where schemaname='public' and tablename='mock_outbox');
      `),
    );

    // Assert
    expect(observado, "service_only exige RLS ligada e nenhuma policy (D35)").toBe("1|0");
    console.info("f03-t02: rls_ligada=1/1 policies=0/0");
  });

  it("anon e authenticated não têm privilégio nenhum e service_role tem", () => {
    // Arrange + Act — `aclexplode` mede o grant DIRETO, que é o que o revoke
    // remove; `has_table_privilege` sozinho confundiria herança de PUBLIC.
    // PUBLIC entra como `grantee = 0` (não existe `'public'::regrole`), e ele
    // importa: um grant a PUBLIC alcança anon e authenticated sem aparecer no
    // nome de nenhum dos dois.
    const observado = ultimaLinha(
      sql(`
        select
          ${PAPEIS_DE_CLIENTE.map(
            (papel) => `(select count(*) from pg_class c,
              aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
             where c.oid='public.mock_outbox'::regclass and a.grantee='${papel}'::regrole)`,
          ).join(",\n          ")},
          (select count(*) from pg_class c,
            aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
           where c.oid='public.mock_outbox'::regclass and a.grantee=0),
          (select (count(*) > 0)::int from pg_class c,
            aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
           where c.oid='public.mock_outbox'::regclass and a.grantee='service_role'::regrole);
      `),
    );

    // Assert
    const zeros = PAPEIS_DE_CLIENTE.map(() => "0").join("|");
    expect(observado, "mock_outbox exposta a papel de cliente (G-54)").toBe(`${zeros}|0|1`);
    console.info(
      `f03-t02: papeis_fechados=${PAPEIS_DE_CLIENTE.length + 1}/${PAPEIS_DE_CLIENTE.length + 1} service_role_mantido=1/1`,
    );
  });
});

/**
 * A PROVA COMPORTAMENTAL exigida por `rls-completude-varredura.test.ts`.
 *
 * Os três casos acima leem o CATÁLOGO (`pg_class.relacl`, `pg_policies`) — eles
 * descrevem a FORMA que a proteção tem de ter. Não é a mesma coisa que a
 * proteção: um grant herdado por outro caminho, uma policy sabotada, um
 * `security invoker` esquecido numa view intermediária não aparecem em nenhuma
 * dessas contagens. O que fecha a lacuna é TENTAR — sob `set local role` e com
 * o JWT de um usuário que existe e é membro de uma organização de verdade — e
 * medir a recusa do Postgres pelo nome (`permission denied`), nos DOIS tenants.
 *
 * O controle positivo de `service_role` é a guarda de vacuidade: sem ele, uma
 * tabela apagada ou renomeada faria as oito recusas continuarem "passando" por
 * ausência de tabela, e ninguém perceberia que o teste parou de medir algo.
 */
describe("F03-T02 — mock_outbox: prova comportamental de RLS nos dois tenants", () => {
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
        const motivo = erroSob("authenticated", comandoDe(operacao, org), usuario);
        expect(
          motivo ?? SEM_ERRO,
          `authenticated (${usuario}) alcançou mock_outbox no ${operacao} — service_only furado (D35/G-54)`,
        ).toContain("permission denied");
        negadas += 1;
      }
    }

    const esperado = OPERACOES.length * casos.length;
    expect(negadas).toBe(esperado);
    console.info(`f03-t02-rls: authenticated_negado=${negadas}/${esperado}`);
  });

  it("anon recebe permission denied nas quatro operações", () => {
    // Arrange + Act — anon não tem JWT: é a sessão da anon key sem login.
    let negadas = 0;
    for (const operacao of OPERACOES) {
      const motivo = erroSob("anon", comandoDe(operacao, ORG));
      // Assert
      expect(
        motivo ?? SEM_ERRO,
        `anon alcançou mock_outbox no ${operacao} — a anon key lê a caixa de saída`,
      ).toContain("permission denied");
      negadas += 1;
    }

    console.info(`f03-t02-rls: anon_negado=${negadas}/${OPERACOES.length}`);
  });

  it("service_role continua escrevendo e lendo (guarda de vacuidade)", () => {
    // Arrange + Act — as mesmas quatro operações, agora pelo dono do dado.
    let permitidas = 0;
    for (const operacao of OPERACOES) {
      const motivo = erroSob("service_role", comandoDe(operacao, ORG));
      // Assert — se QUALQUER uma falhar, as recusas acima deixam de significar
      // "grant ausente" e podem significar "tabela ausente".
      expect(
        // Aqui o argumento é o `motivo` CRU: a asserção é `toBeNull()`, e
        // `?? SEM_ERRO` transformaria o caso verde em vermelho.
        motivo,
        `service_role perdeu o ${operacao} em mock_outbox — o adapter mock para de funcionar`,
      ).toBeNull();
      permitidas += 1;
    }

    // E a linha escrita pelo service_role é LIDA por ele na mesma transação:
    // "não deu erro" sozinho aprovaria um grant que não alcança dado nenhum.
    // O `rollback` imprime o tag `ROLLBACK` DEPOIS do resultado, então a linha
    // que interessa não é a última: é a última que tem a forma `n/d`.
    const lida =
      sql(`
        begin;
        set local role service_role;
        insert into public.mock_outbox
          (organization_id,conversation_id,to_e164,body,idempotency_key)
        values('${ORG}','${CONVERSA}','+5511900000003','prova de vacuidade','f03-t02-vacuidade');
        select count(*)::text || '/1' from public.mock_outbox
          where organization_id='${ORG}' and idempotency_key='f03-t02-vacuidade';
        rollback;
      `)
        .split("\n")
        .map((linha) => linha.trim())
        .filter((linha) => /^\d+\/\d+$/.test(linha))
        .at(-1) ?? "";
    expect(lida, "service_role escreveu e não leu de volta").toBe("1/1");

    console.info(
      `f03-t02-rls: service_role_permitido=${permitidas}/${OPERACOES.length} linha_lida_de_volta=${lida}`,
    );
  });
});

describe("F03-T02 — a idempotência é do índice, não do código", () => {
  it("o índice único recusa a segunda linha com a mesma (organization_id, idempotency_key)", () => {
    // Arrange — a primeira linha entra; a segunda é o reenvio.
    const primeira = erroDe(`
      begin;
      insert into public.mock_outbox(organization_id,conversation_id,to_e164,body,idempotency_key)
        values('${ORG}','${CONVERSA}','+5511900000001','primeiro envio','${CHAVE}');
      rollback;
    `);

    // Act
    const segunda = erroDe(`
      begin;
      insert into public.mock_outbox(organization_id,conversation_id,to_e164,body,idempotency_key)
        values('${ORG}','${CONVERSA}','+5511900000001','primeiro envio','${CHAVE}');
      insert into public.mock_outbox(organization_id,conversation_id,to_e164,body,idempotency_key)
        values('${ORG}','${CONVERSA}','+5511900000001','reenvio da mesma chave','${CHAVE}');
      rollback;
    `);

    // Assert
    expect(primeira, "o primeiro envio foi recusado").toBeNull();
    expect(segunda, "o índice único aceitou a segunda linha da mesma chave").not.toBeNull();
    expect(segunda).toMatch(/mock_outbox_org_idempotency_unique/);
    console.info("f03-t02: primeiro_envio_aceito=1/1 reenvio_recusado=1/1");
  });

  it("`on conflict do nothing` — o caminho do adapter — deixa UMA linha", () => {
    // Arrange + Act — é literalmente o INSERT de src/channels/mock.ts, duas vezes.
    const contagem = ultimaLinha(
      sql(`
        begin;
        insert into public.mock_outbox(organization_id,conversation_id,to_e164,body,idempotency_key)
          values('${ORG}','${CONVERSA}','+5511900000001','envio','${CHAVE}')
          on conflict (organization_id, idempotency_key) do nothing;
        insert into public.mock_outbox(organization_id,conversation_id,to_e164,body,idempotency_key)
          values('${ORG}','${CONVERSA}','+5511900000001','reenvio','${CHAVE}')
          on conflict (organization_id, idempotency_key) do nothing;
        select count(*)::text || '/' || 1::text from public.mock_outbox
          where organization_id='${ORG}' and idempotency_key='${CHAVE}';
        rollback;
      `)
        .split("\n")
        .map((linha) => linha.trim())
        .filter((linha) => /^\d+\/\d+$/.test(linha))
        .at(-1) ?? "",
    );

    // Assert — e o corpo é o do PRIMEIRO envio: `do nothing` não reescreve.
    expect(contagem, "o mock duplicou a linha do reenvio").toBe("1/1");
    console.info(`f03-t02: linhas_apos_reenvio=${contagem}`);
  });
});

describe("F03-T02 — o tenant é obrigatório", () => {
  it("linha sem organização é recusada", () => {
    // Arrange + Act
    const erro = erroDe(`
      begin;
      insert into public.mock_outbox(conversation_id,to_e164,body,idempotency_key)
        values('${CONVERSA}','+5511900000001','sem tenant','f03-t02-sem-tenant');
      rollback;
    `);

    // Assert
    expect(erro, "mock_outbox aceitou linha sem organization_id (D06/D20)").not.toBeNull();
    expect(erro).toMatch(/organization_id/);
    console.info("f03-t02: escrita_sem_tenant_recusada=1/1");
  });
});
