---
name: fitness-race-1-94-banco-rota
description: Gate da Story 1.94 (banco race_*, serviço e /api/race-sheets) CONCERNS 88 em 2026-10-30; MEDIUM de teste do judge de gestor vencido; contratos para 1.96/1.97/F2 e técnica de mutação/PGlite
metadata:
  type: project
---

Story 1.94 gate CONCERNS 88 em 2026-10-30, re-gate PASS 92 no mesmo dia (TEST-001/TEST-002 fechados, conferido por mutação) (docs/qa/gates/1.94-fitness-race-banco-servico-rota.yml). Status deixado InReview a pedido do coordenador (trilha Fitness Race: QA só registra o gate). Contratos da 1.93 (REL-001/002, ARCH-001, REL-003) atendidos e travados por teste.

**Why:** a 1.94 é a base de 1.95–1.99; os riscos restantes caem nas stories seguintes.

**How to apply (conferir nos próximos gates):**
- 1.96: preencher `race_rulesets.locked_at` antes de criar `race_runs` (ARCH-001).
- 1.97/1.98: append ainda grava com corrida finished/dnf/disqualified (REQ-001); fechar o tempo pelo log, não só pelo status gravado.
- F2 (mais estações abríveis): recálculo precisa serializar por corrida (REL-001); log lido sem paginação vs 1000 linhas do PostgREST (REL-002).

Técnica: copiar src/tests/supabase + symlink de node_modules para o scratchpad (o harness resolve src relativo a tests/support) e aplicar mutações por string-replace; mutar em par os caminhos com proteção dupla. PGlite já instalado no scratchpad da sessão (pglite/node_modules), com script que cria roles anon/authenticated/service_role e storage antes das migrations. Ver [[fitness-race-1-93-motor]].
