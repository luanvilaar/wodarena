---
name: intervalado-1-61-gate
description: Story 1.61 (construtor do Intervalado) gate CONCERNS 2026-10-21; publicar só com a 1.62 (REL-001 medium); LOWs abertos e o que conferir na 1.62
metadata:
  type: project
---

Story 1.61 (construtor do Intervalado, commit f7b8a79): gate CONCERNS em 2026-10-21, score 88, arquivo docs/qa/gates/1.61-intervalado-construtor-da-prova.yml. Código sem defeito bloqueante; story foi para Done.

**Why:** a 1.61 põe o Intervalado na tela do gestor, mas a súmula do judge (SheetView.tsx:428) ainda cai na de segmentos até a 1.62. Banco único = produção.

**How to apply:**
- REL-001 (medium, @devops): 1.60 e 1.61 estavam só no main local; não publicar antes do gate da 1.62. No gate da 1.62, conferir que o aviso INTERVAL_PREVIEW_NOTICE (WorkoutSheetBuilderDialog) saiu, o teste dele foi ajustado sem afrouxar e o SheetPreview ganhou o exemplo do Intervalado.
- REQ-001 (low, @po): "Remover súmula" numa prova intervalada deixa o tipo `reps` e o editor some (admin/page.tsx, condição fortime/amrap/maxweight). Efeito da AUTO-DECISION 7.
- REQ-002 (low): inputMode="numeric" nos campos MM:SS; teclado do iPhone sem ":". Não conferido em aparelho.
- MNT-001 (low): "78:00" no construtor vs "1:18:00" no time_cap legado.
- Método que funcionou: Chrome headless via CDP em /pt-br/sumula-preview/editor (botão "Carregar o exemplo do Intervalado", depois #preview-open); foco por teclado só conta com Input.dispatchKeyEvent (o .focus() programático não ativa :focus-visible). Não rodar `npm run build` com o `npm run dev` do usuário no ar.

Relacionado: [[intervalado-1-60-gate]].
