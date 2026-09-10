# ADR-014 — F02 configurável e extensão dos gates

Aceite do escopo pelo proprietário: D47/D48, 09/09/2026.

## Contexto

O desenho F02 carregava pendências comerciais em dependências de engenharia e
tornava ilegível o que pode ser construído com dados fictícios. O produto deve
manter histórico de usuário, isolamento por organização e o mapa SaaS, sem
fabricar regras de piloto ou bloquear F02 à espera de acesso.

## Decisão

Lista diária, impressão e conferência são capacidades configuráveis. A lista
exige data e critério explícito delivery_date ou created_at; inclui confirmed,
in_production e delivered, e exclui draft e cancelled dos totais. A via usa o
relatório completo carregado e não determina produção, estoque, rota ou
entrega.

Conferência é independente da venda: zero é pendente, valor entre zero e o
vendido é parcial e igualdade é completa, sempre na mesma unidade. O journal
conserva revisões antigas; alteração comercial posterior exige nova
conferência. Dados empresariais futuros entram como configuração, sem
reescrever snapshots.

Esta decisão autoriza estender T13 com gates para duas organizações fictícias,
recorte obrigatório, completude de impressão, autorização, idempotência,
revisão e limpeza do sandbox. Ela não declara esses gates aprovados.

## Alternativas rejeitadas

Esperar dados do piloto impediria engenharia genérica. Escolher entrega ou
criação como padrão criaria regra comercial silenciosa. Usar impressão como
confirmação ou entrega misturaria atos distintos. Somar unidades incompatíveis
ou converter embalagens sem fator configurado fabricaria dados. Tratar
conferência como status comercial perderia o histórico por revisão.

## Consequências

Telas e APIs expõem recorte, fuso, denominadores e pendências sem truncamento.
Impressão e reimpressão não escrevem. T12 exige journal auditável, revisão e
permissões separadas. T13 verifica jornada genérica em sandbox; validação
visual, operação real, dados do piloto, provedores e produção seguem fora deste
ADR.

D47 determina pausa ao concluir cada fase, com evidências e consumo observado.
F03 depende de nova mensagem do proprietário; este ADR não autoriza continuidade
automática. D48 determina que a Deka é o primeiro piloto e informará seus dados
após receber acesso, sem impedir a construção genérica.

O mapa SaaS permanece: isolamento e configuração por organização precedem
expansão comercial; F03 e fases posteriores não começam por esta autorização.

## Data

2026-09-09.

## Commit

Pendente de promoção. Nenhum hash futuro é presumido.

## Implementação do gate T13

F02 preserva tipos/lint/build/shell/unit/integration/DB/secrets, isolamento,
RLS/RBAC/entitlement, inventário Git e todos os mutantes. Acrescenta sete specs
Playwright obrigatórias, 13 casos Chromium, um worker e zero retries/skips.
O inventário integral de `--list` e a execução devem coincidir por identidade
completa de teste. A execução acontece apenas no sandbox local declarado, com
provedores mock e credenciais nunca presentes na evidência. Inputs de código,
testes, scripts e schema são comparados por SHA-256 antes/depois do gate; uma
mudança invalida o resultado. Arquivos env, artefatos e cache TypeScript ficam
fora da impressão. A comparação ao N0 mantém escopo unit+DB; os 13 E2E F02 são
um recorte próprio, e `full_n0=pending` preserva esse limite explicitamente.
F00/F01 mantêm seus gates. Os detalhes implementados estão em
`scripts/verify/f02-e2e.mjs` e `scripts/verify/report.mjs`.
