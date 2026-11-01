---
name: project-qualifier-decision-email-1-108-1-109
description: Gate 2026-11-01 das Stories 1.108 (e-mail ao atleta em toda decisão do Qualifier) PASS 90 e 1.109 (decisão na área do atleta) FAIL 70 → PASS 90 no re-gate; LOWs abertos e armadilha de fixture
metadata:
  type: project
---

Gate de 2026-11-01: 1.108 PASS (90) e 1.109 FAIL (70), que virou PASS (90) no re-gate do mesmo dia (reviewedBy fora da resposta, latestDecision só da versão atual, erro de leitura só no log). Gates em docs/qa/gates/1.108-qualifier-email-em-toda-decisao.yml e 1.109-qualifier-decisao-na-area-do-atleta.yml.

**Por que a 1.109 falhou:** o AC1 diz "nunca o nome nem o id de quem analisou", mas GET /api/submissions devolve `reviewedBy` (o SELECT inclui reviewed_by, o RPC grava o id de quem decidiu, e o id do judge é `judge-<base36>-<rand>`). O teste da story passava porque o seed e o RPC emulado não preenchem reviewed_by. É uma armadilha recorrente: teste de "não vaza X" com fixture que nunca contém X.

**Como aplicar:** LOWs abertos da 1.109: TEST-002 (sem navegador) e TEST-003 (caminho de erro sem teste; 1 falha não identificada em 9 rodadas do npm test, guardar a saída se voltar). Semântica de versão: revisão, novo envio pedido e reopened gravam current_version; só o envio do atleta e o lançamento manual sobem a versão.
- Técnica que funcionou: teste avulso no scratchpad importando tests/support/fakeSupabase.mjs e serverModuleHarness.mjs por caminho absoluto, rodando a rota real.

**1.108 LOWs abertos:** o CLI bin/qualifier.mjs decide sem avisar; nada conferido em cliente de e-mail real; sem fila de reenvio. Já resolvidos: log de leitura, timeout de 8 s no Resend, D6 no DECISOES.md. O lote retroativo de 366 decisões (D3) segue fora.

Relacionado: [[project-public-repo-disclosure]].
