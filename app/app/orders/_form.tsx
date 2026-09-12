"use client";

import { randomId } from "@/lib/random-id";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { OrderItemCommand } from "@/src/crm/orders/commands";
import { matchedQuantity, moneyInput, parseMoneyInput } from "./_presentation";

export type DraftItem = OrderItemCommand & { quantity_input: string };

type ContactOption = {
  id: string;
  display_name: string | null;
  name: string | null;
};
type ProductOption = {
  id: string;
  nome: string;
  codigo: string | null;
  preco_cents: number | null;
  moeda: string | null;
  sale_unit: string | null;
};

export function newItem(position = 1): DraftItem {
  return {
    id: randomId(),
    position,
    requested_text: "",
    product_id: null,
    product_name: null,
    sale_unit: null,
    quantity: null,
    quantity_input: "",
    unit_price_cents: null,
    currency: null,
  };
}

function contactLabel(contact: ContactOption, t: (text: string) => string) {
  return contact.display_name ?? contact.name ?? t("Contato sem nome");
}

function OrderItemEditor({
  item,
  disabled,
  onChange,
  onRemove,
}: {
  item: DraftItem;
  disabled: boolean;
  onChange: (patch: Partial<DraftItem>) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const [priceInput, setPriceInput] = React.useState(moneyInput(item.unit_price_cents));
  const previousPrice = React.useRef(item.unit_price_cents);
  const [productSearch, setProductSearch] = React.useState("");
  const [products, setProducts] = React.useState<ProductOption[]>([]);
  const [loadingProducts, setLoadingProducts] = React.useState(false);
  const [productError, setProductError] = React.useState(false);

  React.useEffect(() => {
    if (previousPrice.current !== item.unit_price_cents) {
      previousPrice.current = item.unit_price_cents;
      setPriceInput(moneyInput(item.unit_price_cents));
    }
  }, [item.unit_price_cents]);

  React.useEffect(() => {
    const term = productSearch.trim();
    if (term.length < 2) return;
    const controller = new AbortController();
    void apiClient
      .get<{ data: ProductOption[] }>(`/api/v1/products?busca=${encodeURIComponent(term)}`, {
        signal: controller.signal,
      })
      .then((response) => {
        if (!controller.signal.aborted) setProducts(response.data);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setProducts([]);
          setProductError(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingProducts(false);
      });
    return () => controller.abort();
  }, [productSearch]);

  return (
    <fieldset className="grid gap-2 rounded-md border p-3" disabled={disabled}>
      <legend className="px-1 text-sm font-medium">
        {t("Item")} {item.position}
      </legend>
      <label className="grid gap-1 text-sm">
        {t("Descrição solicitada")}
        <input
          value={item.requested_text}
          placeholder={t("Ex.: 10 caixas do produto")}
          onChange={(event) => onChange({ requested_text: event.target.value })}
        />
      </label>
      <label className="grid gap-1 text-sm">
        {t("Buscar produto")}
        <input
          type="search"
          value={productSearch}
          placeholder={t("Digite ao menos 2 caracteres")}
          onChange={(event) => {
            const next = event.target.value;
            setProductSearch(next);
            if (next.trim().length < 2) {
              setProducts([]);
              setProductError(false);
              setLoadingProducts(false);
            } else {
              setLoadingProducts(true);
              setProductError(false);
            }
          }}
        />
      </label>
      {loadingProducts && (
        <p className="text-sm text-muted-foreground">{t("Buscando produtos…")}</p>
      )}
      {productError && (
        <p className="text-sm text-destructive" role="alert">
          {t("Não foi possível buscar produtos. Tente novamente.")}
        </p>
      )}
      {!loadingProducts &&
        !productError &&
        productSearch.trim().length >= 2 &&
        products.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("Nenhum produto encontrado.")}</p>
        )}
      {products.length === 500 && (
        <p className="text-sm text-muted-foreground">{t("Há muitos produtos. Refine a busca.")}</p>
      )}
      {products.length > 0 && (
        <ul className="rounded-md border" aria-label={t("Resultados de produtos")}>
          {products.map((product) => (
            <li key={product.id}>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  onChange({
                    product_id: product.id,
                    product_name: product.nome,
                    requested_text: item.requested_text || product.nome,
                    sale_unit: product.sale_unit,
                    quantity: matchedQuantity(item.quantity_input, product.sale_unit),
                    unit_price_cents: product.preco_cents,
                    currency: product.moeda,
                  });
                  setPriceInput(moneyInput(product.preco_cents));
                  setProductSearch("");
                  setProducts([]);
                }}
              >
                {product.nome}
                {product.codigo ? ` (${product.codigo})` : ""}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <label className="grid gap-1 text-sm">
        {t("Quantidade")}
        <input
          value={item.quantity_input}
          placeholder={t("Ex.: 1,5 cx")}
          onChange={(event) => {
            const quantity_input = event.target.value;
            onChange({ quantity_input, quantity: matchedQuantity(quantity_input, item.sale_unit) });
          }}
        />
      </label>
      {item.quantity_input && item.quantity === null && (
        <p className="text-sm text-muted-foreground">
          {t("Quantidade ou unidade pendente de revisão. Use vírgula para decimais.")}
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        {t("Unidade")}: {item.sale_unit ?? t("Unidade não definida")}
      </p>
      <label className="grid gap-1 text-sm">
        {t("Preço unitário")}
        <input
          inputMode="decimal"
          value={priceInput}
          placeholder={t("Ex.: 19,90")}
          onChange={(event) => {
            setPriceInput(event.target.value);
            onChange({ unit_price_cents: parseMoneyInput(event.target.value) });
          }}
        />
      </label>
      {priceInput && item.unit_price_cents === null && (
        <p role="alert">{t("Revise o preço, com no máximo duas casas decimais.")}</p>
      )}
      <label className="grid gap-1 text-sm">
        {t("Moeda do item")}
        <input
          value={item.currency ?? ""}
          maxLength={3}
          placeholder={t("Ex.: BRL")}
          onChange={(event) => onChange({ currency: event.target.value.toUpperCase() || null })}
        />
      </label>
      <Button type="button" variant="ghost" onClick={onRemove}>
        {t("Remover item")}
      </Button>
    </fieldset>
  );
}

export function OrderForm({
  contactId,
  onContactChange,
  items,
  onItemsChange,
  disabled,
  contactLocked = false,
}: {
  contactId: string;
  onContactChange: (contactId: string) => void;
  items: DraftItem[];
  onItemsChange: (items: DraftItem[]) => void;
  disabled: boolean;
  contactLocked?: boolean;
}) {
  const t = useT();
  const [contactSearch, setContactSearch] = React.useState("");
  const [contacts, setContacts] = React.useState<ContactOption[]>([]);
  const [loadingContacts, setLoadingContacts] = React.useState(false);
  const [contactError, setContactError] = React.useState(false);

  React.useEffect(() => {
    const term = contactSearch.trim();
    if (term.length < 2) return;
    const controller = new AbortController();
    void apiClient
      .get<{ data: ContactOption[] }>(
        `/api/v1/contacts?search=${encodeURIComponent(term)}&limit=10`,
        { signal: controller.signal },
      )
      .then((response) => {
        if (!controller.signal.aborted) setContacts(response.data);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setContacts([]);
          setContactError(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingContacts(false);
      });
    return () => controller.abort();
  }, [contactSearch]);

  const updateItem = (index: number, patch: Partial<DraftItem>) => {
    onItemsChange(items.map((item, current) => (current === index ? { ...item, ...patch } : item)));
  };
  const removeItem = (index: number) => {
    onItemsChange(
      items
        .filter((_, current) => current !== index)
        .map((item, current) => ({ ...item, position: current + 1 })),
    );
  };

  return (
    <section className="space-y-4" data-testid="pedido-formulario">
      <fieldset className="space-y-2" disabled={disabled || contactLocked}>
        <label className="grid gap-1 text-sm">
          {t("Buscar contato")}
          <input
            type="search"
            value={contactSearch}
            placeholder={t("Digite ao menos 2 caracteres")}
            onChange={(event) => {
              const next = event.target.value;
              setContactSearch(next);
              if (next.trim().length < 2) {
                setContacts([]);
                setContactError(false);
                setLoadingContacts(false);
              } else {
                setLoadingContacts(true);
                setContactError(false);
              }
            }}
          />
        </label>
        {loadingContacts && (
          <p className="text-sm text-muted-foreground">{t("Buscando contatos…")}</p>
        )}
        {contactError && (
          <p className="text-sm text-destructive" role="alert">
            {t("Não foi possível buscar contatos. Tente novamente.")}
          </p>
        )}
        {!loadingContacts &&
          !contactError &&
          contactSearch.trim().length >= 2 &&
          contacts.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("Nenhum contato encontrado.")}</p>
          )}
        {contacts.length > 0 && (
          <ul className="rounded-md border" aria-label={t("Resultados de contatos")}>
            {contacts.map((contact) => (
              <li key={contact.id}>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    onContactChange(contact.id);
                    setContactSearch(contactLabel(contact, t));
                    setContacts([]);
                  }}
                >
                  {contactLabel(contact, t)}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {contactId && <p className="text-sm text-muted-foreground">{t("Contato selecionado.")}</p>}
      </fieldset>
      <div className="space-y-3" data-testid="pedido-itens">
        {items.map((item, index) => (
          <OrderItemEditor
            key={item.id}
            item={item}
            disabled={disabled}
            onChange={(patch) => updateItem(index, patch)}
            onRemove={() => removeItem(index)}
          />
        ))}
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => onItemsChange([...items, newItem(items.length + 1)])}
        >
          {t("Adicionar item")}
        </Button>
      </div>
    </section>
  );
}
