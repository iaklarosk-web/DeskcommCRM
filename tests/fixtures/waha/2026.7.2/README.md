# Fixtures WAHA 2026.7.2 (F03-T04, G-42)

Oito payloads versionados na forma do provedor, um arquivo por evento. O
parser da F03 grava só a allowlist e conta `unknown_fields{name}`; a suíte roda
contra a pasta inteira e imprime `fixtures=N parsed=N`.

| Arquivo | O que exercita |
|---|---|
| `message-texto.json` | entrada normal por telefone (`@c.us`) |
| `message-lid-com-telefone.json` | `@lid` com `key.remoteJidAlt` — o telefone existe |
| `message-lid-sem-telefone.json` | `@lid` sem alternativa: quarentena `lid_without_pn` |
| `message-imagem.json` | mídia aninhada em `media` (NOWEB) |
| `message-ack-entregue.json` | `ack=2` → `delivered` |
| `message-ack-lido.json` | `ack=3` → `read`, mesmo `provider_message_id` do anterior |
| `message-grupo.json` | `@g.us`: descarte esperado, sem contato órfão |
| `message-campo-desconhecido.json` | campo fora do catálogo: passa intacto pelo loose e é contado |

## Forma — de onde ela vem

Os campos e sua opcionalidade seguem o contrato medido do webhook em
`lib/waha/envelope.ts:37-113`, que documenta as medições de produção que o
fixaram (`@lid` com `key`, `_data.message` ausente em ack). `message-ack-*`
compartilham o `id` de propósito: é o mesmo `provider_message_id` mudando de
estado, que é o que F03-T06 mede.

## Limite declarado

Estes payloads são **fictícios e conformes ao contrato**, não capturas de um
número real: telefones, nomes e ids são inventados no bloco `5511900000000+`,
e nenhum número da Deka ou de cliente foi conectado (D04, D48). Eles provam
o parser, a idempotência e a quarentena; não provam interoperabilidade com uma
instância WAHA real, que continua item humano com credencial (D12).
