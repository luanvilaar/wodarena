---
name: telao-fitness-race-1-111-1-115-validation
description: Telão Fitness Race (stories 1.111 a 1.115) validado GO em 2026-11-03; regras de tela aplicadas e AUTO-DECISIONs do @po que o Luan ainda pode contestar
metadata:
  type: project
---

Stories 1.111 a 1.115 (telão ao vivo Fitness Race, desenho em docs/design/telao-fitness-race/) validadas GO em 2026-11-03: notas 9/9/9/8/8, todas Draft → Ready, Change Log v1.1.

Respostas às 3 perguntas do @sm vieram do agente líder "a partir do README aprovado", não de mensagem direta do Luan; nas stories ficou "Respostas aplicadas na validação do @po":
- Tela no automático: ao vivo com onda na pista; sem onda na pista, classificação (com resultado) alternando com o grid da próxima onda; sem resultado e com próxima onda, grid sozinho (antes da 1ª onda do dia); espera só sem próxima onda e sem resultado, ou fixada.
- Estação tracejada só depois da passagem sem cartão; escala de judges (1.104) não é lida; diferença com a maquete aceita na 1.113.
- Reta final = última estação (D34); progresso por tipo (reps; trechos/voltas em trenó e seções; tempo em ergômetro/genérica).

AUTO-DECISIONs acrescentadas pelo @po (o Luan pode contestar):
- 1.114 T4-4: luzes em toda largada vista; com o ao vivo de outra onda no ar, por cima do mapa e nunca da torre (Regra 5); sem luzes com a mesa fixada em outra tela.
- 1.114 T4-5: cartão do roxo entra no passo que estiver no ar, com a onda e a categoria no título.
- 1.111 7e: onda que termina só com resultado lançado à mão sai da pista sem os 90 s.
- 1.112: instante do DNF vem de `race_decisions` (`mark_dnf`), não de `race_runs.updated_at`.
- 1.115 só vai para produção depois da 1.114 (o grid passou a ser a tela de antes de cada onda).

**Why:** as ondas se sobrepõem na pista, então a maior parte das largadas acontece com o ao vivo no ar; o rascunho deixava as luzes e o roxo sem regra nesse caso.
**How to apply:** em revisão do Luan ou dúvida do @dev/@qa sobre essas stories, partir destas regras; se o Luan discordar de T4-4/T4-5, a mudança fica em 1.114 (e na escolha de tela da 1.111, ponto único `resolveRaceScreen`). Ligado a [[fitness-race-f2-1-100-1-106-validation]].
