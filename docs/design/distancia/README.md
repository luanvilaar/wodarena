# Formato Distância na súmula digital: decisões aprovadas

Diagnóstico e proposta aprovados pelo usuário em 2026-10-22: solução **S1** (novo formato), **D1** e **D9** citadas por ele e **todas as sugestões de D2 a D8** (confirmadas no mesmo dia, em resposta direta). A maquete é [distancia-aprovado.html](distancia-aprovado.html), a cópia da proposta como foi apresentada (a página de análise, com as seis soluções e os riscos, e as duas maquetes interativas: construtor e súmula do judge). As Stories 1.66 a 1.69 devem citar esta pasta nos critérios de aceite.

Avanço combinado com o usuário em 2026-10-22: documentar, criar as stories e **implementar as etapas A a C (Stories 1.66 a 1.68)**, sem commit e sem push. O telão (etapa D, Story 1.69) fica para a onda seguinte (decisão 9).

## Os treinos de referência

```
AMRAP x 20min
750m Corrida
Max. Distância no Remo
```

Dupla: o atleta A corre e o B rema, e trocam a cada volta da corrida até o fim do relógio. O resultado é a soma de tudo (voltas de 750 m mais os metros do remo). O judge faz a conta por fora e informa só o total.

```
AMRAP x 15min
A maior distância de corrida
```

Um atleta. O resultado é o total percorrido em 15 minutos.

## Decisões aprovadas

1. **D1 · Nome e lugar:** quinto cartão **"Distância"** em "Formato da prova", com o texto "Maior distância no tempo; o judge informa o total".
2. **D2 · Duração e relógio:** duração obrigatória de 00:30 a 99:59 (os limites do AMRAP). A súmula mostra o relógio crescente, a duração e a barra de progresso, como o AMRAP, e avisa "Tempo esgotado. Pare o relógio." (contagem regressiva ficou como alternativa, não escolhida).
3. **D3 · O que o judge digita:** um total em **metros inteiros, de 0 a 99.999**. Aceita `6330` e `6.330` (ponto de milhar: ponto seguido de exatamente três dígitos). Recusa vírgula, decimais e valores acima do teto, com mensagem. Pode lançar de novo a qualquer momento: vale o último lançamento que não foi desfeito, o desfazer funciona e o histórico fica guardado no log. O teto de 99.999 fica abaixo do 999.999 que a tabela pública usa para "sem resultado".
4. **D4 · Envio e ausente:** só envia com ao menos um total lançado (0 vale se foi digitado). Sem lançamento, o envio é recusado ("Informe a distância total antes de enviar."). Atleta ausente publica **0 m**, depois de qualquer resultado real (Story 1.59).
5. **D5 · Ranking e desempate:** maior distância vence. Empates dividem a posição, **sem desempate** nesta versão (como o Intervalado). O ajuste de tempo oficial (`time`) não vale.
6. **D6 · Tipo legado e selo público:** tipo `distance` (já aceito no banco, no ranking e no lançamento manual). O selo da página pública passa a dizer "Distância" (pt-br, pt-pt e en-gb), em vez de "Reps".
7. **D7 · Resumo da prova (opcional):** campo de texto de até 300 caracteres no construtor, mostrado ao judge e (onda do telão) na chamada.
8. **D8 · Unidade:** só **metros** nesta versão. A estrutura já guarda a unidade (`unit: 'm'`), então calorias entram depois sem nova versão do contrato.
9. **D9 · Telão:** onda separada, depois do motor (Story 1.69). Mostra o total em metros e ordena pelo maior; enquanto o judge não lançar, a raia aparece com "–".

## Regras do motor

- Formato `distance` na **versão 4** do contrato; v1, v2 e v3 continuam aceitas e são normalizadas para v4 com `distance: null`. Antes da v4, o formato e a chave `distance` são recusados com mensagem própria.
- Campo `distance`: `{ unit: 'm', note }`. Obrigatório no formato, `null` nos outros. `timeCapSeconds` é a duração (30 a 5999 s). `segments` vazio, `totalReps` 0, `incomplete`, `tieBreak`, `generator`, `maxLoad`, `scoreDisplay` e `interval` nulos, `customized` verdadeiro.
- Evento novo `{ t: 'dist', v, at }`: `v` é o total acumulado em metros (inteiro de 0 a 99.999), `at` os segundos do relógio. O estado é o último `dist` não anulado por `undo`. Sem janela de tempo (o judge pode lançar durante e depois do relógio). `rep`, `fill`, `set`, `adj`, `time` e `attempt` não valem neste formato.
- Resultado = o total. `value` = o número e `display` = o número como texto (`'6330'`, o formato que `parseScoreForWorkout('distance', …)` aceita). Sem `tieBreak`.
- Sem lançamento, o envio é recusado; o ausente publica `'0'`, valor 0, `tieBreak` nulo.
- Progresso ao vivo: `repsDone` leva os metros (o ranking ao vivo já ordena por ele e depois por quem lançou primeiro), e `lastMarkAt` é o instante do último lançamento que conta.
- Estrutura trava na primeira súmula aberta, como hoje.

## Caso de teste aprovado

Prova de 20:00, quatro raias da mesma categoria.

| Raia | Lançado | Resultado | Posição | Pontos | Observação |
|---|---|---|---|---|---|
| Dupla A | 6330 | 6330 | 1 | 1 | 6 voltas × 750 m (4.500) + 1.830 m de remo |
| Dupla B | 6330 | 6330 | 1 | 1 | empata com A, sem desempate |
| Dupla C | 5915 | 5915 | 3 | 3 | dois acima dela |
| Dupla D | – | 0 | 4 | 4 | ausente, depois de qualquer resultado real |

Digitação do total:

| Digitado | Resultado |
|---|---|
| `3250` | 3.250 m |
| `3.250` | 3.250 m (ponto de milhar) |
| `0` | 0 m (vale, foi digitado) |
| `3,5` | recusado: "Use só metros inteiros (ex.: 3250)." |
| `3.25` | recusado (ponto que não é de milhar) |
| `100000` | recusado: acima de 99.999 m |
| (vazio) | recusado: "Informe o total em metros." |

Correção: lançar 6330 e depois 6350 resulta em 6.350 m; desfazer volta a 6.330 m; o histórico mantém os dois lançamentos.

## Como convive com os outros formatos

A prova escolhe um formato e só ele vale para ela. Nada migra: provas gravadas seguem no formato que têm. For Time, AMRAP, Carga máxima e Intervalado não mudam de comportamento. AMRAP com um movimento em metros (rounds de metas) continua sendo AMRAP; "máximo de calorias" ainda não tem formato (fora do escopo, decisão 8).

## Stories

| Story | Etapa | Escopo | Tamanho |
|---|---|---|---|
| [1.66](../../stories/1.66.story.md) | A | Contrato v4 e motor (validação, estado, resultado, parser do total, `validateClientEvent`, `computeSheetOutcome`/`computeAbsentOutcome`, tipo legado, progresso ao vivo) | M |
| [1.67](../../stories/1.67.story.md) | B | Construtor (cartão, duração, resumo, frase da regra, conferência, editar prova gravada, selo "Distância" na página pública) | P |
| [1.68](../../stories/1.68.story.md) | C | Súmula do judge (campo do total, conferir e enviar, ausente, rótulo na correção do gestor) | M |
| [1.69](../../stories/1.69.story.md) | D | Telão (rótulo, linha da chamada, total em metros, ordem ao vivo) | P |

Ordem: 1.66 primeiro; 1.67 e 1.68 devem ser publicadas juntas (sem a 1.68, a prévia e a súmula de uma prova de Distância abririam na tela de segmentos); 1.69 depois.

## Fora do escopo

Calorias e formato genérico de total (S2); soma assistida por voltas (S5); desempate; unidade "m" na tabela pública de resultados; qualquer migration, mudança de autenticação ou de infraestrutura; qualquer mudança nos quatro formatos atuais.
