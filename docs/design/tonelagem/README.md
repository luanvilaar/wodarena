# Formato Tonelagem na súmula digital: decisões aprovadas

Diagnóstico e proposta aprovados pelo usuário em 2026-10-26, em quatro rodadas (a versão final da página é a **versão 4**). A maquete é [tonelagem-aprovado.html](tonelagem-aprovado.html), a cópia da página como foi aprovada (análise, as duas maquetes interativas e as decisões). As Stories 1.77 a 1.81 citam esta pasta nos critérios de aceite.

O visual das duas maquetes é o do app (tokens de `src/app/globals.css`): o construtor no tema escuro do painel e a súmula do judge na quadra clara (`.court-light`), com a estrutura de `SheetBuilderForm.tsx` e de `DistanceSheetView.tsx`. A implementação não cria estilo novo.

## O treino de referência

```
10 Pull Ups
10 Burpees
Max. Squat Clean
```

Pull Ups e Burpees liberam o atleta e não contam ponto. O resultado é a tonelagem do Squat Clean: a soma de carga × repetições válidas, com a carga que o atleta escolhe.

```
AMRAP 3 min
Max. Squat Snatch
```

Um exercício só, marcado. Time cap de 03:00.

## Decisões aprovadas

1. **D1 · Nome e lugar:** sexto cartão **"Tonelagem"** em "Formato da prova".
2. **D2 · Exercícios:** o gestor adiciona os exercícios e **marca qual vale para a tonelagem**, em qualquer posição (C1). Só o marcado soma ponto.
3. **D3 · Carga:** livre (o judge digita antes de iniciar) ou prescrita pelo gestor.
4. **D4 · Incremento:** definido pelo gestor na pré-configuração da prova: permitido ou não, e o passo (0,25 a 25 kg). Só sobe.
5. **D5 · Contagem:** um toque por repetição válida, com a carga vigente gravada em cada toque. Sem carga mínima.
6. **D6 · Time cap:** o da prova inteira e **obrigatório** (C2): de 00:30 a 99:59. Sem ele a estrutura não é salva e a súmula não abre.
7. **D7 · Exercícios antes do marcado:** não contam ponto, mas precisam ser feitos para liberar o atleta até o exercício da tonelagem. Os de depois só aparecem na súmula, sem contar nem travar.
8. **D8 · Resultado e ranking:** maior tonelagem vence, em kg com até 2 casas. **Sem desempate**: mesma tonelagem divide a posição. Ausente publica 0 kg, depois de qualquer resultado real. Teto de 99.999 kg por súmula.
9. **D9 · Banco:** tipo legado novo `tonnage`, com uma migration própria.
10. **D10 · Telão:** onda separada, no fim.

## Regras do motor

- Formato `tonnage` na **versão 5** do contrato; v1 a v4 continuam aceitas e normalizadas para v5 com `tonnage: null`. Antes da v5, o formato e a chave `tonnage` são recusados com mensagem própria.
- `segments` leva os exercícios de fora da conta (0 a 9, o formato do For Time). `tonnage` leva `position` (quantos vêm antes do marcado), `lift` (`id`, `name`, `loadKg`, `note`), `loadMode` (`athlete` ou `prescribed`), `increment` (`allowed`, `stepKg`) e `note`. `tieBreak`, `incomplete`, `generator`, `maxLoad`, `interval`, `distance` e `scoreDisplay` nulos. `timeCapSeconds` obrigatório (30 a 5999).
- Eventos novos: `{ t: 'load', v, at }` (a carga declarada, ou um aumento) e `{ t: 'lrep', load, at }` (uma repetição válida **com a carga daquele toque**). A liberação usa `rep`, `fill`, `set` e `adj`, só nos exercícios antes do marcado.
- Reprodução do log na ordem: a `lrep` só conta se a liberação estava completa naquele ponto, se há carga declarada, se a carga é a vigente, se está dentro do time cap e se o total não passa do teto. O resto fica em `ignored`.
- A carga vale de 0,25 a 500 kg em múltiplos de 0,25. Prescrita: a declaração tem que ser a prescrita. Incremento: só com `allowed`, maior que a vigente e em múltiplos do passo.
- Desfazer: contagem da liberação, repetição e aumento de carga. A declaração da carga não se desfaz. Desfazer o aumento deixa as repetições já feitas com a própria carga e ignora as que dependiam dele.
- O servidor recusa, com mensagem, `load` e `lrep` que o motor ignoraria por regra da prova (`checkTonnageEntry`), menos o que passou do time cap (esse é gravado e ignorado).
- Resultado: Σ carga das repetições válidas. `value` e `display` (`'830'`, `'1652.5'`). Envio exige a carga declarada; zero repetição publica 0 kg. O ajuste de tempo oficial (`time`) não vale.
- Correção do gestor: kg com vírgula decimal e ponto de milhar (`1.652,5`), pelo parser próprio.

## Caso de teste aprovado

Treino 2, cinco atletas da mesma categoria:

| Raia | Registro do judge | Tonelagem | Posição | Pontos |
|---|---|---|---|---|
| A | 60 kg × 8, depois 70 kg × 5 | 830 | 1 | 1 |
| B | 83 kg × 10 | 830 | 1 | 1 |
| C | 55 kg × 12 | 660 | 3 | 3 |
| D | 40 kg × 10 | 400 | 4 | 4 |
| E | não compareceu | 0 | 5 | 5 |

## Stories

| Story | Etapa | Escopo | Tamanho |
|---|---|---|---|
| [1.77](../../stories/1.77.story.md) | A | Contrato v5 e motor | G |
| [1.78](../../stories/1.78.story.md) | B | Banco (migration do tipo `tonnage`), rótulos e lançamento manual em kg | P |
| [1.79](../../stories/1.79.story.md) | C | Construtor da prova | M |
| [1.80](../../stories/1.80.story.md) | D | Súmula do judge | G |
| [1.81](../../stories/1.81.story.md) | E | Telão | P |

Ordem: 1.77, depois 1.78 (com a migration aplicada no banco), 1.79 e 1.80 publicadas juntas, e 1.81 por último. Sem a súmula (1.80), uma prova de Tonelagem abriria na tela de segmentos; sem o telão (1.81), o telão não serve para prova de Tonelagem.

## Fora do escopo

Desempate de qualquer tipo; carga mínima ou máxima por categoria; carga prescrita diferente por sexo ou divisão; mais de um exercício somando tonelagem; reduzir a carga durante o treino; reclassificar uma prova de qualifier para Tonelagem pelas funções SQL; unidade em libras; "kg" na tabela pública de resultados; correção da contagem da liberação depois de parar o relógio; qualquer mudança nos cinco formatos atuais, no ranking, na autenticação ou na infraestrutura.
