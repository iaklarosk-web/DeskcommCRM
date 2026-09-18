# F02-T07 — seeds fictícios para ambiente descartável

## Decisão de empacotamento

O arquivo separado é `docs/tenants/demo2.f02-fixtures.yaml`, passado
explicitamente por `scripts/create-tenant.sh <seed> --fictional-fixtures <arquivo>`.
Não acrescentar fixtures ao `deka.seed.yaml`, não preencher nenhum `TODO-DEKA` e
não descobrir o arquivo por convenção. Assim, o comando atual continua criando
somente organização, membros, settings e canais mock quando o argumento novo não
for informado.

O arquivo começa com `fictional_only: true`, `schema_version: 1` e repete
`tenant_slug`. Além do argumento explícito, o CLI recebe `--sandbox-marker` e,
dentro da transação, exige igualdade com o GUC definido no próprio banco
`crm.fictional_fixture_sandbox`. Host loopback, nome da base e `NODE_ENV` não são
prova de descarte. A URL e o marcador nunca aparecem em log.

Antes da primeira escrita comercial, o writer recusa qualquer empresa, contato,
produto, pedido CRM/legado, item, receipt, evento, nota ou tarefa vinculada que não
pertença exatamente ao conjunto da fixture. Isso permite a segunda execução, mas
impede aplicar o arquivo sobre um tenant já usado. O conjunto de usuários-base
também precisa conter apenas emails `.test`, e o ator fictício precisa ser membro
ativo do tenant.

## Validação e parser

A validação mantém `validateSeed(seed)` e seus contadores/TODOs. Um validador
puro e estrito verifica também o arquivo de fixtures. O `main` chama os dois
validadores e agrega seus erros **antes de conectar ou inserir qualquer linha**.
Campos desconhecidos, `ref` repetida, referência ausente, ator que
não consta no seed-base e dado não marcado como fictício reprovam o arquivo todo.

Para itens de pedido, o YAML recebe `quantity_input`, que passa por
`parseBrazilianQuantity`. Persistir somente seu `quantity` canônico e validar o
sufixo com `assertMatchingSaleUnit`; `1.000 un` vira `1000.000`, `0,5 kg` vira
`0.500`, e `500 g` contra produto `kg` reprova. Não converter embalagem, massa ou
volume. `price_cents` permanece inteiro em centavos e `lineTotalCents` deve
reprovar qualquer total que dependa de regra de arredondamento ainda inexistente.
Campos pendentes ficam `null`; o mapper nunca cria `0`, `un`, moeda ou data.

O bloco legado `products` continua com o aviso existente enquanto não houver
decisão de migração. Seu mapeamento futuro fica documentado, sem ser executado:

| Seed legado | Destino | Regra neutra |
| --- | --- | --- |
| `sku` | `catalog_products.codigo` | trim; vazio/`TODO-` não grava |
| `name` | `catalog_products.nome` | trim; não concatenar embalagem |
| `unit` | `catalog_products.sale_unit` | trim, 1–32; sem tradução/conversão |
| `price_cents` | `catalog_products.preco_cents` | inteiro em centavos |
| `active` | `catalog_products.ativo` | booleano explícito |
| `size` | sem destino seguro | manter pendente; não esconder em nome/descrição |

Também não importar automaticamente `customers`: o bloco da Deka é vazio por
regra e uma futura fonte externa pode conter pessoas reais. Apenas o arquivo
separado e marcado cria contatos sintéticos.

## Escrita idempotente

Executar catálogo, empresas, contatos, pedidos, itens, recibos, eventos e auditoria
na mesma transação já aberta pelo `create-tenant`. Cada objeto carrega uma `ref`
legível; o mapper gera UUID v8 determinístico a partir de
`organization_id + tipo + ref`. Assim, a mesma fixture em dois tenants do SaaS
produz IDs globais distintos. O writer ainda faz preflight de colisão cruzada. Ele
usa `INSERT ... ON CONFLICT DO NOTHING`, soma somente `rowCount` e relê por
`organization_id + id`. A linha existente precisa corresponder exatamente à
fixture; diferença ou colisão de chave natural (`organization_id,codigo`) aborta a
transação em vez de sobrescrever dado vivo ou ligar uma referência errada.

Cada pedido recebe itens com IDs/posições estáveis e journal/receipt/audit
determinísticos para cada transição semeada. Não há webhook, WhatsApp, job, modelo,
fila ou chamada HTTP. O ator é um membro fictício cujo email termina em `.test`;
o audit registra somente IDs, revisão, status e `fixture:true`, sem nomes ou texto.
Recibos ficam completos e privados; eventos usam o mesmo contato fixado no pedido.
Este writer de bootstrap grava diretamente na transação e **não** chama nem amplia
o serviço operacional: executores `ai`/`automation` continuam recusados pelas
regras de comandos reais. Rascunho pendente permanece em
`draft`; cenário confirmado aplica somente `draft -> confirmed`; cancelado aplica
`draft -> cancelled`. Nenhuma fixture avança para produção ou entrega.

A segunda execução retorna `rows_created=0`. A prova também compara contagem,
IDs, revisões, snapshots e conteúdo antes/depois, em vez de aceitar apenas ausência
de erro.

## Arquivos da implementação

- `src/tenant-config/f02-fixtures.ts`: schemas/validador/mapeadores puros.
- `scripts/create-tenant.ts`: parse do argumento opt-in, guard local, validação
  completa pré-conexão e chamada transacional do writer.
- `docs/tenants/demo2.f02-fixtures.yaml`: somente os fatos sintéticos anexos.
- `tests/unit/f02-seed-parser.test.ts`: strictness, refs, unidades PT-BR, nulos e
  proteção contra TODO/entrada real.
- `tests/integration/create-tenant-f02-seed.test.ts`: primeira/segunda execução,
  igualdade integral, rollback por colisão, isolamento de dois tenants e ausência
  de filas/disparos.

## Provas mínimas

1. Validação inválida produz zero escrita, incluindo tenant-base.
2. Cada um dos dois tenants SaaS recebe duas empresas e dois contatos fictícios
   ligados corretamente; CNPJ, telefone e email estão ausentes/`null`.
3. Produto `cx`, produto `kg` e quantidades `1.000 cx`/`0,5 kg` mantêm SKU, unidade,
   preço e total sem conversão.
4. Draft aceita quantidade/preço/moeda/data `null`; confirmado não contém pendência.
5. Catálogo alterado depois não muda snapshots do pedido já confirmado.
6. Reexecução cria zero linhas e preserva IDs/revisões/timestamps.
7. A mesma `ref` gera UUID diferente nos dois tenants; colisão global/natural
   deliberada aborta.
8. Nenhuma linha nova em outbox, jobs, mensagens ou canais; nenhuma chamada de rede.
9. Executar sem `--fictional-fixtures`, sem o GUC de sandbox, com marcador falso ou
   sobre tenant com uma linha comercial alheia não cria empresa, contato ou pedido.
10. `deka.seed.yaml` e a contagem de `TODO-DEKA` permanecem byte a byte iguais.

## Decisões que continuam pendentes

Este seed não define qual data entra na lista do dia, corte, produção, entrega,
conversão de embalagem nem arredondamento. As datas fixas abaixo só exercitam o
campo explícito `delivery_date`; não constituem regra comercial.

## Validação executada

A CLI real foi executada duas vezes para cada uma de duas organizações sintéticas,
com zero alterações na repetição. As provas focais passaram em 19/19 unitários e
7/7 testes de integração; o mutante que remove a verificação do marcador do banco
foi detectado. A execução inicial revelou incompatibilidade de `ON CONFLICT` com
a constraint diferível de posição do item; a escrita passou a indicar a PK `id`.
Evidência: [construction-f02-t07-20260909.txt](../migration/evidence/construction-f02-t07-20260909.txt).

O cenário utiliza valores fictícios e não preenche nenhuma pendência comercial da Deka.
