---
name: fitness-race-1-104-1-105
description: Gate 2026-10-31 das Stories 1.104 (escala de judges, PASS 92, migration pronta) e 1.105 (cobertura ao vivo, CONCERNS 86, MEDIUM de tentativas sem paginação); o que conferir no re-gate
metadata:
  type: project
---

Gate em 2026-10-31. Status das duas mantido InReview a pedido do coordenador. Gates em docs/qa/gates/1.104-fitness-race-escala-de-judges.yml e 1.105-fitness-race-cobertura-ao-vivo.yml.

**Why:** 1.105 ficou CONCERNS por REL-001 herdado: readRaceBoardSources (serverRaceSheets.ts ~1436) lê race_attempts do evento todo sem range(); com a F2 todas as estações abrem cartão, então ~125 atletas x 8 estações passa de 1000 linhas (limite padrão do PostgREST) e a cobertura/painel 1.98 ficam incompletos sem aviso. É o mesmo padrão do REL-002 da 1.94, agora alcançável.

**How to apply (re-gate):**
- 1.105 REL-001: exigir paginação e teste com mais de 1000 tentativas (corte simulado no banco em memória).
- 1.105 REQ-001: estimativa não conta cartão aberto (desvio do AC3 e da nota da maquete); só fecha com confirmação do Luan e AC ajustado pelo @po.
- 1.104: migration 20261101120000_race_judge_assignments.sql conferida em PGlite e pronta; aplicar antes do código. LOWs: escala sem paginação, linhas de onda apagada ficam, clear fora do advisory lock.

Técnica: o script PGlite do @dev da 1.104 (run.mjs) ficou no scratchpad da sessão dele; acrescentei ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO anon, authenticated para provar o REVOKE da função. Mutação: sandbox com src/tests/supabase + docs/design (o teste da 1.105 checa a maquete) + symlink de node_modules; 14/14 mutações derrubadas. Ver [[fitness-race-1-96-1-99]] e [[fitness-race-1-94-banco-rota]].
