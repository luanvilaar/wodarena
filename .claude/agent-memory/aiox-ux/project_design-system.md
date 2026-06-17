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
