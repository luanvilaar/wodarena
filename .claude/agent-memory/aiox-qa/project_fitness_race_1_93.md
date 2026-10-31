---
name: fitness-race-1-93-motor
description: Gate da Story 1.93 (motor de regras Fitness Race, F0) PASS 92 em 2026-10-30; contratos que a 1.94/1.97 precisam respeitar e técnica de mutação fora do repo
metadata:
  type: project
---

Story 1.93 (raceRules.ts + raceRulePresets.ts) gate PASS 92 em 2026-10-30, só LOWs. Gate em docs/qa/gates/1.93-fitness-race-motor-de-regras.yml. Status deixado InReview a pedido do coordenador (não mudar Status nesta trilha; só registrar o gate).

**Why:** a 1.93 é fundação; os riscos reais ficam na integração da 1.94 (servidor, snapshot, seq) e da 1.97 (tela Wall Ball).

**How to apply (conferir no gate da 1.94/1.97):**
- 1.94 recalcula a corrida com `evaluateRaceRun` (senão "estação fora de ordem" cobra 180 s duas vezes em vez de proposta de DQ) — REL-002.
- 1.94 grava no snapshot `reps` do Wall Ball e `expectedUnits` do Sled (distância/12,5 m); sem isso o motor não trava nem cobra falta — REL-001.
- `seq` da 1.94 tem de ser a posição 0-based no log da tentativa (undo.of e sourceKey dependem disso) — ARCH-001.
- 1.97: desfazer o start apaga silenciosamente o efeito das reps seguintes (REL-003).
- Teste faltando: exit com REFAZER aberto (TEST-001).

Técnica útil: `importServerModule` aceita URL file:// absoluta, então dá para copiar o módulo para o scratchpad, aplicar mutações e rodar uma cópia do teste apontando para a cópia, sem tocar no repo. Ver também [[intervalado-1-60]] e [[distancia-1-66-1-68]] (motores puros com o mesmo padrão de log/undo).
