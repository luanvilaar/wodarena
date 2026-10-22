---
name: intervalado-1-63-gate
description: Story 1.63 (Intervalado no telão) gate PASS 2026-10-22, score 92; 5 LOWs; selo Ausente do telão nunca implementado (lacuna da 1.59); armadilhas do CDP no telão
metadata:
  type: project
---

Story 1.63 (commit 9dfd8a0): gate PASS em 2026-10-22, score 92, arquivo docs/qa/gates/1.63-intervalado-telao.yml. A story foi para Done. Com isso, as stories 1.60 a 1.63 podem ser publicadas juntas.

**Why:** fecha a fase intermediária aceita na decisão 9, em que o telão rotulava o intervalado como "For Time".

**How to apply:**
- LOWs abertos:
  - REQ-001: o título da prova é cortado no cabeçalho do intervalado com uma bateria de duas categorias; a contagem e a fase ocupam cerca de 25cqw.
  - TEST-001: o teste "sem a coluna absent" não exercita nada.
  - REQ-002: a raia e o selo "Ausente" no telão (AC9 e T7 da 1.59) não existem no código. Ao revisar a 1.59, exigir os dois e um teste com o erro de coluna ausente injetado.
  - MNT-001: cast duplo em broadcastIntervalPhase.
  - DOC-001: o gate da 1.62 cita 38d36a5, mas o commit certo é 9dfd8a0.
- Armadilhas do CDP no telão:
  - O seletor `header[class*="top"]` pega a navbar do site. Usar `[aria-label="Telão ao vivo"] header`.
  - Congelar Date.now causa um erro de hidratação, porque o horário do SSR fica diferente do relógio congelado. Conferir o console numa rodada sem congelar.
  - Para ver o relógio andar, o fixture precisa avançar `serverTime` a cada poll. Sem isso, o offset prende o relógio.

Relacionado: [[intervalado-1-62-gate]], [[intervalado-1-60-gate]], [[telao-ao-vivo-1-53-1-58]].
