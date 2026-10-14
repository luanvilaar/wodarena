---
name: focus-visible-unlayered-globals
description: Regra :focus-visible em globals.css está fora de @layer e sobrescreve utilities Tailwind v4 em todo o app — item aberto, adiado conscientemente
metadata:
  type: project
---

A regra `:focus-visible { outline: 2px solid var(--info); outline-offset: 3px }` em `src/app/globals.css` está escrita **fora de qualquer `@layer`**. No Tailwind v4 (`@import "tailwindcss"` declara as camadas theme/base/components/utilities), CSS sem camada vence CSS em camada independente de especificidade — então **toda** classe `focus-visible:outline-*` escrita em componentes é código morto.

Sintomas: anel de foco sempre azul (`--info`) com offset para fora, mesmo onde o componente pede anel `primary` ou inset. Em containers com `overflow-hidden` o anel é recortado nos itens de topo/base (2.4.7 / 2.4.11).

**Why:** identificado durante o QA gate da aba Cronograma (`src/app/event/[id]/page.tsx`, set/2026). O coordenador optou por **adiar** a correção por ser mudança app-wide que precisa de alinhamento com o usuário — não foi esquecimento.

Ocorrências confirmadas depois: barra inferior do atleta (Story 1.34, corrigida com `[data-athlete-bottom-nav] button:focus-visible { outline-offset: -4px }` fora de `@layer`) e camada de ativação do mapa em `EventMapEmbed.tsx` (Story 1.41, REQ-001, anel cortado por `overflow-hidden`; medido no Chrome headless em 2026-10-14). Ver [[project-event-map-1-41]].

**How to apply:** ao revisar foco/acessibilidade em qualquer tela, não aceitar classes `focus-visible:*` como evidência de que o foco está estilizado — verificar o comportamento real. Se alguém propuser mover o bloco para `@layer base` (a correção de raiz), tratar como mudança de escopo global com regressão visual em todo o app.
