---
name: design-system
description: WODArena uses a Binance-inspired design system documented in desinger-novo.md; tokens live in globals.css (Tailwind v4 @theme inline)
metadata:
  type: project
---

WODArena's UI follows a Binance-inspired design system. The canonical reference doc is `/Users/luanvilaar/Desktop/Projetos/wodarena/desinger-novo.md` (yellow #FCD535 accent, dark canvas #0b0e11, trading green/red semantics, BinanceNova/BinancePlex type with Inter/IBM Plex Sans as documented substitutes).

Design tokens are defined as CSS variables in `src/app/globals.css` and exposed to Tailwind v4 via `@theme inline`. All color hex values in globals.css match desinger-novo.md exactly (primary, primary-hover, card, card-border, trading-up, trading-down, info, ink, muted, etc.).

**Why:** Project is mid-migration to full design-system conformance; commits claim "100% conformidade com desinger-novo.md".

**How to apply:** When auditing or building UI, treat globals.css as the source of truth for tokens and desinger-novo.md for component/usage rules. Note two standing gaps found 2026-06-17: (1) Inter/IBM Plex Sans are only listed as CSS fallbacks in `--font-body`/`--font-number` but never actually loaded via next/font or link tags, so `font-sans` resolves to Tailwind's default ui-sans-serif stack; (2) the schedule's primary "Gerar Cronograma" CTA uses bg-trading-down (red) instead of bg-primary (yellow), which conflicts with the rule that trading red is reserved for Sell/Short semantics, not generic confirm actions.

**Piso de qualidade de UI (aplicado em 2026-09-20 no redesign do cronograma):** nada de `box-shadow`, gradientes (inclusive gradient-text), `transition: all`, hex fora da paleta de `globals.css`, texto de corpo abaixo de 4.5:1, ou animação de pulso sem guarda `prefers-reduced-motion`. `--muted-soft` (#707a8a) só alcança 3.65:1 sobre `--card` — use apenas para elementos não-textuais (dots, bordas de hover); para texto secundário use `--muted` (5.56:1 sobre card).

**Direção de produto na aba "Horário" do evento público:** o gestor considera a lista atual (densa, 10-11px, tudo no mesmo peso) insatisfatória em comunicação. A referência de satisfação é o schedule oficial de evento internacional de CrossFit: agrupar por DIA → PROVA → baterias colapsáveis → lista limpa de duas colunas (vaga/atleta) ao expandir. Código atual em `src/app/[locale]/event/[id]/EventView.tsx` já tem `heatStatusById` (live/next/upcoming/done, tick de 30s) e `expandedHeatIds`, então destaque "ao vivo/próxima" é reuso, não lógica nova.
