---
name: project-intervalado-1-60-1-63-validation
description: Validação das Stories 1.60–1.63 (formato Intervalado) em 2026-10-21 — todas GO (9, 9, 8, 9), Ready; AUTO-DECISIONs aceitas; pendente só a recomendação de publicar 1.61 com 1.62
metadata:
  type: project
---

Stories 1.60 (motor, 9/10), 1.61 (construtor, 9/10), 1.62 (súmula do judge, 8/10) e 1.63 (telão, 9/10) validadas GO em 2026-10-21, Draft → Ready. Fonte: `docs/design/intervalado/README.md` + `intervalado-aprovado.html` (10 decisões aprovadas pelo Luan).

Todas as AUTO-DECISIONs do @sm foram aceitas pelo @po (nenhuma precisou do usuário). Ajustes do @po: 1.62 siglas sem parênteses ("BJO") e máximo pelo nome inteiro; detalhe dos registros fora da janela virou obrigatório (a maquete mostra); 1.63 contagem regressiva registrada como AUTO-DECISION 6; nome do bloco do payload distinto de `BroadcastState.interval` (tela de intervalo); 1.60 `lastMarkAt` ignora registros fora da janela e `readLiveProgress` passa `round`.

**Why:** o aviso da prévia da 1.61 protege só a prévia; a quadra fica exposta (SheetView cai em SegmentSheetView) entre 1.61 e 1.62.

**How to apply:** ao falar de release do intervalado, lembrar a recomendação de publicar 1.61 e 1.62 no mesmo push (decisão do Luan, que faz o push). Relacionado: [[project-story-1-59-validation]].
