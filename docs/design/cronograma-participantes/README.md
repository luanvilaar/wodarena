# Cronograma: só nome e box na vaga: decisões aprovadas

Diagnóstico e proposta aprovados pelo usuário em 2026-10-27 (D1 e D2 na opção A). A maquete é [cronograma-participantes-aprovado.html](cronograma-participantes-aprovado.html), a cópia da página como foi aprovada (inventário do que aparece hoje, antes e depois no celular de 375px, o desktop e o plano). A Story 1.86 cita esta pasta nos critérios de aceite.

O visual da maquete é o da página pública (tokens de `src/app/globals.css`, tema escuro) e o desenho da linha segue o do ranking (número à esquerda, nome e box). A implementação não cria estilo novo.

## O pedido

No painel aberto de uma bateria (aba Cronograma da página do evento), cada vaga mostrava seis informações: selo "VAGA n", selo "EQ", nome da equipe, integrantes entre parênteses, categoria e box. Passa a mostrar só o nome do atleta ou da equipe e a box, com número da vaga para o atleta saber onde larga, e com atenção ao celular.

## Decisões aprovadas

1. **D1 · Número da vaga:** fica só o número, numa coluna estreita, com "Vaga" (Fitness Race) ou "Raia" (Functional Fitness) uma vez no topo da lista, como a regra de hoje (`getHeatSlotLabel`).
2. **D2 · Inscrição sem box:** mostra "Box não informada" em cinza, como o ranking, para as linhas terem a mesma altura.

## Regras

- Nome: `getTeamDisplayName(athlete)`, que tira os integrantes entre parênteses das equipes e devolve o nome completo do atleta individual. 14px, maiúsculas, até duas linhas.
- Box: 12px, uma linha, cortada com reticências só se passar da largura.
- Uma coluna no celular e duas a partir de `sm`; linha de no mínimo 52px; número com `aria-label` ("Vaga 1").
- Só exibição: nenhuma mudança no payload nem nos dados. O nome gravado na inscrição não é alterado.

## Fora de escopo

O cronograma do painel do gestor (a categoria ajuda a montar as baterias), o resumo de horários da bateria e o telão.
