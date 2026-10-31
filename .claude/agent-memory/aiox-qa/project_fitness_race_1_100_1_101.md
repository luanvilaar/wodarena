---
name: fitness-race-1-100-1-101
description: Gate F2 Fitness Race 1.100 (estrutura da prova) PASS 92 e 1.101 (última estação fecha o tempo) PASS 90 em 2026-10-31; LOWs abertos e técnica de mutação em cópia isolada
metadata:
  type: project
---

1.100 PASS 92 e 1.101 PASS 90 (2026-10-31), só LOW. Status mantido InReview a pedido do coordenador (não mover para Done quando ele pedir isso).

**Why:** F2 roda com vários revisores de QA em paralelo na mesma árvore; mexer em arquivo de src para mutação quebraria os testes deles.

**How to apply:**
- Mutação: copiar src/tests/supabase/package.json/tsconfig.json para o scratchpad e symlink de node_modules; os testes node --test rodam lá iguais. Não mutar a árvore de trabalho com outros revisores ativos. Não rodar `npm run build` quando o coordenador pedir (colide no .next).
- LOWs a conferir em re-gate/próximas: 1.100 TEST-001 (chip da lista sem asserção de render), UX-001 (alerta antes de salvar); 1.101 REQ-001 (telas só enviam a fila com run racing no estado local: registro tardio só com a tela aberta), MNT-001 (painel lê snapshot sem courseStagesOf), DOC-001 (trechos x voltas), REL-001 (publicar com 1.102).
- D44 em DECISOES.md responde a saída incompleta na última estação (não fecha; organizador age).
- Relacionado: [[fitness-race-1-96-1-99]].
