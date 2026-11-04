---
name: stories-1-111-1-115-telao-fitness-race
description: Stories 1.111 a 1.115 (telão ao vivo Fitness Race, T1 a T5) em Draft desde 2026-11-03; cadeia, AUTO-DECISIONs, 3 perguntas abertas ao Luan e armadilhas de teste
metadata:
  type: project
---

Stories 1.111 a 1.115 criadas em Draft em 2026-11-03 a partir de `docs/design/telao-fitness-race/` (README + maquete aprovada pelo Luan; D1 a D6). Cadeia: 1.111 motor puro `src/lib/raceBroadcast.ts` (G) -> 1.112 API `/api/telao/[token]` decidindo por tipo + `serverRaceBroadcast.ts` paginada (M) -> 1.113 tela ao vivo: torre, mapa, cartões, faixa (G) -> 1.114 grid, luzes, bandeirada e roxo (M) -> 1.115 classificação, espera e mesa/aba Telão (M). Sem migration: o CHECK de `event_broadcasts.mode` já cobre os quatro modos e os índices de `race_*` já existem. ClickUp não usado (as stories recentes não têm o frontmatter).

**Why:** o telão de Functional Fitness recusa Fitness Race. O README manda o gatilho de cada tela vir do que a súmula registra, nunca do horário do cronograma, e a D45 deixa a largada só com o gestor (a mesa do telão não larga).

**How to apply:** AUTO-DECISIONs da 1.111: (1) onda largada com corrida `racing` fica ao vivo, aviso "sem leitura há N min" a partir de 10 min no rodapé, teto de 3 h, 90 s de carência (`INTERVAL_MIN_MS`) antes da classificação; (2) rodízio onda × categoria de 20 s, posição e diferença por categoria; (3) resultado publicado sem corrida conta como chegou; (4) automático: ao vivo, depois classificação alternando com o grid, senão espera, e grid sozinho só com a onda fixada; (5) estação tracejada só depois que alguém passa sem cartão (a escala da 1.104 não é lida); (6) reta final = última estação do percurso (D34). Perguntas abertas ao Luan: grid antes da 1ª onda terminar, ler a escala para tracejar desde a largada, reta final = última estação. Constantes ajustáveis: 10 min, 3 h, bandeirada 30 s, luzes só se a largada foi vista há menos de 15 s.

Armadilhas do código: `admin/page.tsx` é travado por regex em `court-ui.test.mjs` (~l.167), `live-broadcast.test.mjs` (~l.782) e `race-judges.test.mjs` (~l.325 a 329), então a aba Telão de Race entra em linhas novas; `BroadcastScreen.tsx` tem de continuar com um único `fetch(`; o harness de teste não carrega `*.module.css` (lógica de tela em funções puras); `raceOfficialScore` mora em `serverRacePublication.ts` (importa `node:crypto`) e precisa ir para módulo puro; `readRaceBoardSources` lê sem paginar (gate 1.105); `RaceSheetAccessError` não é capturado pelo `errorResponse` de `/api/telao/control`; `live-broadcast.test.mjs` ~l.284 (`ev-race` 400) muda de propósito na 1.115, e a mensagem do 400 mantém `/telão ao vivo é exclusivo/` e não cita "súmula". Neste repo não existem `.aiox/gotchas.json` nem `accumulated-context.md`.
