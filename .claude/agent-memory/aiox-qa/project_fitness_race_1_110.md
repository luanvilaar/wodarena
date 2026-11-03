---
name: project-fitness-race-1-110
description: Story 1.110 largada só pelo gestor — gate CONCERNS 85 (2026-11-03); 2 MEDIUM de recuperação no painel (Entrar de novo /admin→/admin, aviso de recusa só na folha); o que conferir no re-gate
metadata:
  type: project
---

Story 1.110 (largada das ondas Fitness Race só do gestor/owner, folha no painel Ondas; D45) — gate CONCERNS 85 em 2026-11-03, status mantido InReview a pedido do coordenador.

Servidor OK: start_heat com assertRaceManagerAccess, teste de 403 do judge com snapshot + rpcCalls; mutação para assertRaceJudgeAccess derrubada.

**Why:** os MEDIUM afetam o dia da prova (onda que não sobe sem o gestor saber), não a integridade do horário.

**How to apply (re-gate):**
- REQ-001: "Entrar de novo" era `<Link href="/admin">` dentro do /admin — mesma rota não remonta o AppProvider (layout raiz), login não aparece; além disso fica atrás do overlay da folha. Conferir se virou botão que força login/reload e se aparece na folha.
- REQ-002: heatStart.notice só renderiza na folha da onda; fechar limpa. Conferir aviso no painel com folha fechada e no flush da fila de sessão anterior.
- LOWs: foco do dialog (A11Y-001), celular deitado com layout md (UX-001), fila lida só na montagem (REL-001), testes só regex do hook (TEST-001), comentários "tela de largada" (DOC-001).
- Padrão útil: link de recuperação que aponta para a própria rota é no-op no App Router — procurar isso quando uma tela muda de rota (ver [[project-fitness-race-1-96-1-99]]).
