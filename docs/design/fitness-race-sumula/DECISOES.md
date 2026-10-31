# Súmula Digital Fitness Race — decisões aprovadas

Aprovado pelo Luan em 2026-10-30. Plano completo: [plano-aprovado.html](plano-aprovado.html)
(artefato publicado em https://claude.ai/artifact/2paVvREdi3MMeGMAeJnjSV). Insumos: `planonovo.md`
(raiz, referência) e os levantamentos do @architect e do @dev.

Este arquivo prevalece sobre o HTML onde os dois divergirem. As decisões abaixo ajustam o plano.

## Decisões

| # | Tema | Decisão |
|---|------|---------|
| D1 | Tempo oficial sem chip | Largada da onda (`race_heat_marks`) é o início. **O fim é o registro do último Wall Ball**: o judge do Wall Ball encerra o tempo ao liberar o atleta. A corrida final do atleta é só protocolo e **não conta tempo**. Não existe operador de chegada nem tela de chegada separada. O organizador pode ajustar o tempo, com registro em `race_decisions`. Horários das estações seguem só para splits e auditoria. |
| D2 | Penalidades | **Valem na hora**: a infração calculada pelo motor já nasce `confirmed`. O organizador pode depois revogar ou alterar (segundos/motivo), com registro. DQ continua sendo proposta do árbitro; só o organizador confirma. |
| D3 | Cobertura de árbitros | Padrão: a súmula funciona só onde houver árbitro. Wall Ball tem prioridade. Estações 1–7 são opcionais. |
| D4 | Diretor de prova | Padrão: o diretor é o gestor dono do evento. Head judge só na fase 3, como papel por evento. |
| D5 | Categorias | O organizador define na aba **Cronograma** quais categorias/ondas existem. A súmula não fixa categorias. Revezamento e Adaptive seguem para a F4, se o organizador os usar. |
| D6 | Cargas e alvos | O organizador define **na construção da prova** (percurso do evento). O preset 2026/27 é só ponto de partida editável; o que vale é o snapshot por evento. Não há valor de carga "oficial" fixo no código. |
| D7 | Identificação do atleta | Padrão: lista da onda ou número de peito digitado (`race_bibs`). QR na F3. NFC fora. |
| D8 | Chip | **Não usamos chip.** Importação de chip sai do escopo (F4 perde esse item). `time_source` fica `sheet` ou `manual`. |
| D9 | Offline no MVP | Padrão: o MVP aguenta queda de internet só com a tela já aberta. Onda inteira em modo avião fica para a F4. |
| D10 | Nome | "Fitness Race" nos presets e na interface nova. Não usar "HYROX". |

## Decisões complementares (2026-10-30, após a validação do @po)

| # | Tema | Decisão |
|---|------|---------|
| D11 | Maquetes | O Luan quer **ver as maquetes** das telas de largada (1.96), Wall Ball (1.97) e painel do organizador (1.98) antes da implementação. Maquete aprovada vai para `docs/design/fitness-race-sumula/telas/`. |
| D12 | Propor DQ | A tela do Wall Ball (1.97) ganha o botão **Propor DQ**. O árbitro propõe; só o organizador confirma. |
| D13 | Infração imediata | **Consome a advertência da estação.** Uma infração de penalidade imediata gasta a advertência: a próxima infração na mesma estação já vale os segundos. Substitui a interpretação do @sm na 1.93 AC4. |
| D14 | Extras aprovados | (a) correção da largada da onda inteira (1.96 AC7, implementada junto da 1.98); (b) marcar DNF no painel (1.98 AC8) e `dnf` no CHECK e na publicação da 1.99; (c) escolha entre os presets 2025/26 e 2026/27 no painel (1.98 AC10). |

## Decisões após ver as maquetes (2026-10-30)

| # | Tema | Decisão |
|---|------|---------|
| D15 | Desclassificar direto | **Aprovado.** O organizador pode desclassificar sem proposta do árbitro (botão no painel, motivo obrigatório, registro em `race_decisions`). Vira AC da 1.98. |
| D16 | Depois de Propor DQ | O atleta segue na prova e o árbitro continua contando até a decisão do organizador. |
| D17 | Infração geral | **Um toque**, sem confirmação; "Desfazer último" corrige. |
| D18 | "Atleta saiu" | Exige **segurar para confirmar**, como o "Liberar". |
| D19 | Situação "alterada" | É um selo sobre a penalidade em vigor, não um status próprio. |
| D20 | Painel no tablet | Resposta "não" à pergunta "cartão alto ou tabela enxuta?". Premissa adotada: **mantém cartões altos** (sem tabela com rolagem lateral). Confirmar se a leitura estiver errada. |
| D21 | Tempo na tela do árbitro | A tela de liberação **exibe o tempo do atleta no momento em que o árbitro o pega** (largada da onda até a liberação). O servidor continua sendo a fonte do tempo oficial; a tela mostra o valor calculado com o relógio do aparelho. |
| D22 | Sair antes das 100 reps | **Não fecha o tempo.** O judge orienta o atleta a completar as reps faltantes; o tempo só fecha na liberação com 100 válidas. **Substitui a AUTO-DECISION da 1.97 AC8** ("sair fecha o tempo"). |

## Aprovação das maquetes e últimas respostas (2026-10-30)

| # | Tema | Decisão |
|---|------|---------|
| D23 | Maquetes | **As três maquetes estão aprovadas** (`telas/largada.html`, `wall-ball.html`, `painel-organizador.html`), já com os ajustes D15–D22. O bloqueio D11 das stories 1.96, 1.97 e 1.98 está levantado. |
| D24 | Botão "Atleta saiu" | **Fica como registro de abandono que NÃO fecha o tempo** (segurar para confirmar, D18). Grava um evento próprio no log da tentativa (para auditoria), sem penalidade e sem fechar a corrida. O atleta continua podendo completar as reps. O evento `exit` do motor, que fecha o tempo e cobra reps faltantes, não é usado pela tela no Wall Ball. |
| D25 | Desfazer DQ | Uma DQ (confirmada ou direta) **só pode ser desfeita pelo organizador** (gestor dono do evento ou owner), com motivo obrigatório e registro em `race_decisions`. Árbitro nunca desfaz. Ao desfazer, a corrida volta ao estado anterior e a publicação é recalculada. |
| D26 | Faixa do CourtShell | As telas de Fitness Race usam "Fitness Race · Largada" e "Fitness Race · Wall Ball" na faixa. O `CourtShell` ganha um parâmetro de título; o texto "Arbitragem na quadra" continua o padrão de Functional Fitness. |

## Mudanças de 2026-10-30 (noite): sem DQ e simplificação do painel

| # | Tema | Decisão |
|---|------|---------|
| D27 | Sem DQ | **Toda a ideia de DQ saiu**: propor, confirmar, desclassificar e desfazer. Substitui D12, D15, D16 e D25 e a parte de DQ da D2. Caso grave é resolvido pelo organizador com **DNF** (sem tempo oficial e sem posição). |
| D28 | Casos que eram DQ | Viram tempo: 2ª ocorrência cobra de novo; estação ou trecho faltando cobra 180 s por unidade; carga errada não refeita cobra 180 s. Os 180 s são valores de partida **a conferir** com o regulamento oficial. |
| D29 | Regulamento fixo | O painel não escolhe mais o preset (substitui D14c). O regulamento nasce na primeira largada com o preset 2026/27. |
| D30 | Penalidades | O organizador **altera e revoga** penalidade dada errado (D2, D19 seguem). **Não** lança infração geral à mão. |

## Cobertura e estrutura da prova (2026-10-30, noite)

Proposta e comparação de níveis em https://claude.ai/artifact/ASLBLDR4e1s6tvYbVEhUEx.

| # | Tema | Decisão |
|---|------|---------|
| D31 | Judge com 2 em tela | Um judge confere **até 2 atletas ou equipes ao mesmo tempo** na própria tela. Equipe (dupla) é um cartão. O servidor recusa o terceiro. |
| D32 | Wall Ball | **Um judge por atleta**: a contagem de reps exige atenção contínua. O Wall Ball nem sempre é a última estação. |
| D33 | Estrutura da prova | A súmula parte do **percurso que o organizador montou**, por categoria, e não do oficial. Cada estação tem tipo de conferência (sugerido pelo nome, ajustável) e metas (trechos, voltas, reps) informadas pelo organizador na construção da prova. |
| D34 | Quem fecha o tempo | **A última estação do percurso** fecha o tempo da prova e marca o tempo para o ranking, qualquer que seja ela. O Wall Ball nem sempre é a última; quando vem no meio, é conferido (1 judge por atleta, penalidade e split) mas não fecha o tempo. Substitui a parte "último Wall Ball" da D1. Confirmado pelo Luan. |
| D35 | Escala | Atribuição de judges **para o evento todo e também por onda**. |
| D36 | Penalidade do papel | Fica **fora do sistema**: o organizador calcula por fora e ajusta o tempo final da prova (Ajustar tempo). |
| D37 | Splits | **Splits por estação aparecem no resultado público.** Cada estação conferida registra início e fim; estação sem judge fica sem split. |
| D38 | Nível de entrega | **Nível 2 aprovado** pelo Luan: estrutura da prova, tela de 2 cartões, escala (evento todo e por onda), painel de cobertura e splits por estação. Fora do escopo: raias fixas, gerador de escala e head judge. As stories vêm do @sm; a tela de 2 cartões e o painel de cobertura pedem maquete aprovada antes da implementação (precedente D11). |
| D39 | Estação final = 1 atleta | A estação que fecha o tempo (a última do percurso) é conferida com **1 atleta por judge**, seja o Wall Ball ou outro exercício configurado pelo organizador. Essa tela é de um atleta só e **não tem "soltar"**: segue o fluxo do Wall Ball (Liberar fecha o tempo, "Próximo atleta"). Responde à dúvida do @ux sobre soltar cartão no Wall Ball. O Wall Ball fora da última posição continua com 1 por judge (D32), leitura assumida. |
| D40 | Evento sem escala | Sem escala cadastrada, **somem todos os avisos que dependem dela**, inclusive "Cartão sem judge" e "Judge acima do limite" (leitura do "sim" do Luan à pergunta "também somem?"). |
| D41 | Judge fora da escala | O painel de cobertura **mostra o judge que abriu um cartão sem estar na escala** (a escala só orienta, D3). |
| D42 | Maquetes aprovadas | O Luan **aprovou em 2026-10-31** as maquetes [`telas/dois-cartoes.html`](telas/dois-cartoes.html) e [`telas/cobertura.html`](telas/cobertura.html) (com os ajustes das D39 a D41). Libera as stories 1.103 e 1.105. |
| D43 | Wall Ball fora da última posição | Confirmado: **1 atleta por judge** (D32), mesmo regime da estação final (D39). |
| D44 | Saída incompleta na última estação | **O organizador age**: a súmula não fecha o tempo, a corrida fica em "Sem tempo fechado" e o organizador usa "Ajustar tempo" ou DNF. Os 180 s por trecho já gravados continuam registrados; o organizador decide o tempo final ao ajustar (D36). |

## Efeito nas stories

- **F0 (1.93):** preset 2026/27 e 2025/26 em código como ponto de partida; o motor lê regulamento e percurso do snapshot do evento. Sem valores de carga fixos.
- **F1:** a antiga "tela de largada e chegada" vira **tela de largada da onda** (1.96). O fim do tempo sai da tela do Wall Ball (1.97). O painel do organizador (1.98) é de **revisão e ajuste** de penalidades já em vigor, não de confirmação prévia. A publicação (1.99) usa tempo bruto = largada da onda até a liberação do último Wall Ball.
- **F4:** sai a importação de chip. Fica offline real, revezamento, Adaptive (se houver), exportação e janela de ajuste de 48 h.

## Pendências de conferência

- Valores de penalidade do `planonovo.md` (25/26 e 26/27) precisam ser conferidos com o regulamento oficial antes de virarem preset.
- Como o fim do tempo depende do judge do Wall Ball, **evento sem judge no Wall Ball não fecha tempo pela súmula**. O organizador lança o tempo à mão (lançamento manual existente). Tratar isso explicitamente na 1.97/1.99.
