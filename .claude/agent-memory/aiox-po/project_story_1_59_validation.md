---
name: project-story-1-59-validation
description: Validação da Story 1.59 (atleta ausente na súmula) em 2026-10-21 — GO 9/10, Ready; decisões 12 a 17 confirmadas pelo Luan, sem pendência
metadata:
  type: project
---

Story 1.59 validada GO (9/10) em 2026-10-21, Status Draft → Ready. Decisões do usuário em `docs/design/atleta-ausente/README.md` (1 a 13; 12 e 13 são as AUTO-DECISIONs 9 e 12 do @sm confirmadas pelo Luan no mesmo dia).

**Pendências resolvidas (v1.3, 2026-10-21, decisões 14 a 17):** o Luan aceitou as quatro recomendações do @po: gestor pode marcar ausente súmula enviada com resultado real (a confirmação mostra o resultado substituído); lançamento manual com o mesmo valor mantém o selo; só papel `judge` assume súmula sem judge (gestor/owner só leem); vale também para súmula de judge apagado.

**Why:** a story partiu do código com correções de QA das 1.56/1.58 sem commit (telão paginado em `readBroadcastSheets`, regra `touched` em `buildGroups`), que já resolvem o REQ-002 sem a 1.59.

**How to apply:** se o Luan responder às pendências, atualizar AC6/AC7 da 1.59 e o README; nesse projeto stories derivadas de decisões aprovadas costumam dispensar o @po (1.50–1.52), mas a 1.59 passou pela validação. Ver [[project-story-1-59-atleta-ausente]] na memória do @sm.
