# Construtor de baterias por prova do evento: decisões aprovadas

Diagnóstico e proposta aprovados pelo usuário em 2026-10-27, com as seis decisões na opção recomendada (A). A maquete é [construtor-baterias-aprovado.html](construtor-baterias-aprovado.html), a cópia da página como foi aprovada (diagnóstico, simulador hoje × proposta, decisões e plano). As Stories 1.87 a 1.90 citam esta pasta nos critérios de aceite.

O visual do construtor é o do painel do gestor (tokens de `src/app/globals.css`). A implementação não cria estilo novo.

## O pedido

No Functional Fitness, cada bateria nascia de uma prova da aba Provas, e cada prova pertence a uma categoria; por isso a bateria só aceitava atletas dela e sobravam raias. O gestor informa **quantas provas o evento tem**, o construtor traz **todos os inscritos aprovados** e a bateria aceita qualquer categoria. O resto (horários, raias, arrastar, auto-preencher, salvar, publicar) opera como antes.

## Decisões aprovadas

1. **D1:** cada atleta de uma bateria mista é avaliado na prova da categoria dele; cada raia guarda essa prova.
2. **D2:** a prova do evento encontra a prova de cada categoria automaticamente pela ordem da aba Provas, com troca manual na tabela "Prova de cada categoria".
3. **D3:** auto-preencher vai categoria por categoria, na ordem das categorias, do pior para o melhor no ranking de cada uma; quando uma categoria acaba, a próxima completa a bateria.
4. **D4:** Fitness Race continua com largadas únicas e todos os inscritos.
5. **D5:** baterias já salvas no formato antigo continuam valendo (cronograma público, quadra, telão); ao gerar o cronograma da prova no construtor novo, elas passam para o formato novo.
6. **D6:** só inscrições aprovadas aparecem na lista.

## Como ficou o modelo (e uma diferença do plano)

A bateria da prova do evento é um item `heat` do cronograma com `stageNumber`, `stageTitle`, `stageWorkouts` (`{ categoria: prova }`) e `laneWorkoutIds` (a prova de cada raia, alinhada com `athleteIds`); `workoutId` guarda uma prova representativa para quem ainda agrupa por prova. A bateria antiga só tem `workoutId`. Regras puras em `src/lib/heatStages.ts`.

**Diferença do plano aprovado:** o plano previa a coluna `events.heat_stages` (migration). Ela **não foi criada**: a quantidade de provas é derivada (a categoria com mais provas, ou mais se já há baterias salvas) e o nome e a prova de cada categoria ficam gravados nas baterias da própria prova. Resultado: **nenhuma migration**, sem ordem de deploy, e nada muda no banco. Só se perde o que ainda não foi gerado: o nome e o mapeamento de uma prova sem nenhuma bateria salva voltam ao preenchimento automático ao reabrir o evento.

## Fora de escopo

Fitness Race, Qualifier online, a aba Provas, o ranking, as notas e as inscrições (nada disso muda).
