# Orçamento inicial — proposta para revisão

Data: 08/09/2026. Pedido do proprietário: começar o quanto antes e receber recomendação de custo mensal, deixando-a aberta para revisão. **Nenhum gasto, plano ou contratação foi aprovado.** Esta reserva cobre serviços, não desenvolvimento, suporte humano ou horas operacionais.

## Recomendação

| Etapa | Faixa mensal proposta | Teto para revisar antes de ampliar |
|---|---:|---:|
| Piloto Deka, aproveitando a VPS atual se a carga couber | R$150–300 de desembolso adicional | R$300 |
| Preparação comercial, 2–3 empresas iniciais | R$600–1.200 de serviços, contabilizando hospedagem | R$1.200 |

O teto é uma regra proposta de acompanhamento, **não um limitador de cobrança já implementado**. Adotar dólar de planejamento de **R$6,00**, sem confundir com cotação atual, e margem de aproximadamente 15% para variações, tributos e excedentes. Número/telefonia, domínio e a fatura real da VPS ainda precisam ser informados; não estão precificados nestes subtotais.

## Composição

| Item | Piloto | Preparação comercial | Premissa |
|---|---:|---:|---|
| IA | R$60–150 | R$120–300 | 3.000 e 6.000 turnos/mês, respectivamente; rever por consumo real |
| Licença WAHA | R$0 | R$0 | Core 2026.7.2/NOWEB; hospedagem e operação têm custo separado |
| Hospedagem | Incremento R$0 se não exigir upgrade; rateio pendente | Reserva R$150–300 | Referência de capacidade, não preço nem aprovação da VPS atual |
| Banco gerenciado | Teto de R$300 pressupõe nenhuma nova assinatura de banco; se optar por gerenciado no piloto, recalcular a faixa | Opção R$150–210 | Supabase Pro para um ou dois projetos Micro, antes de extras |
| E-mail transacional | R$0 se atender limites gratuitos | R$0–120 | Convites, autenticação, recuperação e cobrança; sem marketing |
| Backup externo | R$30–60 | R$30–60 | Verificar cobertura do backup existente antes de contratar outro |

As faixas comerciais incluem escolhas alternativas; o extremo superior exige revisar uso e serviços. O custo econômico da VPS existe mesmo sem desembolso novo: `fatura mensal × participação do CRM na capacidade`. Não foram consultadas faturas. Um retrato de memória livre não comprova capacidade sob carga de produção.

WAHA incorporou os recursos Plus ao Core gratuito desde 2026.6.1; a release usada não exige contratar Plus. [Documentação oficial WAHA](https://waha.devlike.pro/docs/how-to/waha-plus/).

Como referência de hospedagem, VPS DigitalOcean de 4 GB/8 GB aparecem a US$24/48 por mês; Spaces começa em US$5/mês. São referências de preço, não recomendação de mudar o provedor. [Droplets](https://www.digitalocean.com/pricing/droplets), [Spaces](https://www.digitalocean.com/pricing/spaces-object-storage).

Supabase Pro começa em US$25/mês com o primeiro projeto; outro Micro acrescenta US$10/mês. Self-host não cobra assinatura gerenciada, mas consome capacidade e trabalho de backup/atualização. O conjunto Docker completo recomenda 8 GB/4 cores; a VPS compartilhada precisa de dimensionamento. Supabase CLI é ambiente de desenvolvimento, não o aceite operacional de staging/produção. [Preços](https://supabase.com/pricing), [requisitos Docker](https://supabase.com/docs/guides/self-hosting/docker), [self-hosting](https://supabase.com/docs/guides/self-hosting).

Resend Free: 3.000 e-mails/mês e 100/dia. Pro: US$20/mês e 50.000 e-mails. O domínio/remetente precisam ser configurados e validados. [Preços oficiais Resend](https://resend.com/pricing).

## Memória de cálculo da IA

Hipótese ilustrativa, ainda sem volume Deka confirmado: 3.000 turnos/mês × 2 chamadas/turno × 2.000 tokens de entrada e 400 de saída por chamada = **12 milhões de entrada e 2,4 milhões de saída**. Histórico repetido e ferramentas aumentam o volume; não considerar desconto de cache/batch nesta conta.

| Referência de custo, sem escolher modelo definitivo | US$/milhão entrada / saída | Texto no piloto, câmbio de planejamento |
|---|---:|---:|
| GPT-4.1 mini | 0,40 / 1,60 | R$51,84 |
| GPT-5.4 mini | 0,75 / 4,50 | R$118,80 |

Fórmula: `(milhões de entrada × preço entrada + milhões de saída × preço saída) × 6`. Com 6.000 turnos, o valor dobra. A reserva deixa espaço para indexação, áudio e variação, mas só medições reais demonstram suficiência. A escolha do modelo depende de qualidade nos casos de pedido, confirmação e handoff. [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini), [GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini).

## Quando revisar

- Após sete dias de operação real ou 1.000 turnos medidos, o que ocorrer primeiro.
- Antes do primeiro cliente pagante e de mudar hospedagem/provedor/modelo.
- Quando a projeção mensal chegar a 80% do teto proposto.
- Se aumentarem contexto, chamadas por turno, áudio, armazenamento, concorrência na VPS ou e-mails acima de 100/dia.

Permanecem abertos: teto aprovado pelo proprietário, fatura/rateio da VPS, número/telefonia, domínio, volume real, necessidade de ambiente gerenciado e cobertura do backup atual. Nenhum serviço deve ser contratado com base apenas nesta proposta.
