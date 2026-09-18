/**
 * F03-T04 — a idempotência de entrada é do BANCO, não do TypeScript.
 *
 * Provar "não duplica" em código provaria o dublê: quem recusa a segunda linha
 * é o índice único parcial da migration 9015. Este arquivo mede o índice, mede
 * que a constraint HERDADA continuou exatamente como estava (mesmo nome, mesmas
 * colunas, mesmo diferimento) e mede que a linha legada — a que tem `provider`
 * nulo — não passou a ser bloqueada por nada novo.
 *
 * Cada bloco imprime contagem COM denominador (G-14): "passou" sem numerador é
 * a mesma coisa que não ter medido.
 */
import { describe, expect, it, beforeAll } from "vitest";

import { motivoDoErro, sql } from "@/tests/invariants/psql-transporte";

const ORG = "f0300004-0000-4000-8000-000000000001";
const CONTATO = "f0300004-2000-4000-8000-000000000001";
const SESSAO = "f0300004-3000-4000-8000-000000000001";
const CONVERSA = "f0300004-4000-4000-8000-000000000001";

const INDICE = "messages_org_provider_external_uk";
const CONSTRAINT_HERDADA = "messages_org_external_id_unique";

/** Uma linha de `messages` com só o que as colunas NOT NULL exigem. */
function inserirMensagem(
  externalId: string | null,
  provider: string | null,
  sufixo: string,
): string {
  return `insert into public.messages
    (organization_id, conversation_id, channel_session_id, contact_id,
     external_id, provider, type, direction, status, body)
   values ('${ORG}','${CONVERSA}','${SESSAO}','${CONTATO}',
     ${externalId === null ? "null" : `'${externalId}'`},
     ${provider === null ? "null" : `'${provider}'`},
     'text','inbound','delivered','linha ${sufixo}');`;
}

beforeAll(() => {
  sql(`
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG}','f03-t04-idem','F03 T04 Idempotencia','F03 T04');
    insert into public.contacts (id, organization_id, display_name, phone_number)
      values ('${CONTATO}','${ORG}','Contato F03 T04','+5511900000001');
    insert into public.channel_sessions
      (id, organization_id, waha_session_name, webhook_secret_encrypted)
      values ('${SESSAO}','${ORG}','sessao-f03-t04','\\x00'::bytea);
    insert into public.conversations
      (id, organization_id, contact_id, channel_session_id, channel, status, is_group)
      values ('${CONVERSA}','${ORG}','${CONTATO}','${SESSAO}','whatsapp','open',false);
  `);
});

describe("F03-T04 — o índice único parcial da tripla (org, provider, external_id)", () => {
  it("existe, é único, cobre as três colunas e só olha linha com provider e external_id", () => {
    // Arrange — as quatro afirmações que fazem o índice ser o que a §5.7 pede.
    const definicao = sql(
      `select indexdef from pg_indexes
        where schemaname='public' and tablename='messages' and indexname='${INDICE}';`,
    );
    const unico = sql(
      `select i.indisunique from pg_index i join pg_class c on c.oid=i.indexrelid
        where c.relname='${INDICE}';`,
    );

    // Act + Assert — quatro checagens, denominador quatro.
    const checagens: Array<[string, boolean]> = [
      ["índice existe", definicao.length > 0],
      ["é único", unico.trim() === "t"],
      [
        "cobre (organization_id, provider, external_id)",
        /\(organization_id,\s*provider,\s*external_id\)/.test(definicao),
      ],
      [
        "é parcial em provider e external_id não nulos",
        /where\s+\(\(provider\s+is\s+not\s+null\)\s+and\s+\(external_id\s+is\s+not\s+null\)\)/i.test(
          definicao,
        ),
      ],
    ];
    const passaram = checagens.filter(([, ok]) => ok);
    for (const [nome, ok] of checagens) expect(ok, `${INDICE}: ${nome} falhou`).toBe(true);
    console.log(
      `f03-t04-indice: checks=${passaram.length}/${checagens.length} indexdef_len=${definicao.length}`,
    );
  });

  it("recusa a SEGUNDA linha com a mesma (organization_id, provider, external_id)", () => {
    // Arrange
    const externo = "f03-t04-tripla-repetida";
    sql(inserirMensagem(externo, "mock", "primeira"));

    // Act
    let recusa = "";
    try {
      sql(inserirMensagem(externo, "mock", "segunda"));
    } catch (erro) {
      recusa = motivoDoErro(erro);
    }

    // Assert — a recusa tem de vir DESTE índice, e não de outra unicidade
    // qualquer que passasse na frente sem ninguém notar.
    expect(recusa, "a segunda linha da mesma tripla foi aceita").not.toBe("");
    expect(recusa).toContain(INDICE);
    const gravadas = sql(
      `select count(*) from public.messages
        where organization_id='${ORG}' and provider='mock' and external_id='${externo}';`,
    ).trim();
    expect(gravadas).toBe("1");
    console.log(`f03-t04-reentrega: stored=${gravadas}/1 recusas=1/1`);
  });
});

describe("F03-T04 — o contrato herdado não foi tocado", () => {
  it("a constraint herdada continua com o mesmo nome, as mesmas colunas e o mesmo diferimento", () => {
    // Arrange + Act
    const forma = sql(
      `select con.contype::text || '|' ||
              (select string_agg(a.attname, ',' order by k.ord)
                 from unnest(con.conkey) with ordinality as k(attnum, ord)
                 join pg_attribute a
                   on a.attrelid = con.conrelid and a.attnum = k.attnum) || '|' ||
              con.condeferrable::text || '|' || con.condeferred::text
         from pg_constraint con
        where con.conrelid = 'public.messages'::regclass
          and con.conname = '${CONSTRAINT_HERDADA}';`,
    ).trim();

    // Assert — quatro fatos numa linha só: tipo, colunas, deferível, diferida.
    const partes = forma.split("|");
    const checagens: Array<[string, boolean]> = [
      ["a constraint existe", partes.length === 4],
      ["continua UNIQUE", partes[0] === "u"],
      ["continua sobre (organization_id, external_id)", partes[1] === "organization_id,external_id"],
      // `::text` de boolean é "true"/"false" (não "t"/"f", que é a saída do psql).
      ["continua DEFERRABLE INITIALLY DEFERRED", partes[2] === "true" && partes[3] === "true"],
    ];
    const passaram = checagens.filter(([, ok]) => ok);
    for (const [nome, ok] of checagens)
      expect(ok, `${CONSTRAINT_HERDADA}: ${nome} falhou (leitura: ${forma})`).toBe(true);
    console.log(
      `f03-t04-herdada: checks=${passaram.length}/${checagens.length} forma=${forma}`,
    );
  });

  it("linha com provider nulo continua livre: o índice novo não a enxerga", () => {
    // Arrange — duas linhas legadas (provider e external_id nulos) e uma linha
    // legada com external_id próprio ao lado de uma linha SaaS.
    const antes = sql(
      `select count(*) from public.messages where organization_id='${ORG}';`,
    ).trim();

    // Act
    sql(inserirMensagem(null, null, "legada-1"));
    sql(inserirMensagem(null, null, "legada-2"));
    sql(inserirMensagem("f03-t04-legado", null, "legada-3"));
    sql(inserirMensagem("f03-t04-saas", "mock", "saas-1"));

    // Assert — as quatro entraram; nenhuma foi barrada pelo índice novo.
    const depois = sql(
      `select count(*) from public.messages where organization_id='${ORG}';`,
    ).trim();
    const escritas = Number(depois) - Number(antes);
    expect(escritas, "alguma linha legada foi barrada pelo índice novo").toBe(4);

    const semProvider = sql(
      `select count(*) from public.messages
        where organization_id='${ORG}' and provider is null;`,
    ).trim();
    expect(Number(semProvider)).toBe(3);
    console.log(`f03-t04-legado: escritas=${escritas}/4 provider_null=${semProvider}/3`);
  });
});

describe("F03-T04 — channel_accounts sabe qual sessão herdada usar", () => {
  it("tem phone_e164 e channel_session_id com FK para channel_sessions", () => {
    // Arrange + Act
    const colunas = sql(
      `select count(*) from information_schema.columns
        where table_schema='public' and table_name='channel_accounts'
          and column_name in ('phone_e164','channel_session_id');`,
    ).trim();
    const fk = sql(
      `select confdeltype from pg_constraint
        where conrelid='public.channel_accounts'::regclass
          and conname='channel_accounts_channel_session_fk' and contype='f';`,
    ).trim();

    // Assert — `r` é `on delete restrict`: apagar a sessão com conta apontada
    // falharia dentro da transação da mensagem do cliente.
    expect(colunas).toBe("2");
    expect(fk, "a FK não é on delete restrict").toBe("r");
    console.log(`f03-t03-conta: colunas=${colunas}/2 fk_on_delete=${fk}`);
  });
});
