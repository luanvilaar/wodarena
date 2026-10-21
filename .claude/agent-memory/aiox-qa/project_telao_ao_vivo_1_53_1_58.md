---
name: project-telao-ao-vivo-1-53-1-58
description: Telão ao vivo (Stories 1.53–1.58) — rodada 3 de 2026-10-21: 1.56 e 1.58 PASS (só LOW); 1.57 segue CONCERNS (ensaio em TV)
metadata:
  type: project
---

Revisão de 2026-10-20: 1.53, 1.54, 1.55 e 1.58 PASS; 1.56 e 1.57 CONCERNS. Re-revisão de 2026-10-21 das QA fixes (diff não commitado do @dev):
- 1.56 → PASS. REQ-001, REQ-002 e PERF-001 resolvidos.
- 1.58 → CONCERNS. MEDIUM novo, REQ-003: o "Encerrar" na Chamada grava finished_at numa bateria sem toque. O grupo nunca fica live, e a Largada não limpa a marca.

Status de todas segue InReview: o usuário decide o Done, e a migration `20261020120000_live_broadcast.sql` não foi aplicada. Os gate files ficam em `docs/qa/gates/1.5X-*.yml` (com `history`).

Rodada 3 (2026-10-21, mesmo dia): 1.56 e 1.58 PASS.
- 1.58: REQ-003 resolvido na tela, no servidor (finish com 409 em grupo sem registro) e na Largada (limpa finished_at).
- 1.56: SEC-002 resolvido com cache LRU de hashes válidos, conferidos no banco a cada consulta.
- LOWs abertos: SEC-003 (TV que liga durante a varredura leva 429), REQ-004 (Largada numa bateria encerrada fixada reabre sem avisar), PERF-003 (finish lê o evento inteiro).

**Why:** a correção do motor (súmula tocada ou enviada não deixa o grupo "opened") fez a Chamada só aparecer para bateria sem toque, e o botão novo passou a agir na próxima bateria.

**How to apply:** no próximo re-gate:
1. 1.58 REQ-003: exigir teste pelas rotas de que encerrar na Chamada não suprime o ao vivo depois (ou que o finish é recusado ou limpo pela Largada).
2. LOWs da 1.56:
   - SEC-002: bloqueio de 404 por IP checado antes do link, então a TV válida no mesmo NAT leva 429.
   - REL-003: seq parado quando o resumo falha, e a bateria vira Chamada.
   - REL-002: grupo `loose:` sem Chamada depois do primeiro envio.
   - PERF-002: duplicata na paginação por offset.
3. 1.57: evidência do ensaio em TV e projetor.
4. Depois de aplicar a migration: smoke test de `seq:live_progress->seq` no Supabase real.

Técnicas que funcionaram:
- Scripts `node --test` no scratchpad importando `tests/support/serverModuleHarness.mjs` (`importServerModule('lib/broadcastMode.ts')`) por caminho absoluto. Saída de console.log aparece como linhas `# ` no TAP.
- `fakeSupabase.mjs` agora tem `.range()` e projeção `coluna->chave` (só quando o select tem `->`). Coluna inexistente vira null no fake, não erro.
- PGlite (`@electric-sql/pglite@0.2`) no scratchpad para provar grants e REVOKE.
