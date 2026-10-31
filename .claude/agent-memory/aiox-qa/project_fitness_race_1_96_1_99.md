---
name: fitness-race-1-96-1-99
description: Gate combinado 2026-10-30 das Stories 1.96 (PASS 92), 1.97 (PASS 92), 1.98 (CONCERNS 85 → PASS 90 no re-gate) e 1.99 (PASS 90) do Fitness Race F1; REL-001/REL-002 de concorrência e o que conferir no re-gate
metadata:
  type: project
---

Gate combinado em 2026-10-30. Status das quatro mantido InReview a pedido do coordenador. Gates em docs/qa/gates/1.96-…, 1.97-…, 1.98-…, 1.99-….

**Why:** os dois MEDIUM da 1.98 vêm do limite "sem transação entre corrida e decisão" que o @dev declarou; o QA os classificou como recomendados antes do primeiro evento real, não bloqueantes.

**How to apply (re-gate da 1.98):**
- REL-001: confirm_dq grava a proposta antes da corrida; exigir teste em que o update da corrida não pega e a proposta volta a pending, sem decisão.
- REL-002: adjust_heat_start pela metade quando uma liberação cai no laço; o 400 "Este já é o horário" bloqueia o retry. Exigir retry possível e teste com corrida que muda no meio do laço.
- 1.99 DATA-002: publicação usa race_runs.division_id da largada (troca de categoria depois da largada publica na categoria antiga).

Técnica: sandbox no scratchpad (cp src/tests/supabase + symlink node_modules), script de mutação por string-replace com cmp; guardas duplas (rota + assertDecider; decided_at no filtro e no UPDATE) só caem mutadas em par. PGlite com 65 migrations: ver [[fitness-race-1-94-banco-rota]]. Ver também [[fitness-race-1-95-arbitros]].

**Re-gate 1.98 (2026-10-30): PASS 90.** REL-001/REL-002 fechados. Novos LOW: TEST-001 (compensações do confirm_dq sem teste — 2 mutações sobreviveram: undo da corrida no 409 da proposta, proposta volta a pending na falha do insert) e REL-003 (sem transação: disqualify/mark_dnf/adjust_heat_start com insert da decisão falhando ficam sem registro; item da F2 com RPC FOR UPDATE).
