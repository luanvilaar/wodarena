---
name: WODArena Admin Reestruturação — Estado do Epic 1
description: Contexto histórico do epic 1 (stories 1.1 e 1.2, de junho/2026); desatualizado quanto ao tamanho do admin e ao número de stories, que já passam de 1.41
type: project
---

Projeto WODArena é SaaS de gestão de competições Functional Fitness/Hyrox/CrossFit. Stack: Next.js App Router, React, TypeScript, Tailwind, Supabase.

Story 1.1 (InReview): Design system Binance-inspired aplicado — canvas `#0b0e11`, acento `#FCD535`, superfícies claras transacionais.

Story 1.2 (Draft, criada 2026-06-02): Reestruturação completa do painel admin a partir de `doc.md`. AppContext é source of truth — não criar stores paralelos.

**Why:** O painel atual mistura tudo em uma única superfície; a spec (`doc.md`) define menu lateral com 3 entradas e painel interno por evento com 6 abas, com lançamento de scores em massa como funcionalidade central.

**How to apply:** Ao trabalhar em qualquer story do admin, assumir que AppContext é o único store; não renomear tipo `Division` para `Category` (Surgical Changes); exportação Excel/PDF é stub nesta story.

**Atualização 2026-10-14:** este resumo é de junho. Hoje `src/app/admin/page.tsx` passa de 10 mil linhas, as stories são planas em `docs/stories/1.N.story.md` (até 1.41, sem índice nem arquivo de epic para atualizar) e o padrão recente de story (1.38, 1.40, 1.41) inclui tabela de decisões, Contrato técnico, Dev Notes com riscos e `[AUTO-DECISION]`. A aprovação do Luan substitui a validação do @po nessas stories. Conferir o código atual antes de usar números deste arquivo.

Ambiguidades resolvidas na story 1.2:
- WorkoutType enum mantido (não renomeado para labels do doc.md)
- Equipe=4+ dinâmico, Dupla=2, Trio=3 fixos
- Exportação como stub (sem libs de terceiros)
- Roteamento via App Router + searchParam `?tab=`
