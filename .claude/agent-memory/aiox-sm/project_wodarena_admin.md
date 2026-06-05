---
name: WODArena Admin Reestruturação — Estado do Epic 1
description: Contexto do epic de reestruturação do painel admin; stories criadas, decisões e estado atual
type: project
---

Projeto WODArena é SaaS de gestão de competições Functional Fitness/Hyrox/CrossFit. Stack: Next.js App Router, React, TypeScript, Tailwind, Supabase.

Story 1.1 (InReview): Design system Binance-inspired aplicado — canvas `#0b0e11`, acento `#FCD535`, superfícies claras transacionais.

Story 1.2 (Draft, criada 2026-06-02): Reestruturação completa do painel admin a partir de `doc.md`. Admin é monólito de 2663 linhas em `src/app/admin/page.tsx`. AppContext (750 linhas) é source of truth — não criar stores paralelos.

**Why:** O painel atual mistura tudo em uma única superfície; a spec (`doc.md`) define menu lateral com 3 entradas e painel interno por evento com 6 abas, com lançamento de scores em massa como funcionalidade central.

**How to apply:** Ao trabalhar em qualquer story do admin, assumir que AppContext é o único store; não renomear tipo `Division` para `Category` (Surgical Changes); exportação Excel/PDF é stub nesta story.

Ambiguidades resolvidas na story 1.2:
- WorkoutType enum mantido (não renomeado para labels do doc.md)
- Equipe=4+ dinâmico, Dupla=2, Trio=3 fixos
- Exportação como stub (sem libs de terceiros)
- Roteamento via App Router + searchParam `?tab=`
