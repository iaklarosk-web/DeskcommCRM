# BACKLOG do CRM-OS — o que falta, e o que disso impede usar o produto

**24/09/2026.** Pedido do proprietário: *"tudo na tela funciona e diz a verdade, e
todo o restante documentado como pendência para fazer, mas que não impede o uso
real do produto."* Este é o "restante".

A coluna que importa é **Impede o uso real?**. Um item marcado `não` pode ficar
aberto por tempo indeterminado sem que ninguém deixe de operar o CRM-OS.

Antes de escrever, os 39 itens `NOT VALIDATED` do FINAL-VALIDATION §3 foram
apurados um a um contra a realidade — não herdados. **Cinco já estavam feitos e
ninguém tinha tirado da lista.** Estão no §0.

---

## §0. Já feito — sai da lista de pendências (apurado em 24/09, revisto em 25/09)

| Item | Estava como | A prova |
|---|---|---|
| Backup diário do banco de produção | `NOT VALIDATED` | **8 execuções confirmadas**, 17/09 a 24/09, cifradas em `gdrive-crypt:crm-os/db/`. O script confere o tamanho NO DESTINO antes de declarar sucesso. Cron `20 3 * * *` |
| Nome e preço reais dos planos (D14) | `NOT VALIDATED` | 3 planos `source=owner` no banco de produção: Essencial, Profissional, Empresarial |
| Stripe LIVE na produção | `NOT VALIDATED` | `BILLING_GATEWAY=stripe` + `STRIPE_MODE=live` no contêiner; `billing_gateway=stripe/live` na linha `prod:`. Falta só a linha de evidência `stripe_live:`, que é registro, não função |
| Run do `verify.yml` no GitHub | `NOT VALIDATED` | 2 execuções com sucesso em 23/09 (1h05 e 1h18) no PR da F19 |
| Persistência do swap (§B14) | `NOT VALIDATED` | `/swapfile` de 4 GB ativo e no `/etc/fstab` desde 24/09 |

Lição: uma lista de pendências que ninguém apura envelhece e passa a mentir nos
dois sentidos — esconde o que falta e cobra o que já foi feito.

---

## §1. IMPEDE o uso real — nada aqui hoje

Nenhum item conhecido impede operar o CRM-OS neste momento. As três afirmações
falsas das telas de cobrança e de criação de tenant, que estavam neste bloco pela
manhã, foram consertadas em 24/09 (commit `c5e4d03b0`).

---

## §2. Não impede, mas só a REALIDADE fecha — depende do proprietário

Nada disto é construção: é o produto encontrando o mundo. Enquanto não acontecer,
o que sabemos do CRM-OS vem de testes escritos pelo próprio agente.

| Item | Impede? | Quem fecha |
|---|---|---|
| Convite aceito por pessoa real (o Kayro) | não | proprietário — a tela está no ar |
| WhatsApp real: parear número, receber, enviar, reconectar | **não, mas é o canal principal do produto** | proprietário |
| Primeiro pagamento real no Stripe (`checkout_paid=0/0`) | não | proprietário ou primeiro cliente |
| Cadastro público aberto (`GOTRUE_DISABLE_SIGNUP=false`) | não | proprietário (decisão comercial) |
| E-mail transacional real para terceiros | não | proprietário |
| Provedor de IA com clientes reais: custo em volume, limites | não | operação real |
| Chat do site embutido num site real, com IA respondendo visitante | não | operação real |
| Agenda com Google real (OAuth de atendente) | não | operação real |
| Sessão de suporte usada por atendente humano | não | operação real |
| Dados reais: tenant Deka preenchido (59 `TODO-DEKA`) | não | proprietário |
| Meta do piloto D27 (baseline, metas, duração, invalidação) | não | proprietário |
| Caixa de entrada do proprietário: os e-mails da F08-T06 chegaram? | não | proprietário |

---

## §3. Dívida técnica declarada — o produto admite que não tem

Estas são **honestas**: a tela diz que a função não existe. Por isso não violam
"a tela diz a verdade" e podem esperar.

| Item | Impede? |
|---|---|
| ~~Aba **Equipe** do `/admin`~~ — **CONSTRUÍDA na F21** (25/09), depois de a ausência dela custar uma escrita sem auditoria no banco de produção | — |
| Aba **Uso** do `/admin` (desligada, sem rota) | não |
| "Impersonate" no inbox do admin (S-11.07) | não |
| Seção "Em breve — Fase 2" em cobrança | não |
| Trocar e-mail, upload de arquivo, listagem de sessões | não |
| E-mail de notificação (in-app e push funcionam) | não |
| Limites por plano ainda placeholder da migration 9023 | não |
| Campos configuráveis de OPORTUNIDADE; papéis personalizados (D15) | não |
| Condições (filtros) nas regras de automação pela tela | não |
| Motor de regras herdado ainda no código | não |

---

## §4. Verificação que nunca foi feita — risco silencioso

Diferente do §3: aqui o produto **não avisa** que não foi verificado. É o bloco
que a F20 provou ser perigoso — dois defeitos reais moravam exatamente aqui.

| Item | Impede? | Por que importa |
|---|---|---|
| Teste visual e no celular (7 telas × 2 dispositivos, mais as telas novas de F13/F15/F19) | não | os três defeitos de hoje eram de TELA e nenhum teste os pegou |
| Restore SOBRE o banco em uso (produção) | não | o restore só foi provado em banco VAZIO. O dia em que precisar será o primeiro teste |
| Healthcheck do `crm-prod-rest` | não | um incidente de **36 h** passou despercebido em 21–22/09 |
| Sentry real sob erro de usuário | não | o evento de teste funciona; erro real de gente, nunca |
| `demo3` e `from-scratch` na F20 | não | não foram executados: o proprietário autorizou deploy direto |
| Busca semântica sobre o FAQ do seed | não | 7 pares num trecho só |
| Firewall dos OUTROS stacks desta VPS (§B12) | não | fora do escopo do CRM, mas é a mesma máquina |
| Fixtures do Stripe capturadas do provedor (regra 13) | não | as de hoje são MODELADAS, não capturadas |
| Stripe em modo `test` por navegador (cartão 4242, Portal) | não | pulado por decisão em D58 |
| Specs herdadas de suporte e presença/recuperação | não | herdadas, nunca rodadas nesta árvore |
| Turno de IA dentro da janela de envio (7h–22h) | não | |
| Autonomia `approve` com clientes reais, e sem conversa vinculada | não | |

---

## §5. Fases não construídas

| Fase | O que é | Impede? |
|---|---|---|
| **F16** | Marca do SaaS, presets, white-label, domínio por cliente | não — exige D28 (nome/domínio) do proprietário |
| **F17** | Operação, capacidade/recuperação, suporte, atualização, regressão, aceite | não — mas é onde mora o healthcheck do §4 |
| **F09** | Piloto Deka acompanhado, com baseline, metas e qualidade | não — **depende de operação real**, não de código |
| **F10** | Segunda empresa real operando por configuração, com preço aceito | não — idem |

F09 e F10 não podem ser aceleradas por construção: elas medem o produto sendo
usado. Enquanto o §2 não andar, elas não têm o que medir.

---

## §6. As 41 ferramentas da fila

Inventário completo em `CRM-OS/docs/f18/FERRAMENTAS-MCP-INVENTARIO-20260918.md` §3.

Nenhuma está declarada pelo agente de hoje: o catálogo SaaS em produção tem as 14
ações da F18, e o produto opera com elas. As 41 são capacidades do CRM herdado
ainda não migradas — `crm_add_case_note`, `crm_archive_stage`,
`crm_assign_conversation`, `crm_cancel_appointment`, `crm_close_demand` e outras.

**Impede o uso real? Não.** Entram por decisão do proprietário, uma a uma ou em
bloco, quando alguma fizer falta na operação. A régua fail-closed do inventário
impede que uma ferramenta apareça para a IA sem essa decisão.

---

## Onde mora a lista COMPLETA de telas que faltam

`docs/design-system/screen-flow/03-screen-inventory.md`, no bloco
`inventario:nao-construido`. Ele já listava as abas Equipe e Uso como
"planejado e ainda não construído" quando o proprietário estranhou na tela — mas
nenhum documento de ESTADO apontava para ele, então valia o mesmo que não
existir. Uma régua do gate garante que essa lista só encolhe.

Quem for cobrar o que falta na interface: comece por lá, não por aqui.

## Como ler este documento daqui a um mês

Todo item aqui tem dono e prova. Antes de cobrar qualquer um, **apure** — cinco
dos 39 já estavam feitos quando este backlog foi escrito. Lista não apurada mente
nos dois sentidos.
