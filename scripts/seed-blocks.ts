/**
 * Blocos `products`, `customers` e `faq` do seed YAML (§5.21) gravados nas
 * tabelas que F02/F04 adaptaram — ADR-029 §3 (VARREDURA §B13).
 *
 * Duas regras que este arquivo não relaxa:
 *
 * 1. IDEMPOTÊNCIA POR ID DETERMINÍSTICO. Cada linha nasce com
 *    `fixtureUuid(org, tipo, chave)` (a mesma função das fixtures da F02) e o
 *    INSERT é `on conflict do nothing`: a segunda execução do create-tenant
 *    cria ZERO linhas, que é o DoD da F01-T06. A chave é o que o seed tem de
 *    único — `sku` do produto, `phone` do cliente (e `name` quando o telefone
 *    falta), `company` da empresa.
 *
 * 2. NADA É INVENTADO. Item com sentinela `TODO-` em qualquer campo é
 *    pendência, não dado (§5.21, invariante 3 de §5.2): é CONTADO em
 *    `pendentes` e não vira linha — o deka de hoje tem produtos e respostas de
 *    FAQ inteiros em `TODO-DEKA`. Campo do seed sem coluna com o mesmo significado não
 *    ganha destino "parecido": `products[].size` é CONTADO e declarado pelo
 *    chamador; `customers[].recurring_weekday`/`notes` vão para
 *    `contacts.source_metadata.seed` — metadado da origem, como a coluna é.
 *
 * O FAQ vira UM material no acervo da organização (ADR-023) por
 * `ingerirDocumento`, com um parágrafo por par pergunta/resposta e o embutidor
 * determinístico (ADR-002): sem rede, sem chave, e a busca do turno acha o
 * que entrou. É idempotente pelo nome do material (`agent_id` nulo).
 */
import type pg from "pg";

import { ingerirDocumento } from "@/src/knowledge/ingestao";
import type { ServicePool } from "@/src/tenant-context/db";

import type { SeedCustomer, SeedFaq, SeedProduct } from "./create-tenant";

type Db = Pick<pg.PoolClient, "query">;
type IdDoSeed = (organizationId: string, kind: string, ref: string) => string;

export const NOME_DO_MATERIAL_FAQ = "FAQ do seed";
const ORIGEM = "seed";

export interface BlocosGravados {
  rowsCreated: number;
  products: number;
  customers: number;
  companies: number;
  /** Itens de products/customers com sentinela TODO- (pendência, não linha). */
  pendentes: number;
}

/** Sentinela de pendência em qualquer profundidade do item (mesma regra das settings). */
export function itemPendente(v: unknown): boolean {
  if (typeof v === "string") return v.startsWith("TODO-");
  if (Array.isArray(v)) return v.some(itemPendente);
  if (typeof v === "object" && v !== null) return Object.values(v).some(itemPendente);
  return false;
}

async function conta(db: Db, sql: string, params: unknown[]): Promise<number> {
  return (await db.query(sql, params)).rowCount ?? 0;
}

function textoOuErro(valor: unknown, campo: string): string {
  if (typeof valor !== "string" || valor.trim().length === 0) {
    throw new Error(`seed: ${campo} obrigatório e não vazio`);
  }
  return valor.trim();
}

export async function escreverBlocosDoSeed(
  db: Db,
  organizationId: string,
  seed: { products: SeedProduct[]; customers: SeedCustomer[] },
  idDoSeed: IdDoSeed,
): Promise<BlocosGravados> {
  const gravado: BlocosGravados = { rowsCreated: 0, products: 0, customers: 0, companies: 0, pendentes: 0 };

  for (const p of seed.products) {
    if (itemPendente(p)) {
      gravado.pendentes += 1;
      continue;
    }
    const sku = textoOuErro(p.sku, "products[].sku");
    if (!Number.isSafeInteger(p.price_cents) || p.price_cents < 0) {
      throw new Error(`seed: products[${sku}].price_cents inválido`);
    }
    const n = await conta(
      db,
      `insert into public.catalog_products
         (id, organization_id, codigo, nome, preco_cents, sale_unit, ativo, origem)
       values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict do nothing`,
      [
        idDoSeed(organizationId, "seed-product", sku),
        organizationId,
        sku,
        textoOuErro(p.name, `products[${sku}].name`),
        p.price_cents,
        typeof p.unit === "string" && p.unit.trim().length > 0 ? p.unit.trim() : null,
        p.active !== false,
        ORIGEM,
      ],
    );
    gravado.products += n;
    gravado.rowsCreated += n;
  }

  for (const c of seed.customers) {
    if (itemPendente(c)) {
      gravado.pendentes += 1;
      continue;
    }
    const nome = textoOuErro(c.name, "customers[].name");
    const telefone = typeof c.phone === "string" && c.phone.trim().length > 0 ? c.phone.trim() : null;
    const empresa = typeof c.company === "string" && c.company.trim().length > 0 ? c.company.trim() : null;
    let companyId: string | null = null;
    if (empresa) {
      companyId = idDoSeed(organizationId, "seed-company", empresa);
      const n = await conta(
        db,
        `insert into public.crm_companies (id, organization_id, legal_name, trade_name)
         values ($1, $2, $3, $3) on conflict do nothing`,
        [companyId, organizationId, empresa],
      );
      gravado.companies += n;
      gravado.rowsCreated += n;
    }
    const metadadoDoSeed: Record<string, unknown> = {};
    if (c.recurring_weekday !== undefined) metadadoDoSeed["recurring_weekday"] = c.recurring_weekday;
    if (typeof c.notes === "string" && c.notes.length > 0) metadadoDoSeed["notes"] = c.notes;
    const n = await conta(
      db,
      `insert into public.contacts
         (id, organization_id, name, display_name, phone_number, company_id, recurring, source, source_metadata)
       values ($1, $2, $3, $3, $4, $5, $6, $7, $8::jsonb) on conflict do nothing`,
      [
        idDoSeed(organizationId, "seed-customer", telefone ?? nome),
        organizationId,
        nome,
        telefone,
        companyId,
        c.recurring === true,
        ORIGEM,
        JSON.stringify(Object.keys(metadadoDoSeed).length > 0 ? { seed: metadadoDoSeed } : {}),
      ],
    );
    gravado.customers += n;
    gravado.rowsCreated += n;
  }

  return gravado;
}

/** Só os pares sem sentinela: pergunta com resposta `TODO-` é pendência. */
export function faqSemPendencia(faq: SeedFaq[]): { itens: SeedFaq[]; pendentes: number } {
  const itens = faq.filter((item) => !itemPendente(item));
  return { itens, pendentes: faq.length - itens.length };
}

export function textoDoFaq(faq: SeedFaq[]): string {
  return faq
    .map((item) => `P: ${textoOuErro(item.q, "faq[].q")}\nR: ${textoOuErro(item.a, "faq[].a")}`)
    .join("\n\n");
}

export async function ingerirFaqDoSeed(
  pool: ServicePool,
  organizationId: string,
  faqDoSeed: SeedFaq[],
): Promise<{ itens: number; pendentes: number; materiais: number; trechos: number; rowsCreated: number }> {
  const { itens: faq, pendentes } = faqSemPendencia(faqDoSeed);
  if (faq.length === 0) return { itens: 0, pendentes, materiais: 0, trechos: 0, rowsCreated: 0 };
  const existente = await pool.query<{ id: string; chunks_count: number }>(
    `select id, chunks_count from public.ai_knowledge_sources
      where organization_id = $1 and agent_id is null and name = $2 and is_active`,
    [organizationId, NOME_DO_MATERIAL_FAQ],
  );
  if ((existente.rowCount ?? 0) > 0) {
    return { itens: faq.length, pendentes, materiais: 0, trechos: Number(existente.rows[0]?.chunks_count ?? 0), rowsCreated: 0 };
  }
  const material = await ingerirDocumento(
    { organization_id: organizationId, source: "job" },
    { nome: NOME_DO_MATERIAL_FAQ, conteudo: textoDoFaq(faq) },
    { pool },
  );
  // material + versão + trechos: as linhas que a ingestão grava.
  return { itens: faq.length, pendentes, materiais: 1, trechos: material.trechos, rowsCreated: 2 + material.trechos };
}
