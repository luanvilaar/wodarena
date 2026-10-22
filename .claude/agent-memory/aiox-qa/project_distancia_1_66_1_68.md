---
name: distancia-1-66-1-68-gate
description: Stories 1.66 a 1.68 (formato Distância na súmula) gate em 2026-10-22: 1.66 PASS 94, 1.67 PASS 91, 1.68 CONCERNS 88; REQ-001 do gestor corrigido na revisão; telão só na 1.69
metadata:
  type: project
---

Stories 1.66 (contrato v4 e motor), 1.67 (construtor) e 1.68 (súmula do judge), código no commit 8fe9018, gates em docs/qa/gates/1.66-…, 1.67-… e 1.68-…. As três foram para Done. A 1.69 (telão) segue Ready, fora desta rodada.

**Why:** a 1.68 ficou em CONCERNS (88) porque, até a 1.69, o telão ao vivo mostra a distância como "For Time", com o relógio "Time cap" e o total sem unidade (REL-001, decisão 9 do README). O achado real da revisão foi o REQ-001: a correção da súmula pelo gestor usava `parseScoreForWorkout('distance', …)`, que lê "6.330" como 6,33. Foi corrigido na própria revisão (`serverScoresheets.ts`, correção usa `parseMetersInput` quando a estrutura é de distância) e coberto no teste do ciclo real da rota.

**How to apply:**
- LOWs abertos: REL-001 da 1.66 (só roll-forward depois do deploy, v4 em todo formato), MNT-001 da 1.66 (COMMENT de `scoresheet_events` não cita `dist`), REQ-001 a REQ-003 da 1.67 (texto fora do AC, selo `points` cai em "Reps", texto "toque e segure" na prévia), REQ-002 da 1.68 (lançamento manual de tipo `distance` ainda lê "6.330" como 6,33, já era assim), REQ-003 (cartão de resultado atrás da barra fixa) e MNT-001 (lista do painel mostra "6330" cru).
- Ao revisar a 1.69: conferir rótulo "Distância" e "Duração", a linha da chamada, o total em metros com unidade, "–" sem lançamento e o ausente por último.
- Técnicas que funcionaram: o tema claro da quadra se confere aplicando a classe `court-light` num ancestral da súmula na página de preview e varrendo o contraste WCAG por JavaScript; a largura de celular, fixando a largura do contêiner em 360 e 320 px (a janela do navegador não encolhe). Para provar o campo sem interação real: setar `value` pelo setter nativo de `HTMLInputElement` e disparar `input`.
- Um fuzz de 20 mil estruturas e 20 mil logs, mais o parser em todos os totais de 0 a 99999, é barato (segundos) e vale repetir quando o contrato mudar de versão.

Relacionado: [[intervalado-1-60-gate]], [[intervalado-1-63-gate]].
