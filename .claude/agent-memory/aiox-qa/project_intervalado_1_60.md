---
name: intervalado-1-60-gate
description: Story 1.60 (intervalado, contrato v3 e motor) gate PASS 2026-10-21; LOWs de reversão e de ordem de publicação, e o que conferir nas 1.61 a 1.63
metadata:
  type: project
---

Story 1.60 (contrato v3 + motor do intervalado, commit 1ca1079): gate PASS em 2026-10-21, score 94, arquivo docs/qa/gates/1.60-intervalado-contrato-v3-motor.yml.

**Why:** o contrato v3 é a base das Stories 1.61 (construtor), 1.62 (súmula do judge) e 1.63 (telão). Os riscos que ficaram abertos são de publicação, não de código.

**How to apply:**
- REL-001: depois do deploy da 1.60, toda estrutura gravada e toda súmula aberta ficam na v3, qualquer que seja o formato. Reverter o código quebra também For Time, AMRAP e Carga máxima. Só corrigir para frente.
- REL-002: a API já aceita o intervalado, mas SheetView, CourtSheet e o editor do painel não. Ao revisar as 1.61 e 1.62, conferir se as duas vão juntas para produção.
- No gate da 1.62, conferir se a tela impõe "máximo por último": o motor conta o máximo tocado antes dos fixos se eles completarem depois (regra do estado final, aprovada).
- No gate da 1.63, round e fase do telão devem vir do relógio. O `round` do resumo ao vivo segue o último registro que conta, inclusive set/adj com rd.
- Método que funcionou: script de sondagem no scratchpad importando o .ts direto com node (tem strip de tipos), para vetores independentes do teste.

Relacionado: [[telao-ao-vivo-1-53-1-58]].
