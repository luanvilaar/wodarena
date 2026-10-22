---
name: event-cards-1-65-gate
description: Story 1.65 (movimento dos cards de evento da home) gate PASS 2026-10-22, score 90; 4 LOWs; medir desempenho no build de produção, não no next dev; técnicas CDP com CPU 4x
metadata:
  type: project
---

Story 1.65 (commit 7aaa5a3, já em origin/main): gate PASS em 2026-10-22, score 90, arquivo docs/qa/gates/1.65-cards-de-evento-movimento.yml. A story foi para Done.

**Why:** animação de entrada, contagem e botão Garantir Vaga nos cards da home (2A do Claude Design, amarelo do site), com foco em celular.

**How to apply:**
- LOWs abertos: PERF-001 (a contagem re-renderiza o EventCard inteiro por quadro; só pesa no `next dev`), REQ-001 (brilho com `skewX` em botão `overflow: hidden` arredondado pode vazar em Safari; não conferido), TEST-001 (hooks só com teste estático por regex), UX-001 (margem de -96 px deixa faixa vazia até rolar mais).
- Medir desempenho de animação no build de produção: `npx next start -p 3100` (o `.next` do `npm run build` serve; o `next dev` do usuário usa `.next/dev`, então o build não o derruba) com `Emulation.setCPUThrottlingRate` 4x e 3 rodadas, e sempre com linha de base em `prefers-reduced-motion: reduce`. No `next dev` a mesma animação deu tarefas longas de até 180 ms; no build de produção, 0. Encerrar o `next start` depois.
- Técnicas CDP que funcionaram: `Emulation.setDeviceMetricsOverride` com `mobile: true` mais `setTouchEmulationEnabled` faz `(hover: none)` e `(pointer: coarse)` casarem; `Emulation.setEmulatedMedia` com `prefers-reduced-motion`; `el.getAnimations({subtree: true})` lista também as animações de `::after` (`effect.pseudoElement`); a home usa `scroll-behavior: smooth`, então `scrollIntoView({behavior: 'instant'})`; `click()` que navega derruba o `Runtime.evaluate` em andamento, então disparar por `setTimeout`; `Page.captureScreenshot` com `clip` usa coordenadas de página (somar `scrollY`).
- Navegação do lado do cliente: conferir com um marcador em `window` (sobrevive só se a página JS é a mesma).
- Não conferido: aparelho físico, Safari, Firefox, leitor de tela real.
