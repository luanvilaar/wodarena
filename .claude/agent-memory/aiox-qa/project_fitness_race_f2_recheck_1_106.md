---
name: fitness-race-f2-1-106-e-recheck-f1
description: Gate da 1.106 (splits públicos) PASS 92 e re-verificação de regressão das 1.93–1.99 depois da F2 e da D27–D30 (2026-10-31), todos PASS mantidos; o que ficou aberto e como comparar com a F1
metadata:
  type: project
---

2026-10-31: 1.106 PASS 92 (LOWs TEST-001 tela só por regex, SEC-001 motivo livre do organizador vai para race:penalties público, REQ-001 timeline sem "-" também no manual, DATA-001). Re-verificação das 1.93–1.99: todos PASS mantidos, Status InReview a pedido do coordenador.

**Why:** a D27–D30 (sem DQ, casos de DQ viram 180 s, regulamento fixo 2026/27, sem infração geral à mão) entrou no código na noite de 2026-10-30 **sem story nem Dev Agent Record**; os ACs da F1 (1.93 AC7–12, 1.94 AC5/6/9/11, 1.97 AC15, 1.98 AC5/6/10/14/16, 1.99 partes DQ de AC5/10/13) seguem [x] descrevendo DQ. Tratei como requisito superado (não regressão): DOC-002 LOW para o @po anotar antes de Done.

**How to apply:**
- REL-004 (1.93, LOW): regulamento gravado antes da D28 (sem perUnitSeconds/declinedSeconds) faz penalidade valer 0 s em silêncio; conferir se o @dev normalizou em rulesOf e se existe linha em race_rulesets antes do 1º evento.
- REL-001 da 1.94 (serialização do recálculo) agora é alcançável na F2; segue LOW por causa das guardas de contagem/tamanho do log.
- Para comparar com o estado da F1 não há git (tudo untracked): usar o sandbox antigo em scratchpad da sessão 97e6d781 (mut4 = 22:27 de 10-30, pré-fix da 1.98; serverRaceDecisions.ts.bak = re-gate 22:40). Ver [[fitness-race-1-96-1-99]], [[fitness-race-1-93-motor]].
