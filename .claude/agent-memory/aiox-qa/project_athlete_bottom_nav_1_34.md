---
name: athlete-bottom-nav-story-1-34
description: Story 1.34 (barra inferior mobile da Área do Atleta). Gate 1 CONCERNS e re-gate CONCERNS não bloqueante (2026-09-30). Pendências abertas e armadilhas verificadas em runtime.
metadata:
  type: project
---

Story 1.34 (`docs/stories/1.34.story.md`): seção ativa da Área do Atleta no hash via `useSyncExternalStore` (`src/lib/athleteSections.ts`), barra inferior fixa abaixo de lg e sidebar em lg+.

Histórico do gate:
- Gate 1 (2026-09-30): CONCERNS.
- Re-gate no mesmo dia: CONCERNS não bloqueante. As correções de código foram verificadas e test/lint/typecheck/build estão verdes (312 testes).

**Why:** o que sobrou é de processo e polimento, não de funcionalidade.

**How to apply (se houver nova revisão ou pré-push):**
- A File List precisa incluir `src/components/QualifierAthleteSubmissions.tsx`. Ele foi alterado na rodada 2 (eyebrow removido), é usado só na Área do Atleta e ficou fora da lista.
- A validação em aparelho real continua pendente e não está registrada no story. Itens: safe-area (sem `viewport-fit=cover`, `env()` = 0), teclado virtual, barra do Safari.
- O store escuta `currententrychange` da Navigation API.
  - Um `<Link>` do Next chega como `push`: correto.
  - O `replaceState` interno do Next (HistoryUpdater, após ACTION_RESTORE) chega como `replace` e pode reescrever o hash por um instante com o valor anterior quando há duas navegações rápidas. Resultado: flicker transitório (P3). Correção sugerida: ignorar `navigationType === 'replace'`.
- Existe uma edição acidental só de espaço em `page.tsx:105` (`darkLoginInputClassName ='`).
- O scratchpad é compartilhado com o implementador. Para refazer a réplica: fontes reais servidas por HTTP (`__variable_*` + os dois CSS do build) e cenários de runtime no dev server (:3000, /admin deslogado basta para testar o histórico).

Relacionado: [[focus-visible-unlayered-globals]]. Esta story resolveu o problema localmente com regras sem camada e de especificidade maior: `[data-athlete-bottom-nav] button:focus-visible`.
