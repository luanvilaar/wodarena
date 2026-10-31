---
name: fitness-race-1-102-1-103
description: Gate 2026-10-31 das Stories 1.102 (tela do judge por estação, PASS 91) e 1.103 (dois cartões e limite por judge, PASS 88) do Fitness Race F2; LOWs abertos e o que conferir depois
metadata:
  type: project
---

Gate em 2026-10-31, status das duas mantido InReview a pedido do coordenador. Gates em docs/qa/gates/1.102-fitness-race-tela-da-estacao.yml e 1.103-fitness-race-dois-cartoes.yml.

**Why:** a 1.103 tem regra de capacidade sem transação (reconta depois de gravar); o QA aceitou como LOW porque nunca deixa exceder, só pode recusar os dois pedidos.

**How to apply (próximos gates/re-gates da F2):**
- TEST-001 da 1.103: reconferência do assumir (claimAttemptRow) e acesso de gestor no soltar (rota) sem teste: mutações sobreviveram. Cobrar teste se a 1.105/1.104 mexer nisso.
- TEST-002: o [REL-002] do race-penalties-panel só pega a regressão do updateRunIf por acaso (4/30 sem a correção). Pedir relógio fixo.
- REL-001: dispensar deixa a tentativa cancelada por um instante; juntar com o REL-003 da 1.98 (RPC FOR UPDATE).
- UX: recusa do 2º Wall Ball aparece como texto na lista da 1.97 (a maquete pede folha); cartão de corrida encerrada travado sem aviso na tela /cartoes.
- Pendências fora do QA: conferência visual (banco é produção), aparelho real, CodeRabbit no commit, leituras assumidas da estação final com o Luan.

Técnica: sandbox no scratchpad precisa copiar também docs/design/fitness-race-sumula e docs/stories, senão o teste estático da 1.103 (maquete citada) falha na linha de base e mascara o resultado das mutações. Ver [[fitness-race-1-96-1-99]].
