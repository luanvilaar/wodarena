---
name: stories-1-93-1-99-fitness-race
description: Stories 1.93 a 1.99 (súmula digital Fitness Race, F0 e F1) em Draft desde 2026-10-30; decisões D1-D10 prevalecem sobre o plano HTML; pontos em aberto para o Luan
metadata:
  type: project
---

Stories 1.93 a 1.99 criadas em Draft em 2026-10-30 a partir de `docs/design/fitness-race-sumula/DECISOES.md` (D1 a D10, prevalece) e `plano-aprovado.html`. Ordem: 1.93 (motor puro, F0) -> 1.94 (migration race_*, serviço, rota /api/race-sheets) -> 1.95 (judges Race, aba `race`) -> 1.96 (largada da onda) -> 1.97 (Wall Ball fecha o tempo) -> 1.98 (painel de penalidades) -> 1.99 (publicação na prova TOTAL).

**Why:** D1 elimina a tela de chegada (o fim do tempo é a liberação do último Wall Ball); D2 faz penalidade valer na hora (nasce `confirmed`), então o painel é de revisão, não de confirmação.

**How to apply:** ao validar ou expandir essas stories, lembrar das armadilhas do código: `tests/court-ui.test.mjs` (~l.168) trava por regex a linha de render da aba `sheets` de FF em `admin/page.tsx`, então a aba de Race tem id `race` e linha própria; `tests/scoresheets-route.test.mjs` (~l.482-484) exige 400 para createJudge em evento Race e muda de propósito na 1.95; `isPresentialEventType` e `/api/sheets` não mudam; `recalculateWorkoutRanking` dá pontos, então a 1.99 tem ranking próprio; testes de migration usam impressão digital SHA-256 das anteriores (`name < MIGRATION`).

AUTO-DECISIONs a confirmar com o Luan: aba e `RaceSheetPanel` entram na 1.95 (não na 1.98); ensureRuleset usa preset 2026_27 por padrão; correção da largada da onda (1.96 AC7); sair antes do Wall Ball também fecha o tempo (1.97 AC8); DNF e escolha de preset no painel (1.98); DQ/DNF ampliam o CHECK de `result_status` em vez de usar `rejected` (1.99); tempo publicado em segundos inteiros; não há maquete aprovada das telas 1.96-1.98 (sugerido @ux-design-expert antes).
