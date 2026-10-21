---
name: stories-1-60-a-1-63-intervalado
description: Stories 1.60 a 1.63 (formato Intervalado na súmula digital), Draft de 2026-10-21; decisões fechadas no README da pasta de design e pontos que o @po precisa confirmar
metadata:
  type: project
---

Stories 1.60 (contrato v3 e motor), 1.61 (construtor), 1.62 (súmula do judge) e 1.63 (telão) criadas em 2026-10-21 como Draft, a partir de `docs/design/intervalado/README.md` + `intervalado-aprovado.html` (10 decisões aprovadas pelo Luan). Sem migration em nenhuma.

**Why:** o organizador enviou o treino "5 rounds, 2min ON / 2min OFF, fixos + Max. Squat Clean"; nenhum dos 3 formatos atuais o representa.

**How to apply:**
- Ordem de dependência: 1.60 só depois da 1.59 commitada (as duas editam `scoresheet.ts`); 1.61 e 1.62 dependem da 1.60; 1.63 depende das 1.53-1.58 commitadas (as correções de QA de 1.56/1.58 ainda estavam sem commit em 2026-10-21) e da 1.60.
- Pontos que o README não fecha e as stories marcaram como AUTO-DECISION para o @po confirmar: fixos moram em `segments` (um round, `round: 1`) e o máximo em `interval`; unidade dos fixos (reps/cal/m); teto do máximo por round (proposta 999); semântica do resumo ao vivo (campo opcional novo `round`); prévia do construtor entre 1.61 e 1.62 (aviso ou publicar juntas); siglas do quadro dos rounds; fixos recolhidos na correção por round.
- Armadilha de código: vários pontos fazem "se max_load ... senão For Time" (`computeSheetOutcome`, `computeAbsentOutcome`, `summarizeLiveProgress`, `checkOfficialTime`, `SheetView`, `CourtSheet.finished`/`OfficialTimeForm`, `formatLabel` do telão); o formato novo cairia em For Time se não tiver ramo próprio.
