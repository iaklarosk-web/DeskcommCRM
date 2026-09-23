// @vitest-environment node
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

import {
  F02FixtureError,
  fixtureUuid,
  materializeF02Fixtures,
  parseF02Fixtures,
} from "../../src/tenant-config/f02-fixtures";

const raw = parseYaml(
  fs.readFileSync(
    fileURLToPath(new URL("../../docs/tenants/demo2.f02-fixtures.yaml", import.meta.url)),
    "utf8",
  ),
) as Record<string, unknown>;
const context = {
  tenantSlug: "demo2",
  seedUserEmails: ["admin@demo2.test", "atende@demo2.test"],
};
const ORG_A = "a7000000-0000-4000-8000-000000000001";
const ORG_B = "b7000000-0000-4000-8000-000000000002";

describe("F02-T07 — parser puro das fixtures", () => {
  it("aceita somente o documento sintético estrito com duas empresas", () => {
    const parsed = parseF02Fixtures(raw, context);
    expect(parsed.companies).toHaveLength(2);
    expect(parsed.contacts).toHaveLength(2);
    expect(parsed.actor_email.endsWith(".test")).toBe(true);
  });

  it.each([
    ["marcador ausente", { ...raw, fictional_only: false }],
    ["tenant divergente", { ...raw, tenant_slug: "outro" }],
    [
      "telefone de contato",
      {
        ...raw,
        contacts: [
          { ...(raw.contacts as object[])[0], phone_number: "+5511999999999" },
          ...(raw.contacts as object[]).slice(1),
        ],
      },
    ],
    [
      "CNPJ de empresa",
      {
        ...raw,
        companies: [
          { ...(raw.companies as object[])[0], cnpj: "00000000000000" },
          ...(raw.companies as object[]).slice(1),
        ],
      },
    ],
  ])("recusa %s antes de qualquer writer", (_title, candidate) => {
    expect(() => parseF02Fixtures(candidate, context)).toThrow();
  });

  it("recusa usuário-base fora de .test e ator não pertencente ao seed", () => {
    expect(() =>
      parseF02Fixtures(raw, { ...context, seedUserEmails: ["pessoa@example.com"] }),
    ).toThrowError(new F02FixtureError("fixture_seed_users_must_be_test_only"));
    expect(() =>
      parseF02Fixtures(raw, { ...context, seedUserEmails: ["outro@demo2.test"] }),
    ).toThrowError(new F02FixtureError("fixture_actor_missing_from_seed"));
  });

  it("resolve refs e recusa duplicatas e referências ausentes", () => {
    const companies = raw.companies as Record<string, unknown>[];
    expect(() =>
      parseF02Fixtures(
        { ...raw, companies: [companies[0], { ...companies[1], ref: companies[0]?.ref }] },
        context,
      ),
    ).toThrowError(new F02FixtureError("fixture_duplicate_company_ref"));
    const contacts = raw.contacts as Record<string, unknown>[];
    expect(() =>
      parseF02Fixtures(
        { ...raw, contacts: [{ ...contacts[0], company_ref: "inexistente" }, contacts[1]] },
        context,
      ),
    ).toThrowError(new F02FixtureError("fixture_unknown_company_ref"));
  });

  it("canonicaliza PT-BR, preserva unidades e mantém pendências como null", () => {
    const materialized = materializeF02Fixtures(parseF02Fixtures(raw, context), ORG_A);
    const confirmed = materialized.orders.find((order) => order.ref === "confirmado-alfa")!;
    expect(confirmed.final.items.map((item) => [item.quantity, item.sale_unit])).toEqual([
      ["1000.000", "cx"],
      ["0.500", "kg"],
    ]);
    expect(confirmed.final.items.map((item) => item.line_total_cents)).toEqual([2_500_000, 600]);
    expect(confirmed.final.total_cents).toBe(2_500_600);
    expect(confirmed.final.pending).toEqual([]);

    const draft = materialized.orders.find((order) => order.ref === "rascunho-beta-pendente")!;
    expect(draft.final.delivery_date).toBeNull();
    expect(draft.final.currency).toBeNull();
    expect(draft.final.total_cents).toBeNull();
    expect(draft.final.items[0]).toMatchObject({
      product_id: null,
      sale_unit: null,
      quantity: null,
      unit_price_cents: null,
      line_total_cents: null,
    });
  });

  it("não converte unidade incompatível nem inventa arredondamento", () => {
    const orders = raw.orders as Record<string, unknown>[];
    const confirmed = orders[0]!;
    const items = confirmed.items as Record<string, unknown>[];
    expect(() =>
      materializeF02Fixtures(
        parseF02Fixtures(
          {
            ...raw,
            orders: [
              { ...confirmed, items: [{ ...items[0], quantity_input: "1.000 kg" }, items[1]] },
              ...orders.slice(1),
            ],
          },
          context,
        ),
        ORG_A,
      ),
    ).toThrowError("unit_conversion_required");

    const products = raw.products as Record<string, unknown>[];
    expect(() =>
      materializeF02Fixtures(
        parseF02Fixtures(
          {
            ...raw,
            products: products.map((product) =>
              product.ref === "material-kg" ? { ...product, price_cents: 1 } : product,
            ),
          },
          context,
        ),
        ORG_A,
      ),
    ).toThrowError(new F02FixtureError("fixture_terminal_order_has_pending_fields"));
  });

  it("gera IDs estáveis por organização e tipos/tenants distintos não colidem", () => {
    expect(fixtureUuid(ORG_A, "company", "empresa-alfa")).toBe(
      fixtureUuid(ORG_A, "company", "empresa-alfa"),
    );
    expect(fixtureUuid(ORG_A, "company", "empresa-alfa")).not.toBe(
      fixtureUuid(ORG_B, "company", "empresa-alfa"),
    );
    expect(fixtureUuid(ORG_A, "company", "empresa-alfa")).not.toBe(
      fixtureUuid(ORG_A, "contact", "empresa-alfa"),
    );
    expect(fixtureUuid(ORG_A, "company", "empresa-alfa")[14]).toBe("8");
  });
});
