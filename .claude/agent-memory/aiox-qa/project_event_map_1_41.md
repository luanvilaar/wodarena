---
name: project-event-map-1-41
description: Story 1.41 mapa Waze do local do evento — gate CONCERNS em 2026-10-14 (REQ-001 foco invisível no overlay do mapa); o que conferir no re-gate
metadata:
  type: project
---

Story 1.41 (mapa do Waze na aba Detalhes, coordenadas no admin, `POST /api/admin/geocode` com Mapbox). Gate em 2026-10-14: CONCERNS, sem achado de segurança. Status passou de InReview para Done.

**Why:** os 16 ACs estão implementados e verificados. Só ficou um MEDIUM de acessibilidade: o botão de ativação de `EventMapEmbed.tsx` ocupa um contêiner `overflow-hidden`, e o `:focus-visible` global (fora de `@layer`, ver [[focus-visible-unlayered-globals]]) desenha o anel 3 px para fora, onde ele é cortado. Medi no Chrome headless com o CSS do build.

**How to apply:** no re-gate, conferir:
1. REQ-001: a correção precisa funcionar no navegador real, não basta haver classe `focus-visible:*`. Vale um `data-*` com regra fora de `@layer` ou um ring via `group-focus-visible`.
2. LOWs: TEST-001 (`at(-1)` no teste da migration e lista exata de deps); REL-001 (ramo judge do bootstrap sem fallback, então a migration tem de ir antes do deploy); MNT-001 (candidatos antigos no picker e foco perdido); MNT-002 (rótulo do overlay cobre o rodapé do Waze).
3. Pendências do usuário: R1 (termos do Mapbox antes do token), R5 (LGPD/termos citarem o Waze), `daddr` do Apple Maps no iPhone.

Técnicas que funcionaram nesta revisão:
- Chrome headless em `/Applications/Google Chrome.app`, com página estática no scratchpad e cópia de `.next/static/css`, para medir `getComputedStyle` e tirar screenshot.
- PGlite já instalado no scratchpad da sessão, para ver como `json_agg` serializa NUMERIC (devolve número, não string).
- `next start -p <porta>` + `HEAD /icon.svg` para ler o cabeçalho CSP real.
