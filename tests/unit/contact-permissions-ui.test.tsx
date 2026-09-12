import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveOrg, AuthUser } from "@/lib/auth/types";
import type { Contact } from "@/lib/types/contacts";

const { auth, state, refetch, remove, merge, get, post } = vi.hoisted(() => ({
  auth: { user: {} as AuthUser, activeOrg: null as ActiveOrg | null },
  state: {
    contact: {} as Contact,
    profileError: false,
    duplicatesError: false,
  },
  refetch: vi.fn(),
  remove: vi.fn(),
  merge: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
}));
vi.mock("@/hooks/auth/AuthProvider", () => ({ useAuth: () => auth }));
vi.mock("@/lib/api/client", () => ({ apiClient: { get, post } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/contacts/useContact", () => ({
  useContact: () => ({
    data: state.profileError ? null : { data: state.contact },
    isError: state.profileError,
    refetch,
  }),
}));
vi.mock("@/hooks/contacts/useContactList", () => ({
  useContactList: () => ({
    data: { pages: [{ data: [state.contact] }] },
    refetch,
  }),
}));
vi.mock("@/hooks/contacts/useDeleteContact", () => ({
  useDeleteContact: () => ({ mutateAsync: remove, isPending: false }),
}));
vi.mock("@/hooks/contacts/useMergeContacts", () => ({
  useMergeContacts: () => ({ mutateAsync: merge, isPending: false }),
}));
vi.mock("@/hooks/contacts/useContactDuplicates", () => ({
  useContactDuplicates: () => ({
    data: state.duplicatesError
      ? null
      : {
          data: [
            {
              chave: "group",
              principal_sugerido: "contact",
              motivos: ["email"],
              contatos: [
                state.contact,
                {
                  ...state.contact,
                  id: "second",
                  name: "Outro contato",
                  display_name: "Outro contato",
                },
              ],
            },
          ],
        },
    isError: state.duplicatesError,
    refetch,
  }),
}));
vi.mock("@/hooks/pipelines/useDefaultPipeline", () => ({
  useDefaultPipeline: () => ({ data: null }),
}));
vi.mock("@/hooks/crm/useCrmAuthorNames", () => ({
  useCrmAuthorNames: () => ({}),
}));
vi.mock("@/components/crm/CrmNotes", () => ({ CrmNotes: () => null }));
vi.mock("@/components/crm/TaskHistory", () => ({ TaskHistory: () => null }));
vi.mock("@/components/contacts/TimelineView", () => ({
  TimelineView: () => <p>Timeline preservada</p>,
}));
vi.mock("@/components/contacts/EditContactDialog", () => ({
  EditContactDialog: ({ open }: { open: boolean }) => (open ? <p>Editar aberto</p> : null),
}));
vi.mock("@/components/contacts/NewContactDialog", () => ({
  NewContactDialog: ({ open }: { open: boolean }) => (open ? <p>Novo aberto</p> : null),
}));
vi.mock("@/components/contacts/ImportContactsDialog", () => ({
  ImportContactsDialog: ({ open }: { open: boolean }) => (open ? <p>Importação aberta</p> : null),
}));
vi.mock("@/components/contacts/AnonymizeDialog", () => ({
  AnonymizeDialog: () => null,
}));
vi.mock("@/components/contacts/PropostasDeDado", () => ({
  PropostasDeDado: () => null,
}));
vi.mock("@/components/kanban/ConversaNoDossie", () => ({
  ConversaNoDossie: () => null,
}));
vi.mock("@/app/app/contacts/[id]/_commercial-link", () => ({
  CommercialLink: ({ podeEditar }: { podeEditar: boolean }) => (
    <p>{podeEditar ? "Vínculo editável" : "Vínculo somente leitura"}</p>
  ),
}));

import { contactPermissions } from "@/hooks/contacts/useContactPermissions";
import { ContactDetailClient } from "@/app/app/contacts/[id]/_client";
import { ContactsListClient } from "@/app/app/contacts/_client";
import { MergeDialog } from "@/components/contacts/MergeDialog";

function mount(ui: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>,
  );
}
function tab(name: string) {
  fireEvent.mouseDown(screen.getByRole("tab", { name }), {
    button: 0,
    ctrlKey: false,
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  auth.user = {
    id: "operator",
    is_platform_admin: false,
    support: null,
  } as AuthUser;
  auth.activeOrg = { orgId: "org", role: "agent" } as ActiveOrg;
  state.contact = {
    id: "contact",
    organization_id: "org",
    name: "Contato sintético",
    display_name: "Contato sintético",
    phone_number: "+5511000000000",
    email: "test@example.invalid",
    email_normalized: "test@example.invalid",
    cpf_hash: null,
    birthdate: null,
    is_blocked: false,
    blocked_reason: null,
    tags: [],
    is_anonymized: false,
    anonymized_at: null,
    is_merged_into: null,
    merged_at: null,
    consent: {},
    source: "manual",
    source_metadata: {},
    custom_fields: {},
    company_id: null,
    recurring: false,
    created_at: "2026-09-09T12:00:00Z",
    updated_at: "2026-09-09T12:00:00Z",
    last_activity_at: null,
  };
  state.profileError = false;
  state.duplicatesError = false;
  get.mockResolvedValue({ data: [], meta: { has_more: false } });
  merge.mockResolvedValue({ data: { nao_repontado: {} } });
});

describe("controles de contatos conforme APIs legadas", () => {
  it.each([
    ["viewer", false, false],
    ["agent", true, false],
    ["manager", true, true],
    ["admin", true, true],
  ] as const)("role %s separa escrita e fusão", (role, canWrite, canMerge) => {
    auth.activeOrg!.role = role;
    expect(contactPermissions(auth.user, auth.activeOrg)).toMatchObject({
      canWrite,
      canMerge,
    });
  });
  it("suporte somente leitura e encerrado não herdam escrita; full ativo segue o rank", () => {
    auth.activeOrg!.role = "admin";
    auth.user.support = {
      status: "active",
      access_mode: "support_readonly",
    } as AuthUser["support"];
    expect(contactPermissions(auth.user, auth.activeOrg)).toEqual({
      canWrite: false,
      canMerge: false,
      canAnonymize: false,
    });
    auth.user.support = {
      status: "active",
      access_mode: "full",
    } as AuthUser["support"];
    expect(contactPermissions(auth.user, auth.activeOrg)).toEqual({
      canWrite: true,
      canMerge: true,
      canAnonymize: true,
    });
    auth.user.support = {
      status: "expired",
      access_mode: "full",
    } as AuthUser["support"];
    expect(contactPermissions(auth.user, auth.activeOrg)).toEqual({
      canWrite: false,
      canMerge: false,
      canAnonymize: false,
    });
  });
  it("platform_admin sem rank não ganha bypass onde a API não o permite", () => {
    auth.user.is_platform_admin = true;
    auth.activeOrg!.role = "viewer";
    expect(contactPermissions(auth.user, auth.activeOrg)).toEqual({
      canWrite: false,
      canMerge: false,
      canAnonymize: true,
    });
    expect(contactPermissions({ ...auth.user, is_platform_admin: false }, null).canWrite).toBe(
      false,
    );
  });
  it.each(["viewer", "support_readonly"])(
    "lista %s mantém leitura e oculta criar/importar/excluir/iniciar conversa",
    (mode) => {
      if (mode === "viewer") auth.activeOrg!.role = "viewer";
      else
        auth.user.support = {
          status: "active",
          access_mode: "support_readonly",
        } as AuthUser["support"];
      mount(<ContactsListClient />);
      expect(screen.getByRole("link", { name: "Contato sintético" })).toHaveAttribute(
        "href",
        "/app/contacts/contact",
      );
      expect(screen.getByRole("button", { name: "Duplicados" })).toBeInTheDocument();
      for (const name of [
        "Novo contato",
        "Importar CSV",
        "Excluir contato Contato sintético",
        "Iniciar conversa com Contato sintético no Inbox",
      ])
        expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
      expect(remove).not.toHaveBeenCalled();
      expect(post).not.toHaveBeenCalled();
    },
  );
  it("atendente mantém ações autorizadas e perde diálogo aberto ao virar viewer", () => {
    const view = mount(<ContactsListClient />);
    fireEvent.click(screen.getByRole("button", { name: "Novo contato" }));
    expect(screen.getByText("Novo aberto")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Importar CSV" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Excluir contato Contato sintético" }),
    ).toBeInTheDocument();
    auth.activeOrg!.role = "viewer";
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ContactsListClient />
      </QueryClientProvider>,
    );
    expect(screen.queryByText("Novo aberto")).not.toBeInTheDocument();
  });
  it("viewer mantém atalho de leitura da conversa já existente", () => {
    auth.activeOrg!.role = "viewer";
    state.contact.conversa = {
      id: "conversation",
      unread: 0,
      preview: null,
      last_message_at: null,
    };
    mount(<ContactsListClient />);
    expect(
      screen.getByRole("link", {
        name: "Abrir conversa com Contato sintético no Inbox",
      }),
    ).toHaveAttribute("href", "/app/inbox?id=conversation");
  });
  it("ficha viewer oferece Pedidos e Timeline, com recarga sem oferecer edição", async () => {
    auth.activeOrg!.role = "viewer";
    mount(<ContactDetailClient contactId="contact" />);
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.getByText("Vínculo somente leitura")).toBeInTheDocument();
    tab("Pedidos");
    await screen.findByText("Nenhum pedido encontrado.");
    expect(get.mock.lastCall?.[0]).toContain("contact_id=contact");
    expect(
      screen.queryByRole("link", { name: "Novo pedido para este contato" }),
    ).not.toBeInTheDocument();
    tab("Timeline");
    expect(await screen.findByText("Timeline preservada")).toBeInTheDocument();
  });
  it("ficha com erro oferece releitura, e não conteúdo vazio", () => {
    state.profileError = true;
    mount(<ContactDetailClient contactId="contact" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Erro ao carregar contato.");
    fireEvent.click(screen.getByRole("button", { name: "Recarregar contato" }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(screen.queryByRole("tab", { name: "Pedidos" })).not.toBeInTheDocument();
  });
  it("suporte somente leitura não oferece anonimização mesmo com rank admin em memória", () => {
    auth.activeOrg!.role = "admin";
    auth.user.support = {
      status: "active",
      access_mode: "support_readonly",
    } as AuthUser["support"];
    mount(<ContactDetailClient contactId="contact" />);
    tab("LGPD");
    expect(screen.queryByRole("button", { name: "Anonimizar contato" })).not.toBeInTheDocument();
  });
  it("duplicados do atendente continuam legíveis, sem ação de fusão", () => {
    mount(<MergeDialog open onOpenChange={vi.fn()} />);
    expect(screen.getByText("Outro contato")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Juntar" })).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("radio").every((radio) => (radio as HTMLInputElement).disabled),
    ).toBe(true);
    expect(merge).not.toHaveBeenCalled();
  });
  it("gerente mantém confirmação explícita antes de juntar e payload com IDs corretos", async () => {
    auth.activeOrg!.role = "manager";
    mount(<MergeDialog open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Juntar" }));
    expect(merge).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Juntar contatos" }));
    await waitFor(() =>
      expect(merge).toHaveBeenCalledWith({
        primary_contact_id: "contact",
        secondary_contact_ids: ["second"],
      }),
    );
  });
  it("falha ao consultar duplicados é erro com retry, não ausência de duplicados", () => {
    state.duplicatesError = true;
    mount(<MergeDialog open onOpenChange={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Não foi possível carregar os contatos duplicados.",
    );
    expect(screen.queryByText("Nenhum contato duplicado encontrado.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(refetch).toHaveBeenCalledOnce();
  });
});
