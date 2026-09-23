/**
 * F03-T01 — o estado D16 no banco (migration 9013, ADR-016).
 *
 * Mede o que o TypeScript não alcança: a coluna existe e é obrigatória, o
 * CHECK novo recusa vocabulário estranho, o CHECK HERDADO continua intacto, o
 * gatilho projeta os sete status legados, a supressão de `transition()`
 * funciona, as funções novas estão fechadas a anon/authenticated (G-54) e a
 * RLS herdada de `conversations` continua ligada.
 */
import { describe, expect, it, beforeAll } from "vitest";

import { CONVERSATION_STATES, LEGACY_STATUSES, LEGACY_TO_D16 } from "@/src/conversation";
import { motivoDoErro, sql } from "@/tests/invariants/psql-transporte";

const ORG = "f0300001-0000-4000-8000-000000000001";
const CONTATO = "f0300001-2000-4000-8000-000000000001";
const SESSAO = "f0300001-3000-4000-8000-000000000001";
const CONVERSA = "f0300001-4000-4000-8000-000000000001";

/**
 * O vocabulário vem DA TABELA D16 e do mapa em TypeScript (src/conversation),
 * nunca de literais repetidos aqui: o que este arquivo mede é o banco CONTRA o
 * código, e uma segunda cópia da lista mediria o banco contra a memória.
 */
const ESTADOS_D16 = CONVERSATION_STATES;
const STATUS_LEGADOS = LEGACY_STATUSES;

/**
 * Pares (status legado, saas_state projetado) — derivados de `LEGACY_TO_D16`.
 * A ORDEM é a das escritas: cada linha é um UPDATE de verdade, e ir de um
 * estado terminal para `open`/`pending` acorda o roteamento herdado, que não é
 * o que esta prova mede. Começar por `pending` mantém o passeio nos sete
 * valores sem tocar naquele caminho.
 */
const ORDEM_DE_ESCRITA = [
  "pending",
  "open",
  "claimed",
  "ai_handling",
  "resolved",
  "closed",
  "archived",
] as const;
const PROJECAO = ORDEM_DE_ESCRITA.map(
  (legado) => [legado, LEGACY_TO_D16[legado]] as const,
);

function ultimaLinha(saida: string): string {
  const linhas = saida
    .split("\n")
    .map((linha) => linha.trim())
    .filter((linha) => linha.length > 0);
  const ultima = linhas.at(-1);
  if (ultima === undefined) throw new Error(`psql não devolveu linha nenhuma: ${saida}`);
  return ultima;
}

/**
 * A última linha que casa com a FORMA esperada.
 *
 * Num script com `begin`/`rollback` o psql imprime as etiquetas de comando
 * (`BEGIN`, `DO`, `ROLLBACK`) no mesmo stdout do resultado; pegar a última
 * linha crua mediria "ROLLBACK" e a asserção falaria de outra coisa.
 */
function linhaQueCasa(saida: string, padrao: RegExp): string {
  const casada = saida
    .split("\n")
    .map((linha) => linha.trim())
    .filter((linha) => padrao.test(linha))
    .at(-1);
  if (casada === undefined) {
    throw new Error(`psql não devolveu linha no formato ${padrao}: ${saida}`);
  }
  return casada;
}

function erroDe(script: string): string | null {
  try {
    sql(script);
    return null;
  } catch (error) {
    return motivoDoErro(error);
  }
}

beforeAll(() => {
  sql(`
    insert into public.organizations(id,slug,legal_name,display_name)
      values('${ORG}','f03-t01','F03 T01','F03 T01');
    insert into public.contacts(id,organization_id,display_name)
      values('${CONTATO}','${ORG}','Contato F03');
    insert into public.channel_sessions
      (id,organization_id,waha_session_name,webhook_secret_encrypted)
      values('${SESSAO}','${ORG}','f03-t01-sessao',decode('deadbeef','hex'));
    insert into public.conversations
      (id,organization_id,contact_id,channel_session_id,status)
      values('${CONVERSA}','${ORG}','${CONTATO}','${SESSAO}','open');
  `);
});

describe("F03-T01 — coluna, CHECK novo e CHECK herdado", () => {
  it("a ordem de escrita da prova cobre os sete status herdados", () => {
    // Arrange + Act
    const cobertos = new Set(ORDEM_DE_ESCRITA);

    // Assert
    expect([...cobertos].sort()).toEqual([...STATUS_LEGADOS].sort());
    console.info(
      `f03-t01: status_cobertos=${cobertos.size}/${STATUS_LEGADOS.length}`,
    );
  });

  it("saas_state existe, é not null e o CHECK novo aceita exatamente os oito estados", () => {
    // Arrange + Act
    const metadados = ultimaLinha(
      sql(`
        select
          (select count(*) from information_schema.columns
            where table_schema='public' and table_name='conversations'
              and column_name in ('saas_state','saas_state_entered_at')
              and is_nullable='NO'),
          (select count(*) from pg_constraint
            where conrelid='public.conversations'::regclass
              and conname='conversations_saas_state_check'),
          (select count(*) from unnest(array[${ESTADOS_D16.map((e) => `'${e}'`).join(",")}]) v
            where pg_get_constraintdef(c.oid) like '%''' || v || '''%'),
          (select count(*) from regexp_matches(pg_get_constraintdef(c.oid),'''([a-z_]+)''','g'))
        from pg_constraint c
        where c.conrelid='public.conversations'::regclass
          and c.conname='conversations_saas_state_check';
      `),
    );

    // Assert
    expect(metadados, "coluna/CHECK de saas_state fora do desenho da ADR-016").toBe(
      `2|1|${ESTADOS_D16.length}|${ESTADOS_D16.length}`,
    );
    console.info(
      `f03-t01: saas_state_notnull=2/2 saas_state_values=${ESTADOS_D16.length}/${ESTADOS_D16.length}`,
    );
  });

  it("o CHECK novo aceita os oito estados e recusa valor fora do vocabulário", () => {
    // Arrange + Act — os oito são aceitos um a um; o inventado é recusado.
    const aceitos = ESTADOS_D16.filter(
      (estado) =>
        erroDe(`
          begin;
          update public.conversations set saas_state='${estado}' where id='${CONVERSA}';
          rollback;
        `) === null,
    ).length;
    const erro = erroDe(`
      begin;
      update public.conversations set saas_state='estado_inventado' where id='${CONVERSA}';
      rollback;
    `);

    // Assert
    expect(aceitos, "CHECK recusou estado que D16 declara").toBe(ESTADOS_D16.length);
    expect(erro, "CHECK aceitou estado fora dos oito de D16").not.toBeNull();
    expect(erro).toMatch(/conversations_saas_state_check/);
    console.info(
      `f03-t01: estados_aceitos=${aceitos}/${ESTADOS_D16.length} estado_invalido_recusado=1/1`,
    );
  });

  it("o CHECK herdado conversations_status_check continua com os sete valores originais", () => {
    // Arrange + Act
    const herdado = ultimaLinha(
      sql(`
        select
          (select count(*) from unnest(array[${STATUS_LEGADOS.map((s) => `'${s}'`).join(",")}]) v
            where pg_get_constraintdef(c.oid) like '%''' || v || '''%'),
          (select count(*) from regexp_matches(pg_get_constraintdef(c.oid),'''([a-z_]+)''','g'))
        from pg_constraint c
        where c.conrelid='public.conversations'::regclass
          and c.conname='conversations_status_check';
      `),
    );

    // Assert — sete presentes E sete no total: acrescentar valor reprova aqui.
    expect(herdado, "F03 mexeu no CHECK herdado de status").toBe(
      `${STATUS_LEGADOS.length}|${STATUS_LEGADOS.length}`,
    );
    console.info(
      `f03-t01: legacy_status_values=${STATUS_LEGADOS.length}/${STATUS_LEGADOS.length}`,
    );
  });
});

describe("F03-T01 — projeção do ciclo herdado e supressão da autoridade", () => {
  it("o gatilho projeta cada um dos sete status legados no estado D16 do mapa", () => {
    // Arrange + Act — a contagem vem das linhas medidas, nunca de um literal.
    const contagem = linhaQueCasa(
      sql(`
        begin;
        create temp table f03_projecao(legacy text, esperado text, obtido text) on commit drop;
        do $proof$
        declare v record;
        begin
          for v in select * from (values
            ${PROJECAO.map(([legado, esperado]) => `('${legado}','${esperado}')`).join(",\n            ")}
          ) as t(legacy,esperado)
          loop
            update public.conversations set status=v.legacy where id='${CONVERSA}';
            insert into f03_projecao(legacy,esperado,obtido)
              select v.legacy, v.esperado, saas_state
                from public.conversations where id='${CONVERSA}';
          end loop;
        end
        $proof$;
        select count(*) filter (where obtido=esperado)::text || '/' || count(*)::text
          from f03_projecao;
        rollback;
      `),
      /^\d+\/\d+$/,
    );

    // Assert
    expect(
      contagem,
      "projeção do status legado não chegou ao saas_state esperado",
    ).toBe(`${PROJECAO.length}/${PROJECAO.length}`);
    console.info(`f03-t01: legacy_projected=${contagem}`);
  });

  it("escrita legada de status com app.conversation_transition=1 não move saas_state", () => {
    // Arrange + Act — o sinal é o que `transition()` põe antes de escrever.
    const observado = linhaQueCasa(
      sql(`
        begin;
        select set_config('app.conversation_transition','1',true);
        update public.conversations set status='archived' where id='${CONVERSA}';
        select saas_state || '|' || status from public.conversations where id='${CONVERSA}';
        rollback;
      `),
      /^[a-z_]+\|[a-z_]+$/,
    );

    // Assert — status andou, saas_state ficou onde a autoridade o deixou.
    expect(observado, "a projeção escreveu por cima do movimento da autoridade").toBe(
      "open|archived",
    );
    console.info("f03-t01: suppressed=1/1 status_moved=1/1");
  });
});

describe("F03-T01 — postura das funções novas e RLS herdada", () => {
  it("as funções novas não têm execute para anon nem authenticated e service_role mantém", () => {
    // Arrange + Act
    const acl = ultimaLinha(
      sql(`
        select
          has_function_privilege('anon','public.fn_saas_state_from_legacy(text)','execute')::int,
          has_function_privilege('authenticated','public.fn_saas_state_from_legacy(text)','execute')::int,
          has_function_privilege('anon','public.fn_saas_state_project()','execute')::int,
          has_function_privilege('authenticated','public.fn_saas_state_project()','execute')::int,
          has_function_privilege('service_role','public.fn_saas_state_from_legacy(text)','execute')::int,
          has_function_privilege('service_role','public.fn_saas_state_project()','execute')::int;
      `),
    );

    // Assert
    expect(acl, "função de estado exposta a anon/authenticated (G-54)").toBe("0|0|0|0|1|1");
    console.info("f03-t01: funcoes_fechadas=4/4 service_role_mantido=2/2");
  });

  it("a RLS herdada de conversations continua ligada e com policies", () => {
    // Arrange + Act
    const rls = ultimaLinha(
      sql(`
        select
          (select relrowsecurity::int from pg_class where oid='public.conversations'::regclass),
          (select (count(*) > 0)::int from pg_policies
            where schemaname='public' and tablename='conversations'),
          (select count(*) from pg_policies
            where schemaname='public' and tablename='conversations');
      `),
    );

    // Assert
    const [ligada, temPolicy, quantas] = rls.split("|");
    expect(`${ligada}|${temPolicy}`, "F03 desligou a RLS ou removeu policy de conversations").toBe(
      "1|1",
    );
    console.info(`f03-t01: rls_conversations=1/1 policies=${quantas}/${quantas}`);
  });
});
