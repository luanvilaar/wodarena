# Formato Intervalado na súmula digital: decisões aprovadas

Diagnóstico e proposta aprovados pelo usuário em 2026-10-21 ("aprovado", com as recomendações de todas as 10 decisões). A maquete é [intervalado-aprovado.html](intervalado-aprovado.html): abra no navegador (tem construtor e simulador da súmula interativos). As stories 1.60 a 1.63 devem citar esta pasta nos critérios de aceite.

## O treino de referência

```
5 Rounds
2min. ON / 2min. OFF
6 Ring Muscle Ups
15 Box Jump Overs #24/20in
Max. Squat Clean #80/55kg
```

Resultado: soma das repetições do movimento máximo (Squat Clean) nos rounds.

## Decisões aprovadas

1. **Nome e lugar:** quarto cartão "Intervalado" em "Formato da prova", com o texto "Rounds de trabalho e descanso; soma das repetições".
2. **Duração:** sem descanso depois do último round. `rounds × ON + (rounds − 1) × OFF` (exemplo: 18:00). Vira o `timeCapSeconds` da estrutura (validado como igual à soma).
3. **Trabalho do round:** de 0 a 9 movimentos fixos (com meta, toque e segure como no For Time) e um único movimento máximo, sempre o último, sem meta.
4. **Unidade do máximo:** só repetições.
5. **Round com fixos incompletos:** o round só pontua se todos os fixos chegaram à meta dentro da janela; senão o máximo vale 0 naquele round. A contagem bruta fica guardada e visível, para o gestor corrigir.
6. **Toque fora da janela:** a tela recusa na hora. Se um registro fora da janela chegar ao servidor, o motor o ignora e a súmula mostra "N registros fora da janela" antes do envio. Janela de cada round: `[início, início + ON)` em segundos inteiros (01:59 conta, 02:00 não).
7. **Desempate:** nenhum nesta versão (empatados dividem a posição). Candidato futuro: maior round único.
8. **Tipo legado gravado na prova:** `reps` (selo "Reps" na página pública), sem migration. Exige ampliar `LegacyWorkoutFields['type']` e `LEGACY_TYPE_LABELS`.
9. **Telão:** em onda separada (Story 1.63), depois de 1.53 a 1.58 estarem commitadas.
10. **Limites:** 2 a 20 rounds; trabalho de 00:30 a 30:00; descanso de 00:00 a 30:00; duração total até 99:59 (5999 s, o maior time cap atual).

## Regras do motor

- Round de um registro: `⌊at ÷ (ON + OFF)⌋ + 1`; conta se `at mod (ON + OFF) < ON` e o round existe. Vale para `rep` e `fill`.
- `set` e `adj` no intervalado levam o campo `rd` (round, 1 a `rounds`), obrigatório, porque a correção acontece com o relógio parado. Fora do intervalado o campo é descartado.
- O máximo só pontua no round cujos fixos estão completos, avaliado no estado final (independe da ordem dos eventos de correção).
- Resultado = soma dos máximos dos rounds que pontuaram. `display` = o número como texto; `value` = o número. Sem `tieBreak`.
- `time` (ajuste de tempo oficial) não vale para o intervalado, como na carga máxima.
- Atleta ausente (Story 1.59): 0 repetições, depois de qualquer resultado real.
- Contrato v3 = v2 + `interval` (`rounds`, `onSeconds`, `offSeconds`, movimento máximo com `id`, `name`, `load`, `note`); `interval` é `null` fora do formato. v1 e v2 continuam aceitas e são normalizadas para v3.
- Estrutura trava na primeira súmula aberta, como hoje.

## Caso de teste aprovado

Prova 5 × 02:00 ON / 02:00 OFF, fixos 6 + 15, máximo Squat Clean.

| Atleta | R1 | R2 | R3 | R4 | R5 | Resultado | Posição | Observação |
|---|---|---|---|---|---|---|---|---|
| A | 9 | 8 | 5 | 1 | 0 | 23 | 3 | R5 com Box Jump Overs 11/15: o máximo não conta |
| B | 10 | 9 | 8 | 7 | 6 | 40 | 1 | empata com C |
| C | 8 | 8 | 8 | 8 | 8 | 40 | 1 | sem desempate |
| D | – | – | – | – | – | 0 | 4 | ausente |

Pontos (low-point): 1, 1, 3, 4.

Atribuição de registros (round, janela): 00:35 → R1 conta; 01:59 → R1 conta; 02:00 → fora; 03:30 → fora (descanso); 04:10 → R2 conta; 18:00 → fora (fim).

## Stories

| Story | Escopo | Tamanho |
|---|---|---|
| 1.60 | Contrato v3 e motor (validação, estado, resultado, fase pelo relógio, `validateClientEvent` com `rd`, `computeSheetOutcome`/`computeAbsentOutcome`, progresso ao vivo, tipo legado) | M |
| 1.61 | Construtor (quarto cartão, seções, frase da regra, resumo, editar prova gravada) | M |
| 1.62 | Súmula do judge (fases, contagem regressiva, correção por round, resultado) | G |
| 1.63 | Telão (rótulo, linha do máximo, round e fase) | P |

Ordem: 1.60 só depois da Story 1.59 estar commitada (as duas mexem em `scoresheet.ts`); 1.63 só depois das 1.53 a 1.58 estarem commitadas.

## Fora do escopo

Calorias ou metros no máximo; desempate; descanso depois do último round; som ou vibração nas trocas de fase; qualquer migration.
