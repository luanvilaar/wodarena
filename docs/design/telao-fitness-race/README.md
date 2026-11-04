# Telão Fitness Race: desenho aprovado

Desenho aprovado pelo Luan em 2026-11-03 para o telão ao vivo dos eventos Fitness Race (TV ou projetor no local), com as respostas às decisões D1 a D6 da proposta. Referência de transmissão: HYROX. Referência de linguagem da tela: Fórmula 1.

- **Maquete:** [telao-fitness-race-aprovado.html](telao-fitness-race-aprovado.html). Abra no navegador; a simulação roda sozinha (espera, grid de largada com as luzes, ao vivo, bandeirada e classificação). Os botões abaixo do telão trocam a tela, a velocidade, o tempo da onda e a forma de mostrar penalidade (só para comparar a D2). Dados fictícios: Onda 3, Open Masculino, 10 atletas, com Burpee Broad Jump e Farmers Carry sem judge de propósito.
- **Proposta e pesquisa:** https://claude.ai/artifact/LDmPpC7Xff1ZJtK4k1zMQ7 (privado). Esta pasta é a referência caso o artefato deixe de abrir.
- **Base já existente:** telão de Functional Fitness ([docs/design/telao-ao-vivo/](../telao-ao-vivo/), [PLANO-TELAO-LEADERBOARD-AO-VIVO.md](../../PLANO-TELAO-LEADERBOARD-AO-VIVO.md)) e súmula Fitness Race ([docs/design/fitness-race-sumula/](../fitness-race-sumula/DECISOES.md)).

> **Atualização de 2026-11-04: ranking único da prova.** A D1 abaixo foi substituída. O telão ao vivo passa a mostrar **uma torre por categoria com todas as ondas largadas**, comparando os atletas pelo tempo de prova de cada um. Desenho e regras na seção [Ranking único (R1 a R5)](#ranking-único-r1-a-r5) e na maquete [ranking-unico-aprovado.html](ranking-unico-aprovado.html). Stories 1.116 a 1.118.

## Decisões aprovadas

| # | Tema | Decisão |
|---|------|---------|
| D1 | Várias ondas na pista | ~~**A.** Torre de uma onda por vez, em rodízio a cada 20 s entre as ondas na pista, cada uma com o seu relógio.~~ **Substituída em 2026-11-04 pela R1:** uma torre por categoria com todas as ondas. A torre de uma onda continua só quando a mesa fixa a onda (R4). |
| D2 | Penalidade no telão | **B.** Só os segundos ("+15 s") na linha do atleta e na faixa da direção de prova, sem o motivo. |
| D3 | Luzes de largada | **A.** As luzes acendem e apagam quando o telão vê a largada (até cerca de 2 s depois do gesto do gestor). A largada não muda (D45 de [DECISOES.md](../fitness-race-sumula/DECISOES.md)) e o relógio mostra o tempo real desde ela. |
| D4 | Atleta entre estações | **A.** "Na pista · após {estação} · m:ss" na torre e marcador vazado no trecho seguinte do mapa, com a legenda "estimado". |
| D5 | Roxo de melhor estação | **A.** Melhor tempo da categoria naquela estação, somando as ondas do evento até agora. Só estação com judge, do início à liberação, tem tempo. |
| D6 | Classificação entre ondas | **A.** Por categoria: tempo final, diferença para o 1º e melhores por estação, alternando as categorias a cada 12 s. Sem faixa etária. |

## Telas e quando cada uma entra

A troca é automática, como no telão de Functional Fitness. O gatilho é o que a súmula registra, não o horário do cronograma. Na mesa do gestor dá para fixar uma onda, a classificação de uma categoria ou a espera.

| Tela | Quando entra | O que mostra |
|------|--------------|--------------|
| Espera | Nenhuma onda na pista e nenhuma terminada há pouco, ou espera fixada na mesa | Marca do evento e as próximas ondas com o horário previsto do cronograma |
| Grid de largada | Nenhuma onda na pista: a próxima onda sem largada, na ordem do cronograma (alterna com a classificação). Ou onda fixada na mesa | Atletas da onda e box, categorias, horário previsto, percurso com metas e cargas, cinco luzes apagadas. Quando o gestor larga no painel Ondas, as luzes acendem, apagam e a tela vai para o ao vivo |
| Ao vivo | Onda largada com atleta correndo | Torre, mapa do percurso, cartões (disputa, melhor estação, reta final do Wall Ball, próxima largada) e faixa da direção de prova |
| Bandeirada | Por cima do ao vivo, quando a última estação do percurso fecha o tempo de alguém (D34) | Posição na categoria até agora, nome, box e tempo final com as penalidades. Cobre o mapa, nunca a torre |
| Classificação | Onda terminada (todos com tempo ou DNF) por pelo menos 90 s; depois alterna com o grid da próxima onda | Ranking da categoria, selo NOVO em quem acabou de chegar e melhores tempos por estação |

## Regras do placar

1. **Parcial até fechar.** Toda posição na torre é parcial. O tempo final só aparece quando a última estação fecha o tempo, e o organizador ainda pode ajustá-lo.
2. **Sem leitura, sem invenção.** Estação sem judge não gera tempo nem posição. O atleta aparece "na pista" com a última estação lida e há quanto tempo; no mapa, marcador vazado e estação tracejada.
3. **Diferença no mesmo ponto.** Só se comparam tempos no mesmo ponto do percurso. Ordem: quem fechou o tempo; depois quem está mais adiante pela última leitura; no mesmo ponto, quem passou antes.
4. **Segundos, arredondados.** Diferenças e tempos em segundos inteiros, arredondados para o segundo mais próximo, como o tempo oficial publicado (`raceOfficialScore`). Nunca truncar. Mesma regra em todas as telas.
5. **A torre não sai do ar.** Cartões, bandeirada e avisos entram por cima do mapa. Onda com mais de 10 atletas alterna páginas a cada 8 s, mantendo o líder e quem está na reta final.
6. **Uma fonte de verdade.** A classificação usa o resultado publicado da prova TOTAL, o mesmo do leaderboard do site. Não existe uma segunda regra de ranking.
7. **Dados pessoais.** Nome sanitizado (`sanitizeNamePII`) e box; equipe pelo nome da equipe. Sem e-mail, telefone ou ids de usuário e de inscrição.
8. **Sem previsão.** Nada de chegada prevista, ritmo ou probabilidade de ultrapassagem: sem tempo de corrida, a conta seria chute.

## De onde vem o dado (sem chip)

| Na tela | Fonte |
|---------|-------|
| Largada e relógio da onda | `race_heat_marks` (largada do gestor, Story 1.110) |
| Atletas da onda e ordem do cronograma | `events.event_schedule` (itens `kind: 'heat'`), `readRaceHeatItems` |
| Onde está cada atleta, tempo em estação, progresso (trechos, voltas, reps) | `race_attempts`: `status`, `progress`, `started_at`, `ended_at`; percurso de cada categoria no snapshot de `race_rulesets.course` |
| Tempo final, DNF | `race_runs`: `status`, `gross_seconds`, penalidades vigentes de `race_infractions` |
| Classificação e melhores por estação | `scores` da prova TOTAL e `splits` publicados (duração por estação, D37) |
| Mesa do gestor, link secreto | `event_broadcasts` e `broadcast_heat_states` do telão atual |

Pontos de leitura são o início e a liberação de cada cartão em estação com judge. Corrida e Roxzone não têm leitura própria, por isso o telão nunca mostra tempo de corrida.

## Como entra no sistema

- **Reaproveita:** link secreto e rota `/pt-br/telao/<token>`, mesa do gestor (aba Telão), atualização por consulta a cada 1 s com 304 quando nada muda, cabeçalho, rodapé, tela cheia, wake lock e aviso de conexão.
- **Muda:** a aba Telão passa a aparecer nos eventos Fitness Race; a API `/api/telao/[token]`, que hoje recusa Fitness Race, decide pelo tipo do evento; entram uma leitura nova (`serverRaceBroadcast.ts`), um motor puro (`raceBroadcast.ts`) e a tela do Fitness Race. Functional Fitness não muda.
- **Leitura de dados:** paginada e só das ondas na pista, para não bater no limite de 1000 linhas do Supabase.
- **Banco:** sem migration. Os modos da mesa (Automático, Fixar onda, Fixar classificação, Espera) cabem na tabela do telão atual.

## Pontos que as stories precisam fechar (registrar como AUTO-DECISION)

Decisões técnicas que a proposta não detalhou. Seguem as regras acima e devem aparecer na story para o Luan conferir:

1. **Onda ao vivo sem leitura.** A proposta citava "sem leitura nova há 20 min sai do ar" como no telão de Functional Fitness. No Fitness Race isso pode derrubar a tela cedo demais: com poucas estações cobertas, o intervalo entre leituras passa de 20 min (com só o Wall Ball coberto, a primeira leitura vem perto da hora de prova). Proposta: onda largada com corrida `racing` fica ao vivo; "sem leitura há N min" só aparece no rodapé; um teto longo desde a largada evita onda esquecida. A story define o critério.
2. **Onda com mais de uma categoria.** Posição e diferença são sempre por categoria. A torre mostra uma categoria por vez, no mesmo rodízio de 20 s da D1 (cada passo é onda × categoria), e o título mostra a categoria.
3. **Resultado publicado sem corrida.** Atleta com resultado na prova TOTAL (por exemplo, lançamento manual quando o último Wall Ball não tinha judge) conta como chegou.

## Stories

Numeradas pelo @sm a partir de 1.111. Cada uma cita esta pasta nos critérios de aceite.

| Id | Escopo |
|----|--------|
| T1 | Motor puro com testes: onde está cada atleta, ordem, diferença no mesmo ponto, roxos, disputas e chegadas; escolha da tela (espera, grid, ao vivo, classificação) e rodízio |
| T2 | API do telão para Fitness Race: leitura paginada, decisão pelo tipo do evento, testes de contrato e de dados pessoais |
| T3 | Tela ao vivo: torre, mapa do percurso, cartões e faixa da direção de prova |
| T4 | Grid de largada, luzes, bandeirada e destaque de melhor estação (roxo) |
| T5 | Classificação, espera e mesa (aba Telão nos eventos Fitness Race) |
| T6 (1.116) | Ranking único: motor da torre da categoria (tempo de prova, confronto, ordem por confrontos, diferença com o ponto e "contando", disputa entre ondas, entrada no ranking) |
| T7 (1.117) | Ranking único: leitura das ondas largadas, payload por categoria, faixa "entra no ranking" e mesa (R4) |
| T8 (1.118) | Ranking único: tela (torre de 15 linhas, cabeçalho com relógios por onda, cartões e faixa) |

## Ranking único (R1 a R5)

Proposta aprovada pelo Luan em 2026-11-04, todas as decisões na opção A. Maquete: [ranking-unico-aprovado.html](ranking-unico-aprovado.html) (telão simulado com três ondas de 5 atletas; os botões comparam as regras). Publicada em https://claude.ai/artifact/G3en4somBpty3HxDHmk96y (privado); esta pasta é a referência.

| # | Tema | Decisão |
|---|------|---------|
| R1 | Ordem entre ondas | **A.** Tempo de prova no mesmo ponto, pelas checagens abaixo. Na mesma onda dá a ordem de hoje. |
| R2 | Penalidade no tempo de prova | **A.** Conta a partir do lançamento: entra em todos os pontos lidos depois dele e no relógio do atleta. Penalidade revogada sai da conta. Na chegada bate com o tempo oficial. |
| R3 | Categoria com muitos atletas | **A.** 15 linhas por página, mais compactas. Líder e reta final em toda página, 8 s por página, e a categoria fica no ar até mostrar todas (pelo menos 20 s). |
| R4 | Mesa do gestor | **A.** "Fixar a classificação de uma categoria" vira "Fixar uma categoria": ranking ao vivo enquanto alguém dela corre, classificação depois. "Fixar uma onda" continua e mostra a torre de uma onda (a de 03/11). Sem migration. |
| R5 | Entrega | **A.** Commit local das 1.111 a 1.115 como base; o ranking entra nas Stories 1.116 a 1.118 e tudo vai a produção junto, depois do ensaio. |

### Quem está à frente de quem (R1)

1. **Tempo de prova:** da largada da corrida do atleta (`race_runs.started_at`, a mesma base do tempo oficial e da correção de largada da 1.107) até a leitura, mais as penalidades já lançadas (R2).
2. **Mesmo ponto mais adiantado:** se os dois já passaram por ele, fica à frente quem passou com menos tempo de prova.
3. **Certeza:** se um passou por um ponto que o outro ainda não alcançou, e o relógio do outro já passou daquele tempo, o outro está atrás. A diferença aparece com "contando" e cresce até ele passar pelo ponto. Só vale se a estação tem judge na onda de quem ainda não passou (pela escala da onda ou por leitura de alguém dela).
4. **Senão:** vale o último ponto que os dois já passaram.

Ponto = entrada ou saída de estação com judge; quem fechou o tempo tem também o ponto "chegada", com o tempo final. A ordem da torre é por confrontos vencidos (em casos raros os confrontos formam um ciclo; o empate fica com quem está mais adiante). Quem largou e ainda não tem leitura fica no fim, sem posição e com "aguardando 1ª leitura"; DNF fica no fim, sem posição. A diferença é sempre contra o 1º, no ponto escrito embaixo do número, e pode ser negativa (mais rápido que o 1º naquele ponto). Sem previsão (Regra 8): o "contando" e o tempo a bater usam só tempos que já aconteceram.

### O que muda na tela ao vivo

- **Torre:** uma por categoria, com selo da onda em cada linha e penalidade ao lado do nome; rodízio só entre categorias.
- **Cabeçalho:** "{Categoria} · ranking da prova" e um relógio por onda na pista com atletas da categoria.
- **Cartões:** Novo líder (quando o 1º muda, por alguns segundos, com o ponto e a diferença); Disputa também entre ondas, com o selo "entre ondas" e o ponto comparado; Reta final com o tempo a bater (o tempo final de quem já chegou e ainda pode ser superado); sem próxima onda, "Ondas na pista" no lugar de "Próxima largada".
- **Faixa da direção de prova:** "entra no ranking em Nº" na primeira leitura de cada atleta.
- **Ficam:** luzes de largada (agora por cima do mapa, e os atletas da onda entram no fim da torre), bandeirada, roxo, mapa, classificação, grid e espera.

## Fora do escopo

- Chip, câmera, vídeo, áudio e vinhetas.
- Chegada prevista, ritmo e frequência cardíaca.
- Placar no celular do público (a mesma API serve depois).
- Classificação por faixa etária.

## Fontes principais

- HYROX: [mika:timing e splits](https://prommer.net/en/training/hyrox/results/), [como ler os splits](https://hyranking.com/learn/explainers/how-to-read-your-hyrox-splits-a-practical-guide-to-race-data), [acompanhamento ao vivo](https://roxfit.app/blog/how-to-track-someone-doing-hyrox/), [transmissão do Elite 15 (InspoHub)](https://inspohub.io/hyrox-elite15-live-streaming/), [Hamburgo 2026](https://www.boxrox.com/hyrox-hamburg-2026-friday-recap-elite-15-singles/).
- Fórmula 1: [pacote gráfico de 2018](https://motorsportbroadcasting.com/2018/04/22/analysing-formula-1s-new-on-air-package/), [intervalo e diferença](https://fansided.com/2022/07/27/f1-intervals-explained-interval-mean-formula-1), [cores de setor](https://racingnews365.com/what-sectors-are-f1-and-what-do-the-different-colours-mean), [F1 Insights da AWS](https://www.aboutamazon.co.uk/news/aws/insights-powered-by-aws-help-to-improve-formula-1-viewing-experience), [luzes de largada](https://flowracers.com/blog/how-f1-start-lights-work/), [diferenças com uma casa decimal em 2026](https://www.gpfans.com/en/f1-news/1078428/f1-2026-tv-broadcast-new-timing-tower-graphic).
- A lista completa está no rodapé do artefato.

Não há documentação pública do pacote gráfico do Elite 15 nem da posição dos tapetes de chip. O que se diz sobre a transmissão vem do estudo de caso da produtora e de guias de terceiros (ROXFIT e Hyranking são apps independentes).
