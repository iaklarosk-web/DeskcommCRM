"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useContact } from "@/hooks/contacts/useContact";
import { useT } from "@/hooks/i18n/useT";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";

export function OrderContactIdentity({ contactId }: { contactId: string }) {
  const t = useT();
  const query = useContact(contactId);
  const contact = query.data?.data;
  if (query.isLoading) return <p role="status">{t("Carregando contato…")}</p>;
  if (query.isError || !contact)
    return (
      <div className="space-y-1">
        <p role="alert">{t("Erro ao carregar contato.")}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void query.refetch()}
        >
          {t("Recarregar contato")}
        </Button>
      </div>
    );
  return (
    <p className="text-sm">
      {t("Contato")}:{" "}
      <Link className="underline" href={`/app/contacts/${contact.id}`}>
        {contact.is_anonymized
          ? t("Contato anonimizado")
          : rotuloDoContato(contact, t)}
      </Link>
    </p>
  );
}
