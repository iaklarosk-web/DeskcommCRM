# ADR-010 — Separar os rótulos F01 da numeração upstream

## Contexto

A integração da F01 (`960a46907449fcd4a7e773e40016742c25c0a09d`) com a v1.17.0 (`db58c3fb3ef7acbf6ae9d0eaec278cb968958c5d`) reuniu quatro pares de migrations com os rótulos `0219`–`0222`, mas timestamps distintos. O teste original `tests/unit/manifest-x-migrations.test.ts` reprova números repetidos; aceitar essas colisões no MANIFEST contradizia o contrato existente. A numeração legível precisa ser corrigida sem modificar a identidade aplicada nem o SQL.

O CLI instalado, versão 2.116.0, e o código oficial consultado separam `version` e `name`. Em [`file.go`, pacote v1.2.3](https://github.com/supabase/cli/blob/pkg/v1.2.3/pkg/migration/file.go), o prefixo anterior ao primeiro `_` fornece `version`; o restante fornece `name`. Em [`history.go`](https://github.com/supabase/cli/blob/pkg/v1.2.3/pkg/migration/history.go), a chave primária e a listagem das versões aplicadas usam `version`. Em [`apply.go`](https://github.com/supabase/cli/blob/pkg/v1.2.3/pkg/migration/apply.go), `FindPendingMigrations` compara esse prefixo com as versões remotas. Portanto, preservar o timestamp mantém a identidade e a seleção de pendências nesse mecanismo; o rótulo descritivo pode mudar sem reaplicação por esse motivo.

## Decisão

Registrar este ADR antes da renomeação e reservar os rótulos `9001`–`9004` para as quatro migrations F01, mantendo quatro dígitos e a verificação original de unicidade. Alterar somente o nome do arquivo após o timestamp:

| Timestamp preservado | Rótulo anterior | Rótulo atual |
|---|---|---|
| `20260907150000` | `0219_channel_accounts_e_webhook_quarantine` | `9001_channel_accounts_e_webhook_quarantine` |
| `20260907170000` | `0220_rls_fundacao` | `9002_rls_fundacao` |
| `20260907190000` | `0221_tenant_settings` | `9003_tenant_settings` |
| `20260907210000` | `0222_ai_usage_events` | `9004_ai_usage_events` |

Preservar todos os bytes dos quatro arquivos SQL, inclusive comentários, e o baseline já conciliado. Atualizar os rótulos correntes do MANIFEST e manter nele o mapa histórico. Os comentários e registros históricos podem continuar citando os rótulos originais; o timestamp e este mapa permitem identificá-los sem reescrever evidências anteriores.

Não executar `migration repair`, `UPDATE`, reaplicação ou qualquer ajuste em `supabase_migrations.schema_migrations` por causa desta renomeação. Um `name` antigo já registrado pode permanecer histórico; um banco que aplicar a mesma versão pela primeira vez registrará o novo rótulo. O mecanismo de pendências continua comparando `version`.

Na ADR-006, a proibição de renumerar o histórico refere-se à versão aplicada e ao conteúdo SQL. Esta decisão permite a alteração rastreável dos rótulos legíveis, com timestamp e conteúdo preservados. Novas migrations do fork devem escolher rótulos livres e manter o gate de unicidade; esta reserva não garante que um upstream futuro nunca use esses números.

## Alternativas rejeitadas

- Aceitar as quatro colisões no teste ou acrescentar exceções: enfraqueceria um contrato que os dois históricos já cumpriam.
- Alterar timestamps, SQL ou o histórico de um banco instalado: mudaria a identidade ou o conteúdo aplicado sem necessidade.
- Renomear arquivos upstream: ampliaria o desvio em relação à release fixada quando o conflito pode ser resolvido nos quatro rótulos próprios do fork.
- Renumerar para a sequência imediatamente posterior à release: aproximaria os rótulos próprios das próximas migrations upstream.

## Consequências

A ordem por timestamp e os bytes SQL permanecem os mesmos. O teste original deve passar sem alterações; a validação compara SHA-256 dos quatro arquivos antes/depois, verifica que `9001`–`9004` estavam livres e confere unicidade de números e timestamps no conjunto integrado. A revalidação completa usa o estado posterior à correção; a execução unitária anterior, que encontrou a colisão, não prova este estado.

Esta alteração é de arquivos e documentação. Não altera banco, histórico em uso ou conteúdo do baseline, nem demonstra a operação dos serviços reais. O procedimento de instalação continua sendo o baseline; a cadeia histórica de migrations não passa a reconstruir um banco vazio por causa desta decisão.

## Data

2026-09-08

## Commit

O commit que adiciona este arquivo (`git log --format=%h -1 -- docs/decisions/ADR-010-rotulos-das-migrations-F01.md`).
