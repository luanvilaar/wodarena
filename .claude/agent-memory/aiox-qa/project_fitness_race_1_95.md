---
name: fitness-race-1-95-arbitros
description: Gate da Story 1.95 (judges em evento Fitness Race, race_* RPCs) CONCERNS 88 → PASS 92 no re-gate 2026-10-30; REQ-001 (erro novo só para Race) fechado
metadata:
  type: project
---

Story 1.95 gate CONCERNS 88 em 2026-10-30 (docs/qa/gates/1.95-fitness-race-arbitros.yml). Status deixado InReview a pedido do coordenador.

**Why:** o Luan decidiu que o tratamento de erro novo (4xx com mensagem) vale SÓ para Fitness Race; FF e Qualifier mantêm o 500 "Erro ao persistir dados.". Regra geral dele: não mudar contrato de FF de carona numa story de Race.

**How to apply (re-gate da 1.95):**
- Conferir que o fix cobre também o createJudge de FF/Qualifier, não só assign/remove: as 4 mensagens novas estão no judgeCreationErrorResponse compartilhado.
- Exigir teste com ev-ff/ev-qualifier voltando 500 (conflito, mismatch, PGRST202 em assign/remove).
- race_* são cópia exata das sheet_* (diff -w contra a seção 6 de 20261017120000_scoresheets.sql); o script PGlite do @dev em scratchpad/race-judges-pg/run.mjs roda as 12 situações.
- Ordem de aplicação: race_sheets, depois race_judges, depois o código.

1.94 virou PASS 92 no re-gate (TEST-001/002 fechados, 8/8 mutações). Ver [[fitness-race-1-94-banco-rota]]. Build local pode cair no next/font na 1ª execução; repetir.

**Re-gate 2026-10-30: PASS 92.** REQ-001 fechado: judgeCreationErrorResponse idêntico ao HEAD, raceJudgeErrorResponse só no ramo Race; 3/3 mutações de vazamento derrubadas. Seguem LOWs REQ-002 (403), SEC-001 (IS DISTINCT FROM), DOC-001 (CodeRabbit).
