---
name: project-fitness-race-1-93-1-99-validation
description: Súmula Fitness Race F0/F1 (Stories 1.93–1.99) GO em 2026-10-30; v1.4 com D23–D26: maquetes aprovadas (1.96–1.98 liberadas), "Atleta saiu" = evento abandon, Desfazer DQ (undo_dq), faixa do CourtShell
metadata:
  type: project
---

Stories 1.93–1.99 (Súmula Digital Fitness Race) Ready e liberadas em 2026-10-30. A fonte que prevalece é `docs/design/fitness-race-sumula/DECISOES.md` (D1–D26).

v1.4 (D23–D26):
- D23: maquetes aprovadas (`telas/`), bloqueio D11 levantado.
- D24: o botão "Atleta saiu" grava o evento `abandon` (1.97 AC17): sem penalidade, não fecha nada, só no Wall Ball, desfazível. A marca some quando o contador trava. A recusa de `exit` no Wall Ball (400) continua.
- D25: 1.98 AC16 `undo_dq` restaura a corrida a partir do `before` de `confirm_dq`/`disqualify`; a proposta confirmada vai para `revoked`. 1.99 AC13 retira ou troca o resultado publicado (vale também para `unmark_dnf`).
- D26: o `CourtShell` ganha o parâmetro da faixa (1.96 AC11, 1.97 AC18).

Achados: nenhum teste trava o texto "Arbitragem na quadra" (o `court-ui` trava só a casca). `tests/race-sheets-route.test.mjs` (~519) envia `exit` em Wall Ball pela rota e precisa de ajuste deliberado. A maquete do painel não tem "Desfazer DQ" (segue o padrão de "Desfazer DNF").

**Why:** a próxima sessão não deve reabrir perguntas já respondidas.
**How to apply:** a única pendência aberta é a D20 (premissa dos cartões altos). O vocabulário é `propose_dq`/`dq_proposal`/`abandon`/`undo_dq`.
