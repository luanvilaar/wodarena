---
name: intervalado-1-62-gate
description: Story 1.62 (súmula do judge do Intervalado) gate PASS 2026-10-22, score 92; 6 LOWs abertos; técnicas de CDP que funcionaram; 1.63 ainda sem gate
metadata:
  type: project
---

Story 1.62 (commit 97775b8): gate PASS em 2026-10-22, score 92, arquivo docs/qa/gates/1.62-intervalado-sumula-do-judge.yml. Story foi para Done.

**Why:** fecha o REL-001 da 1.61 (a súmula do intervalado não cai mais na de segmentos). A 1.63 (telão, 38d36a5) foi commitada durante a revisão e ainda não teve gate; recomendado publicar 1.60 a 1.63 juntas.

**How to apply:**
- LOWs abertos: REQ-001 o foco se perde quando o tile é remontado pela key (vale também para o For Time, SheetView.tsx:356); REQ-002 um segurar que cruza 01:59→02:00 some sem aviso; REQ-003 o selo de fase continua com o relógio parado; REQ-004 o nome do fixo com parênteses no resumo; REQ-005 pelo teclado não há como concluir um fixo por bloco; MNT-001 "repetições" falta na confirmação de atleta ausente (CourtSheet.tsx:218).
- Ao revisar uma story de a11y da súmula, conferir se o REQ-001 foi resolvido nas duas súmulas.
- CDP: ler o log do SheetDemo por textContent (o <details> fechado deixa innerText vazio, e o innerText sai em caixa alta por text-transform). Para o Enter ativar um botão, o Input.dispatchKeyEvent precisa de text '\r'. O Date.now deslocado com window.__t0 marcado logo depois do clique em Iniciar pula o relógio para o segundo exato.

Relacionado: [[intervalado-1-61-gate]], [[intervalado-1-60-gate]].
