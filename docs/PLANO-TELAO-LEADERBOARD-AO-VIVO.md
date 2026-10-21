# Plano de Implementação — Telão ao vivo (leaderboard de transmissão)

> **Status:** APROVADO em 2026-10-20 e implementado (Stories 1.53 a 1.58, InReview). A migration `20261020120000_live_broadcast.sql` ainda precisa ser aplicada no Supabase. Desenho aprovado: [docs/design/telao-ao-vivo/](design/telao-ao-vivo/).
> **Data da análise:** 2026-10-19
> **Maquete interativa:** https://claude.ai/artifact/Djj1vQ3KUyAX8YCioKFQ5S (privada; fonte local temporária). Depois da aprovação, a maquete vai para `docs/design/telao-ao-vivo/` e passa a ser citada nos critérios de aceite das stories, como foi feito com a súmula digital.
> **Método:** AS-IS → TO-BE → DELTA, como em `docs/PLANO-LIVE-TIMING-FITNESS-RACE.md`.

---

## Sumário executivo

Hoje o WODArena tem um leaderboard público por categoria, calculado no navegador a partir do bootstrap. O pedido é uma segunda tela, feita para TV ou projetor no local do evento, que acompanha o cronograma oficial:

- **Com bateria rodando:** placar da bateria em questão, atualizado a cada repetição que o judge marca na súmula digital.
- **No intervalo entre baterias:** classificação geral da categoria, já com os resultados que acabaram de ser publicados.

A base para isso já existe. A súmula grava cada toque no servidor em até cerca de 1 segundo (fila do aparelho com envio imediato), o servidor já tem o motor que transforma o log em progresso (`deriveSheetState`) e o cronograma já descreve as baterias, a prova e as raias. O que falta é: um progresso ao vivo legível sem reprocessar o log a cada leitura, uma noção de "bateria no ar" no servidor, um endpoint de leitura para o telão, a tela em si e uma mesa de controle para o gestor.

Decisões já tomadas com o usuário (2026-10-19):

| # | Decisão | Escolha |
|---|---------|---------|
| D1 | Troca entre placar da bateria e geral | **Automática** (cronograma + súmulas) **com mesa de controle** para o gestor fixar ou forçar uma tela |
| D2 | Acesso da TV | **Link secreto gerado pelo gestor**, revogável, sem login |
| D3 | Baterias simultâneas | **Uma por vez** no evento |
| D4 | Nome exibido | **Nome completo sanitizado + box** (times mostram o nome do time) |
| D5 | Placar da bateria | **Estrutura C, "Líder e pelotão"** (2026-10-20) |
| D6 | Link perdido | **Gera outro**; o banco guarda só o hash (2026-10-20) |
| D7 | Largada e encerrar | **Só o gestor.** O telão detecta pelas súmulas quem está sendo julgado, sem depender do horário do cronograma, porque atrasos são comuns (2026-10-20) |
| D8 | Tela de chamada | Quando os judges abrem as súmulas da bateria ou a chamada é liberada no cronograma. O gatilho "5 min antes do horário" saiu por causa da D7 (2026-10-20) |
| D9 | Migrations da súmula | Já estavam aplicadas no Supabase (conferido em 2026-10-20) |

---

# PARTE I — AS-IS

## 1. O que existe e serve ao telão

| Peça | Onde | Como o telão usa |
|------|------|------------------|
| Leaderboard público | [Leaderboard.tsx](../src/components/Leaderboard.tsx), rota `/[locale]/event/[id]/leaderboard` | Referência visual e de regra. O cálculo geral está em `getLeaderboard` ([AppContext.tsx:2087](../src/context/AppContext.tsx#L2087)), **no navegador**. |
| Regra de colocação por prova | `rankWorkoutScores` ([scoring.ts:149](../src/lib/scoring.ts#L149)) | Já roda no servidor ao publicar a súmula ([serverScoresheets.ts:513](../src/lib/serverScoresheets.ts#L513)). Pontos = colocação (low-point). |
| Cronograma e baterias | `events.event_schedule` (JSONB), itens `kind: 'heat'` com `workoutId`, `heatNumber`, `date`, `time`, `endTime`, `athleteIds` (raia = posição + 1), `isCallReleased` | Ordem oficial das baterias, line-up por raia e horário previsto. A montagem das raias já existe em `buildSheetBoard` ([serverScoresheets.ts:213](../src/lib/serverScoresheets.ts#L213)). |
| Súmula digital | tabelas `scoresheets` (com `heat_id`, `heat_number`, `lane`, `status`) e `scoresheet_events` (log de cada toque) | Fonte do progresso ao vivo. |
| Envio dos toques | [useSheetSync.ts](../src/components/judge/useSheetSync.ts) | Cada toque entra numa fila local e sobe na hora para `POST /api/sheets` (`append`), em lote de até 200. Sem rede, guarda e reenvia. |
| Motor da súmula | `deriveSheetState` ([workoutStructure.ts:851](../src/lib/workoutStructure.ts#L851)) | Devolve `repsDone`, `roundsCompleted`, `currentSegmentId`, `completedAt` etc. Mesmo motor do aparelho e da publicação. |
| Publicação | `submitSheet` publica direto em `scores` e recalcula a prova (decisão 3 da E3) | O geral do intervalo já reflete a bateria assim que os judges enviam. |
| Tokens e sessão | [serverSecurity.ts](../src/lib/serverSecurity.ts) (HMAC, scrypt, `checkRateLimit` em memória) | Base para o link do telão (token próprio, guardado como hash). |

## 2. Achados que condicionam o desenho

**a) Cada súmula tem o seu relógio.** O campo `at` dos eventos é o segundo do relógio daquela súmula (decisão 2 da E3). Não existe um "relógio da bateria" no servidor. O telão precisa de um: proponho a **largada marcada na mesa de controle** e, sem ela, a largada **estimada** pelas súmulas (`recorded_at − at` do primeiro registro de cada súmula, pegando a mais antiga).

**b) Não existe camada realtime.** Todo o app atualiza por re-leitura (quadro do judge e aba "Súmulas" a cada 15 s). A CSP já libera o `wss://` do Supabase, mas as tabelas da súmula não têm acesso anônimo (RLS sem policy), então `postgres_changes` não serve, e um canal de broadcast público aceitaria mensagens forjadas. Ver decisão de arquitetura em §5.

**c) Ler o log inteiro a cada atualização do telão é caro.** Uma bateria de 10 raias num For Time longo passa de 3.000 registros. Mas o `append` já lê o log inteiro da súmula para validar ([serverScoresheets.ts:470](../src/lib/serverScoresheets.ts#L470)): calcular o progresso ali e gravá-lo numa coluna custa quase nada e deixa a leitura do telão com uma linha por raia.

**d) O geral da categoria só existe no navegador.** Para o telão mostrar o mesmo geral do leaderboard público, a regra precisa sair do `AppContext` para uma função pura em `src/lib`, usada pelos dois. Não pode existir uma segunda regra de classificação.

**e) O telão depende das migrations da súmula** (`20261016120000_workout_structure.sql` e `20261017120000_scoresheets.sql`). Elas já foram aplicadas no Supabase (conferido em 2026-10-20).

**f) Eventos Fitness Race não usam súmula.** O telão desta fase cobre Functional Fitness presencial. Fitness Race fica para o plano de live timing.

---

# PARTE II — TO-BE

## 3. O que o público vê

Rota nova `/telao/[token]`, fora do layout do site (sem navbar e rodapé), em 16:9, legível a 20–30 m. A tela tem quatro estados, escolhidos pelo servidor:

| Estado | Quando | O que mostra |
|--------|--------|--------------|
| **Chamada** (pré-largada) | Judges abriram as súmulas da bateria e nenhum toque ainda, ou chamada liberada no cronograma (`isCallReleased`) | Raias com nome e box, quais judges já estão na raia, a prova (movimentos, cargas, time cap) e o horário previsto |
| **Bateria ao vivo** | Uma súmula da bateria recebeu registro (súmula parada há mais de 20 min não segura a bateria no ar) | Relógio da bateria, cada raia com repetições, movimento atual e posição parcial; quem termina fica com o tempo; quem tem a súmula enviada ganha o selo "Oficial" |
| **Intervalo** | Todas as súmulas da bateria enviadas, ou "Encerrar bateria" na mesa; fica pelo menos 90 s antes da chamada seguinte | Geral da categoria com a coluna da prova recém-publicada em destaque e a variação de posição; faixa inferior com a próxima bateria e o horário. Categoria com mais de uma página alterna as páginas a cada 10 s. Bateria com categorias misturadas alterna as categorias. |
| **Espera** | Sem bateria no dia, evento encerrado, ou "Tela de espera" fixada na mesa | Marca do evento e a próxima atividade do cronograma |

Regras de exibição:

- O placar da bateria é **parcial** até o envio da súmula e diz isso na tela. Nada do que é parcial é gravado em `scores`.
- Ordem parcial na bateria: **For Time**: quem terminou (menor tempo) → mais repetições → quem chegou primeiro à última repetição. **AMRAP**: mais repetições (rounds × round + parcial) → quem chegou primeiro. **Carga máxima**: soma ou maior carga válida, conforme a prova.
- Raia sem súmula aberta aparece como "Aguardando súmula". Raia vazia não aparece.
- Atleta sem bateria no cronograma: as súmulas formam um grupo pela prova e categoria. Depois do primeiro envio nesse grupo, a próxima leva da mesma prova e categoria não ganha Chamada: o geral fica no ar até o primeiro registro dela, que vai ao vivo. É a troca aceita para que uma raia aberta e sem toque não prenda a bateria terminada na Chamada (2026-10-21).
- Sem conexão, o telão mantém a última tela e mostra um aviso discreto com a hora da última atualização. Link revogado mostra "Link do telão desativado. Peça um novo link ao organizador."
- Nome sanitizado (`sanitizeNamePII`) e box; time mostra o nome do time (`teamDisplay.ts`).
- Tela cheia por um toque, cursor some parado, pedido de wake lock para a TV não apagar, e recarga automática quando sai versão nova do app.

A **estrutura do placar da bateria** aprovada é a C, "Líder e pelotão" (D5).

A variação de posição no intervalo compara com o que o leaderboard do site mostrava antes de a bateria publicar. Como prova sem resultado não penaliza (regra do site), quem ainda não competiu aparece no alto antes e pode descer depois.

## 4. O que o gestor vê: aba "Telão" no painel do evento

- **Link do telão:** gerar, copiar e revogar. Gerar de novo revoga o anterior.
- **Modo:** Automático (padrão) · Fixar bateria (escolhe qual) · Fixar geral (escolhe a categoria) · Tela de espera.
- **Bateria:** "Largada" (marca o início do relógio do telão e desfaz um "Encerrar" anterior da mesma bateria) e "Encerrar bateria" (vai para o intervalo mesmo com súmula pendente). Os dois ficam no histórico. "Encerrar" só aparece com a bateria ao vivo, e o servidor recusa encerrar bateria sem nenhum registro nas súmulas (nenhuma com registro e nenhuma enviada): na Chamada a bateria ainda não começou, e a marca a impediria de entrar ao vivo depois. Súmula aberta por engano sai do ar cancelando a súmula.
- **Prévia:** miniatura do que o telão mostra agora e o estado de cada raia.
- Só `manager` dono do evento e `owner`, com `assertManagerOperationalAccess`. Gestor com acesso vencido não opera a mesa; o link já gerado continua só leitura, como o leaderboard público.

## 5. Arquitetura

```
Judge (celular)                      Servidor (Vercel)                               Telão (TV)
──────────────                       ─────────────────                               ──────────
toque ─► fila local ─► POST /api/sheets (append)
                         │ valida e grava scoresheet_events (já existe)
                         └► calcula deriveSheetState e grava scoresheets.live_progress   (novo)

                       GET /api/telao/[token]  ◄──────────────────────────────── a cada 1 s (bateria)
                         │ confere hash do token                                       a cada 5 s (demais)
                         │ lê event_broadcasts + broadcast_heat_states
                         │ resolveBroadcastMode() → chamada | ao vivo | intervalo | espera
                         │ ao vivo: liveHeatRanking(scoresheets.live_progress)
                         │ intervalo: computeDivisionStandings(scores)  ◄ mesma regra do público
                         └► JSON enxuto + versão (304 quando nada mudou)
Gestor (painel) ─► POST /api/telao/control (gerar/revogar link, modo, largada, encerrar)
```

**Atualização por consulta curta (1 s) em vez de realtime.** Implementado assim. Motivos:

1. Não exige infraestrutura nova nem mudança na CSP.
2. A Vercel não segura conexão longa (SSE) de forma barata, e não há worker.
3. Um ou dois telões a 1 requisição/s é carga desprezível, e cada leitura toca poucas linhas (uma por raia) graças ao `live_progress`.
4. Latência fim a fim estimada de 1 a 2,5 s: toque → envio (≈ 0,3–1 s) → próxima consulta (≤ 1 s). Para um telão, isso é ao vivo.

Se um dia houver vários telões e muitos espectadores no celular, o próximo passo é um canal de broadcast do Supabase usado só como **aviso** ("mudou, busque de novo"), sem dados, para que uma mensagem forjada cause no máximo uma leitura a mais. Fica fora desta fase.

## 6. Mudanças de banco (migration nova; aplicar só com autorização)

```sql
-- 1. Configuração do telão por evento (uma linha por evento: D3, uma bateria por vez)
CREATE TABLE IF NOT EXISTS public.event_broadcasts (
  event_id TEXT PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE,                 -- sha-256 do token; o token só aparece ao gerar
  token_created_at TIMESTAMPTZ,
  token_revoked_at TIMESTAMPTZ,
  mode TEXT NOT NULL DEFAULT 'auto' CHECK (mode IN ('auto', 'pin_heat', 'pin_standings', 'standby')),
  pinned_heat_id TEXT,
  pinned_division_id TEXT REFERENCES public.divisions(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Largada e encerramento de cada bateria (heat_id = id do item do cronograma)
CREATE TABLE IF NOT EXISTS public.broadcast_heat_states (
  event_id TEXT NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  heat_id TEXT NOT NULL,
  started_at TIMESTAMPTZ,
  started_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  finished_at TIMESTAMPTZ,
  finished_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  PRIMARY KEY (event_id, heat_id)
);

-- 3. Progresso ao vivo da súmula, calculado no append (nunca vem do aparelho)
ALTER TABLE public.scoresheets ADD COLUMN IF NOT EXISTS live_progress JSONB;
-- { seq, repsDone, repsTarget, roundsCompleted, currentSegmentId, lastRepAt,
--   completedAt, bestLoad, clockStartEstimate }

-- RLS ligada, sem policy, sem acesso para anon/authenticated (mesmo padrão de scoresheets).
```

Idempotente, sem alterar migration anterior e sem mudar dado existente (`live_progress` nasce NULL e é preenchido no próximo `append`; súmula sem a coluna preenchida é calculada uma vez a partir do log). Rollback: `DROP` das duas tabelas e da coluna.

## 7. Segurança e privacidade

- **Token:** 32 bytes aleatórios, guardado só o SHA-256 (comparação em tempo constante). O link é mostrado ao gerar; perdeu, gera outro (o anterior para de funcionar). Ver decisão B.
- **Escopo do token:** só leitura, só aquele evento, só o que a tela mostra. A resposta não leva e-mail, telefone, CPF, id de usuário nem id de inscrição.
- **Cabeçalhos da rota:** `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer` (o token está na URL e não pode vazar por referer), `Cache-Control: no-store`.
- **Limite de requisições:** por token e IP, com o `checkRateLimit` existente (em memória, por instância; suficiente para poucos aparelhos, já registrado como limitação conhecida).
- **Mesa de controle:** sessão `manager`/`owner`, posse do evento e acesso operacional, igual a `/api/admin/persistence`.
- **CSP:** sem mudança (mesma origem).

---

# PARTE III — DELTA

## 8. Arquivos (como implementado)

| Arquivo | Tipo | Conteúdo |
|---------|------|----------|
| `supabase/migrations/20261020120000_live_broadcast.sql` | novo | §6 |
| `src/lib/liveProgress.ts` | novo, puro | Resume `deriveSheetState` / `deriveMaxLoadState` no formato `live_progress` e estima o início do relógio |
| `src/lib/liveHeatRanking.ts` | novo, puro | Ordem parcial da bateria (For Time, AMRAP, carga máxima), empates |
| `src/lib/broadcastMode.ts` | novo, puro | Decide chamada / ao vivo / intervalo / espera pelas súmulas, marcações da mesa e modo fixado |
| `src/lib/leaderboardStandings.ts` | novo, puro | Geral da categoria extraído de `getLeaderboard`; usado pelo `AppContext` e pelo telão |
| `src/lib/broadcastPayload.ts` | novo, tipos | O que o telão recebe da API |
| `src/lib/serverBroadcast.ts` | novo, servidor | Token (gerar, revogar, conferir hash), estado do telão, geral da categoria, ações da mesa |
| `src/lib/serverScoresheets.ts` | alterado | `appendSheetEvents` grava `live_progress` (ignora a coluna se a migration faltar) |
| `src/context/AppContext.tsx` | alterado | `getLeaderboard` decide a elegibilidade e chama `computeDivisionStandings` |
| `src/app/api/telao/[token]/route.ts` | novo | `GET` do estado, com ETag/304 |
| `src/app/api/telao/control/route.ts` | novo | Mesa: ler, gerar e revogar link, modo, largada, encerrar, reabrir |
| `src/app/[locale]/telao/[token]/page.tsx` | novo | Página do telão (o link fica em `/pt-br/telao/<token>`) |
| `src/components/broadcast/BroadcastScreen.tsx` + `Broadcast.module.css` | novo | A tela do telão |
| `src/components/admin/BroadcastPanel.tsx` + aba "Telão" em `src/app/admin/page.tsx` | novo/alterado | Mesa de controle |
| `next.config.ts` | alterado | `no-referrer` e `noindex` na rota do telão |
| `tests/live-broadcast.test.mjs` | novo | Ver §10; testes estáticos apontados para `leaderboardStandings.ts` |

## 9. Stories (epic "Telão ao vivo")

| Story | Escopo | Depende de |
|-------|--------|-----------|
| 1.53 | Migration do telão, token (gerar/revogar) e aba "Telão" só com o link | Migrations da súmula aplicadas |
| 1.54 | `live_progress` no append + `liveHeatRanking` com testes | 1.53 |
| 1.55 | `leaderboardStandings` extraído do `AppContext`, com teste de paridade | — |
| 1.56 | `GET /api/telao/[token]` + `broadcastMode` com testes de transição | 1.54, 1.55 |
| 1.57 | Tela do telão: chamada, bateria ao vivo, intervalo, espera, sem conexão, link desativado; 720p a 4K | 1.56 + desenho aprovado |
| 1.58 | Mesa de controle: modo, largada, encerrar, prévia, histórico | 1.56 |

Fluxo AIOX: @sm cria as stories a partir deste plano → @po valida → @dev implementa → @qa → @devops publica. A migration passa por @data-engineer.

## 10. Testes

- **Puros (`node:test`):** transições do `broadcastMode` (chamada → ao vivo → intervalo → chamada da próxima; modo fixado vence o automático; bateria sem súmula; súmula devolvida no meio do intervalo); `liveHeatRanking` em For Time, AMRAP e carga máxima, com empate e time cap; paridade do `leaderboardStandings` com o resultado atual do `getLeaderboard`.
- **Regressão estática (padrão do repo):** RLS ligada e sem grant para anon nas tabelas novas; token guardado como hash; resposta do telão sem campos de PII; cabeçalhos `noindex`/`no-referrer` na rota.
- **Ensaio manual antes do primeiro evento:** dois celulares com súmula + uma TV, uma bateria completa de For Time e uma de AMRAP, queda de rede no celular e na TV, revogação do link com o telão aberto.

## 11. Riscos

| Risco | Mitigação |
|-------|-----------|
| Judge esquece de enviar a súmula e o telão não vai para o intervalo | "Encerrar bateria" na mesa; a prévia mostra quais raias faltam |
| Relógio do telão diferente do cronômetro oficial do local | Largada marcada na mesa no sinal oficial; a estimativa pelas súmulas é só o plano B |
| Rede ruim na quadra atrasa as repetições | A fila do aparelho já guarda e reenvia; o telão marca "atualizado há X s" na raia atrasada |
| Wi-Fi da TV cai | Mantém a última tela e o aviso de conexão; volta sozinho |
| Nomes longos e baterias grandes (16+ raias) | Truncamento com o sobrenome preservado; a estrutura escolhida precisa caber 16 raias (a maquete testa 8) |
| Divergência entre o geral do telão e o do site | Uma só função (`leaderboardStandings.ts`) e teste de paridade |

## 12. Decisões

Todas resolvidas em 2026-10-20 (D5 a D9 no sumário). Pendente só a aplicação da migration do telão no Supabase, que depende da autorização e do acesso do usuário.

## 13. Fora do escopo desta fase

- Fitness Race e Qualifier online.
- Várias quadras em paralelo (D3).
- Áudio, vinhetas, patrocinadores rotativos e câmera.
- Placar ao vivo no celular do público (a mesma API serve no futuro, com o aviso por broadcast de §5).
