# Prova de upgrade F01 → v1.17.0 combinada

Execute de qualquer diretório, com Git, Bash, Python 3 e Docker disponíveis:

```bash
bash scripts/verify/upgrade-f01-v117/run.sh
```

O caminho do comando é relativo à raiz do checkout; ao chamar de outro diretório, use o caminho absoluto do script. O commit F01 `960a46907449fcd4a7e773e40016742c25c0a09d` precisa existir no histórico local.

O runner extrai esse baseline com `git show`, congela o baseline atual e o prelude de `scripts/test-db.sh` em `mktemp` exclusivo, instala a F01, semeia 25 registros fictícios em 13 grupos e aplica o baseline atual duas vezes com `ON_ERROR_STOP=1`. Isso segue o caminho de reaplicação do baseline de `hostgator-setup-kit/update.sh`, usando tratamento de erro mais estrito. Não testa a aplicação individual da cadeia de migrations.

Usa um único `pgvector/pgvector:pg15`, porta dinâmica somente em localhost e credencial dummy. O trap remove somente esse container e seus volumes. Nenhuma conexão usa `.env`, Supabase ou banco já em execução. Baselines, snapshots e logs detalhados permanecem na pasta temporária exibida no início, para diagnóstico; não são gravados no repositório.

Compara projeções comerciais e registros completos das quatro tabelas F01; preserva constraints, índices e definição de `current_organization_id()`. Verifica RLS/leitura em oito tabelas nos dois sentidos, escrita cruzada em contatos, grants e seis recusas por constraint antes/depois/repetição. É cobertura focal, não uma varredura comportamental completa de todas as tabelas.

A única adição permitida às configurações preexistentes é `canonical_conversation_tags`, com o default exato do bloco G3-05 já presente no baseline. Nenhuma chave existente pode mudar. A prova negativa pode rodar separadamente:

```bash
python3 scripts/verify/upgrade-f01-v117/test-comparator.py
```

Ela exige falha quando um valor anterior é alterado ou uma chave não aprovada é acrescentada; também verifica os dois casos positivos. O runner executa essa prova antes de criar o container.

Os hashes e resultados da execução observada estão em [upgrade-f01-v117.txt](../../../docs/migration/evidence/upgrade-f01-v117.txt). A prova não valida Auth/Storage reais, provedores externos, UI, novas funcionalidades completas ou produção. Não está ligada ao verificador principal nesta entrega.
