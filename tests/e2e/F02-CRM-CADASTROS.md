# F02 — cadastros CRM em navegador

`f02-crm-cadastros.spec.ts` cria dois tenants e dois usuários com sufixo UUID,
somente no Supabase descartável que o responsável pelo ambiente provisionar.
Não use o projeto Supabase local já empregado por outro checkout.

Antes de executar, o ambiente do runner e do `next start` precisa conter as
credenciais do sandbox e:

```bash
F02_E2E_SANDBOX_ID=f02-crm-cadastros-disposable
```

O helper rejeita URL cujo `new URL(...).hostname` não seja `localhost`,
`127.0.0.1` ou `[::1]`, e rejeita a ausência desse identificador. Ele nunca lê
`.env.local`; o Playwright continua lendo apenas o `.env.e2e` preparado para
este sandbox.

Com o sandbox descartável de pé, o roteiro nominal é:

```bash
pnpm e2e:build
pnpm exec playwright test tests/e2e/f02-crm-cadastros.spec.ts --workers=1
```

A fixture cria somente: duas organizações `f02-*-<uuid>`, um manager membro das
duas, um viewer da organização A, uma empresa, um contato e um produto. O
`afterAll` remove exclusivamente os IDs que a própria execução guardou, nesta
ordem: produto, contato, empresa, memberships, organizações e usuários. Cada
operação confere e agrega erros do Supabase; cleanup incompleto deixa a prova
vermelha. Não há busca por e-mail, slug ou prefixo para apagar dados de
terceiros.

A prova cria empresa e vínculo pela UI. A tela atual não oferece edição de
produto; por isso a alteração de `sale_unit` usa PATCH autenticado e a recarga
da lista comprova a exibição, preservando preço e estoque. Nenhuma mensagem,
IA, cobrança ou serviço externo participa da execução.
