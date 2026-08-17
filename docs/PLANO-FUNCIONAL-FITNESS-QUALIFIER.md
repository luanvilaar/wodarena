# Plano de Implementação — Functional Fitness Qualifier

**Status:** Rascunho v2 — auditoria técnica concluída com decisões de produto pendentes
**Escopo desta entrega:** planejamento apenas. Nenhuma alteração de código antes da aprovação.

---

## 1. Objetivo

Criar uma terceira modalidade de evento no WODArena — `functional_fitness_qualifier` — destinada a classificatórias 100% online, reaproveitando ao máximo a infraestrutura de Functional Fitness já existente (categorias, provas, inscrições, checkout, leaderboard, contestação) e acrescentando:

1. **Janela de submissão por prova** (data/hora limite definida no cadastro da prova);
2. **Submissão de resultado pelo atleta** (score + link de vídeo no YouTube);
3. **Perfil `judge`** criado pelo gestor, com dashboard próprio de revisão;
4. **Decisão do judge** (validado / penalidade 15% / rejeitado / ajuste manual) com histórico auditável;
5. **Cronograma reposicionado** como mural de datas e prazos (sem baterias).

---

## 2. Premissas e decisões de produto

O pedido deixou pontos em aberto que impedem implementação determinística. As decisões abaixo foram tomadas para permitir o planejamento; **cada uma marcada com 🔸 precisa de confirmação** antes da implementação.

| # | Tema | Decisão adotada | Confirmar? |
|---|---|---|---|
| P1 | Janela de submissão | Cada prova tem `submission_opens_at` (opcional) e `submission_closes_at` (obrigatório). Fora da janela → servidor rejeita com 409. | 🔸 abertura opcional é suficiente? |
| P2 | Fuso da janela | Datas interpretadas em `America/Fortaleza` (mesmo fuso já usado em `managerAccess.ts`), armazenadas como `TIMESTAMPTZ`. A UI exibe o fuso explicitamente. | 🔸 |
| P3 | Reenvio | O atleta pode substituir sua submissão **enquanto a janela estiver aberta e o status for `pending_review`**. Depois de julgada, só via contestação. Cada versão fica no histórico. | 🔸 |
| P4 | Penalidade 15% | Aplicada sobre o valor submetido: provas de tempo (`fortime`) → `valor × 1,15` (pior); demais tipos → `valor × 0,85` (pior). Arredondamento definido em §6.2. | 🔸 |
| P5 | Rejeição | Score 0 na prova. Em ranking Low-Point isso equivale à **última colocação** (mesmos pontos de quem não submeteu: `nº de atletas da divisão + 1`). | 🔸 rejeitado e ausente devem empatar? |
| P6 | Time cap | Penalidade **não** é truncada pelo time cap — o valor penalizado pode ultrapassá-lo. | 🔸 |
| P7 | Visibilidade do vídeo | Link do vídeo é **privado**: visível para o próprio atleta, judges do evento, gestor e owner. Não entra em nenhum payload público. | 🔸 |
| P8 | Quem julga contestação | Continua sendo **gestor/owner** (fluxo atual). Judge não decide contestação. Deferir contestação reabre a submissão para nova revisão. | 🔸 |
| P9 | Judge é do gestor | Judge é criado pelo gestor, vinculado a ele (`parent_manager_id`) e só enxerga eventos aos quais foi explicitamente atribuído. | — |
| P10 | Validade do gestor | Se o gestor está `expired`, seus judges também ficam bloqueados de operar (herança de `assertManagerOperationalAccess`). | — |
| P11 | Vídeo | Apenas YouTube (`youtube.com/watch`, `youtu.be`, `youtube.com/shorts`, `youtube.com/live`). Outros hosts rejeitados. | 🔸 aceitar Vimeo/Drive? |
| P12 | Tiebreak | Fora de escopo nesta entrega. O campo `workouts.tie_breaker` continua apenas descritivo. | 🔸 |

---

## 3. Matriz Reaproveitar / Adaptar / Criar

### 3.1 Reaproveitado sem alteração

| Área | Artefatos |
|---|---|
| Autenticação e sessão | `src/lib/serverSecurity.ts` (scrypt, HMAC, `requireSession`, `checkRateLimit`) |
| Checkout / pagamento | `/api/checkout/*`, `src/lib/serverCheckout.ts`, `src/lib/mercadopagoServer.ts`, webhook, split marketplace |
| Inscrição | `/api/registrations/start`, `RegisterModal.tsx`, cupons, service fee |
| Categorias | tabela `divisions`, `reorderDivisions`, `divisionOrder.ts` |
| Leaderboard | tabela `scores`, `leaderboard_entries` + trigger, `Leaderboard.tsx`, `MobileLeaderboardCard.tsx` — o branch `!== 'fitness_racing'` já cobre o qualifier |
| Ranking Low-Point | regra de pontuação em `AppContext.recalculateWorkoutScores` (será **extraída**, não reescrita — §6.3) |
| E-mails | `src/lib/resend.ts` (padrão de envio + `sendContestationStatusEmail`) |
| Mídia do evento | `/api/admin/media/upload`, `mediaStorage.ts` (banner/logo) |

### 3.2 Adaptado

| Arquivo | Mudança |
|---|---|
| `src/types/index.ts:151` | `eventType` ganha `'functional_fitness_qualifier'` |
| `src/types/index.ts:12` | `User.role` ganha `'judge'` |
| `src/types/index.ts:57-67` | `Workout` ganha `submissionOpensAt` / `submissionClosesAt` |
| `src/types/index.ts:69` | `EventScheduleItemKind` ganha `'deadline'` |
| `src/context/AppContext.tsx:89,1033` | assinatura de `addEvent` aceita o novo tipo |
| `src/context/AppContext.tsx:694` | mapper de `event_type` (default continua `functional_fitness`) |
| `src/context/AppContext.tsx:254` | `mapUserFromDb` — role `judge` |
| `src/app/api/admin/persistence/route.ts:61` | `WORKOUT_UPDATABLE_FIELDS` + `submission_opens_at`, `submission_closes_at`; novos `case` para judges (§7.2) |
| `src/app/api/app/bootstrap/route.ts:57` | `requireSession` aceita `'judge'` + branch de payload escopado (**crítico**, ver §10.1) |
| `src/app/api/contestations/route.ts:135` | guard passa a aceitar qualifier; `heatId`/`lane` opcionais quando qualifier; novo campo `submissionId` |
| `src/app/admin/page.tsx:2764` | `contestableRegistrations` passa a incluir qualifier |
| `src/app/admin/page.tsx:8772,8793` | aba "Contestações" liberada para qualifier |
| `src/app/admin/page.tsx:539-540,3710,8862` | seletor de tipo de evento com a 3ª opção |
| `src/app/admin/page.tsx:3776` | aba de categorias — qualifier segue o layout de functional fitness |
| `src/app/admin/page.tsx:5026` (`renderAbaSchedule`) | qualifier: esconde geração de baterias, mostra prazos + itens informativos |
| `src/app/admin/page.tsx:107-109` | `isLoggedIn` precisa reconhecer `judge` (senão judge logado vê tela de login) |
| `src/app/event/[id]/page.tsx:237` | `getScheduleKindLabel` ganha `'deadline'` |
| `src/lib/contestations.ts` | `mapContestationFromDb` mapeia `submission_id`; `lane` opcional |
| `next.config.ts:40` | `frame-src` ganha `https://www.youtube-nocookie.com` (só se embutir player — §9.3) |

### 3.3 Novo

| Camada | Artefato |
|---|---|
| DB | tabelas `score_submissions`, `score_submission_reviews`, `event_judges`; colunas em `workouts`, `users`, `scores`; RPC `qualifier_apply_review` |
| Lib pura | `src/lib/scoring.ts` (ranking Low-Point extraído + penalidade + formatação) |
| Lib pura | `src/lib/videoProof.ts` (validação/normalização de URL do YouTube) |
| Lib pura | `src/lib/submissionWindow.ts` (estado da janela: `not_open` / `open` / `closed`) |
| Lib server | `src/lib/serverJudgeAccess.ts` (autorização de judge por evento + herança de validade do gestor) |
| API | `POST/PATCH /api/submissions`, `GET /api/submissions` |
| API | `GET /api/judge/queue`, `POST /api/judge/reviews` |
| API | `POST/DELETE` de judges dentro de `/api/admin/persistence` |
| UI | `src/app/judge/page.tsx` (dashboard do judge) |
| UI | seção "Envio de Resultados" na Área do Atleta (`admin/page.tsx`) |
| UI | aba "Submissões" no painel do gestor |
| Testes | `tests/qualifier-submissions.test.mjs`, `tests/qualifier-judge-access.test.mjs`, `tests/scoring-parity.test.mjs` |

---

## 4. Modelo de dados

### 4.1 Alterações em tabelas existentes

```sql
-- migration: 2026XXXX_qualifier_event_type.sql

-- 1. Novo tipo de evento (o CHECK atual está em 20260603001000_fitness_racing.sql:2)
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_event_type_check;
ALTER TABLE events ADD CONSTRAINT events_event_type_check
  CHECK (event_type IN ('functional_fitness', 'fitness_racing', 'functional_fitness_qualifier'));

-- 2. Janela de submissão por prova
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS submission_opens_at  TIMESTAMPTZ;
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS submission_closes_at TIMESTAMPTZ;
ALTER TABLE workouts ADD CONSTRAINT workouts_submission_window_order
  CHECK (submission_opens_at IS NULL
         OR submission_closes_at IS NULL
         OR submission_opens_at < submission_closes_at);

-- 3. Papel judge (o CHECK atual está em 20260606110000_athlete_area_registrations.sql:4)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('owner', 'manager', 'athlete', 'judge'));

ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_manager_id TEXT REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_users_parent_manager ON users(parent_manager_id);

-- 4. Procedência do score (para o leaderboard distinguir validado/penalizado/rejeitado)
ALTER TABLE scores ADD COLUMN IF NOT EXISTS result_status TEXT
  CHECK (result_status IN ('validated', 'penalized', 'rejected', 'manual'));
ALTER TABLE scores ADD COLUMN IF NOT EXISTS submission_id TEXT;
```

> `scores.result_status` é NULL para todo score legado/manual — nenhum comportamento existente muda.

### 4.2 Novas tabelas

```sql
-- Vínculo judge ↔ evento (escopo de acesso)
CREATE TABLE IF NOT EXISTS event_judges (
  event_id      TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  judge_user_id TEXT NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, judge_user_id)
);
CREATE INDEX IF NOT EXISTS idx_event_judges_judge ON event_judges(judge_user_id);

-- Submissão de resultado (1 ativa por inscrição+prova)
CREATE TABLE IF NOT EXISTS score_submissions (
  id                TEXT PRIMARY KEY,
  event_id          TEXT NOT NULL REFERENCES events(id)        ON DELETE CASCADE,
  workout_id        TEXT NOT NULL REFERENCES workouts(id)      ON DELETE CASCADE,
  division_id       TEXT NOT NULL REFERENCES divisions(id)     ON DELETE CASCADE,
  registration_id   TEXT NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  athlete_id        TEXT REFERENCES athletes(id) ON DELETE SET NULL,

  submitted_result  TEXT    NOT NULL,   -- texto informado pelo atleta ("08:14", "125")
  submitted_value   NUMERIC NOT NULL,   -- valor normalizado no servidor
  video_url         TEXT    NOT NULL,   -- URL canônica normalizada
  video_id          TEXT    NOT NULL,   -- id extraído do YouTube
  athlete_note      TEXT,

  status            TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review', 'validated', 'penalized', 'rejected')),
  final_result      TEXT,               -- após decisão do judge
  final_value       NUMERIC,
  penalty_percent   NUMERIC,            -- 15 quando penalizado

  submitted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at       TIMESTAMPTZ,
  reviewed_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  version           INTEGER NOT NULL DEFAULT 1,   -- concorrência otimista
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (registration_id, workout_id)
);
CREATE INDEX IF NOT EXISTS idx_submissions_event_status ON score_submissions(event_id, status);
CREATE INDEX IF NOT EXISTS idx_submissions_workout      ON score_submissions(workout_id);
CREATE INDEX IF NOT EXISTS idx_submissions_user         ON score_submissions(user_id);

-- Histórico imutável de análise
CREATE TABLE IF NOT EXISTS score_submission_reviews (
  id               TEXT PRIMARY KEY,
  submission_id    TEXT NOT NULL REFERENCES score_submissions(id) ON DELETE CASCADE,
  event_id         TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  judge_user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  judge_name       TEXT NOT NULL,   -- snapshot: sobrevive à exclusão do judge
  judge_role       TEXT NOT NULL CHECK (judge_role IN ('judge', 'manager', 'owner')),
  decision         TEXT NOT NULL
    CHECK (decision IN ('validated', 'penalized', 'rejected', 'manual_adjustment', 'reopened')),
  penalty_percent  NUMERIC,
  previous_result  TEXT,
  previous_value   NUMERIC,
  applied_result   TEXT,
  applied_value    NUMERIC,
  justification    TEXT,            -- obrigatório em penalized/rejected/manual_adjustment
  reviewed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_submission_reviews_submission ON score_submission_reviews(submission_id);
CREATE INDEX IF NOT EXISTS idx_submission_reviews_event      ON score_submission_reviews(event_id);
```

### 4.3 Contestação

```sql
ALTER TABLE contestations ALTER COLUMN lane DROP NOT NULL;
ALTER TABLE contestations ADD COLUMN IF NOT EXISTS submission_id TEXT
  REFERENCES score_submissions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_contestations_submission ON contestations(submission_id);
```

> `heat_id` já é nullable. `lane` passa a ser nullable; a API continua exigindo `lane` para eventos `functional_fitness` presencial.

### 4.4 RLS

Todas as três tabelas novas seguem o baseline de `20260621153000_api_surface_hardening.sql`: `ENABLE ROW LEVEL SECURITY` **sem nenhuma policy** → acesso exclusivo via `service_role` nas rotas server-side. Nenhuma leitura anônima.

```sql
ALTER TABLE score_submissions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE score_submission_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_judges             ENABLE ROW LEVEL SECURITY;
```

---

## 5. Modelo de autorização

### 5.1 Matriz de permissões

| Ação | athlete (dono) | judge (atribuído) | manager (dono do evento) | owner |
|---|---|---|---|---|
| Criar/editar submissão (janela aberta, status `pending_review`) | ✅ | ❌ | ❌ | ❌ |
| Ver própria submissão + histórico | ✅ | — | — | — |
| Ver fila de submissões do evento | ❌ | ✅ | ✅ | ✅ |
| Aplicar decisão (validar/penalizar/rejeitar/ajustar) | ❌ | ✅ | ✅ | ✅ |
| Criar/remover judge | ❌ | ❌ | ✅ (dos próprios eventos) | ✅ |
| Abrir contestação | ✅ | ❌ | ❌ | ❌ |
| Julgar contestação | ❌ | ❌ | ✅ | ✅ |
| Editar prova / janela de submissão | ❌ | ❌ | ✅ | ✅ |
| Ver dados de pagamento/inscrição | próprios | ❌ | ✅ | ✅ |

### 5.2 Regras de autorização do judge (`src/lib/serverJudgeAccess.ts`)

```
assertJudgeEventAccess(supabaseAdmin, actor, eventId):
  1. actor.role === 'owner'                        → libera
  2. actor.role === 'manager'                      → exige events.organizer_id === actor.id
                                                     + assertManagerOperationalAccess(actor)
  3. actor.role === 'judge'                        → exige linha em event_judges(event_id, actor.id)
                                                     + evento é 'functional_fitness_qualifier'
                                                     + assertManagerOperationalAccess(organizador do evento)  [P10]
  4. qualquer outro                                → 403
```

### 5.3 Conflito de interesse

- **Na atribuição:** bloquear vincular como judge um usuário que possua inscrição não cancelada no mesmo evento (busca por `registrations.user_id` **e** por `athlete_email`).
- **Na revisão:** rejeitar (409) se `submission.user_id === actor.id`. Dupla checagem, porque a inscrição pode nascer depois da atribuição.

### 5.4 Impacto no que já existe

O papel `judge` **não** é adicionado a nenhuma rota existente além do bootstrap privado. Verificação explícita necessária em todas as rotas que hoje usam `requireSession` com lista de papéis:

| Rota | Papéis hoje | Ação |
|---|---|---|
| `/api/app/bootstrap` | owner, manager, athlete | **adicionar judge** + branch escopado |
| `/api/admin/persistence` | manager, owner | manter (judge não persiste nada por aqui) |
| `/api/contestations` GET | athlete, manager, owner | manter (judge não vê contestações) |
| `/api/contestations/[id]` PATCH | manager, owner | manter |
| `/api/admin/create-user` | owner | manter (criação de judge é do gestor, vai em outra rota) |
| `/api/athlete/profile` | athlete | manter |
| `/api/admin/mercadopago`, `/api/owner/*` | manager/owner | manter |

---

## 6. Regras de negócio

### 6.1 Janela de submissão

Estado calculado em `src/lib/submissionWindow.ts` (função pura, testável, usada no cliente para UI e no servidor para enforcement):

```
getSubmissionWindowState(workout, now):
  closes = workout.submissionClosesAt
  opens  = workout.submissionOpensAt
  se !closes                 → 'unconfigured'   (prova não aceita submissão)
  se opens && now < opens    → 'not_open'
  se now > closes            → 'closed'
  senão                      → 'open'
```

**Enforcement é sempre server-side.** A UI apenas espelha. Rejeição fora da janela: HTTP 409 com mensagem específica (`not_open` vs `closed`).

Pré-condições adicionais para submeter:
- evento é `functional_fitness_qualifier`;
- `registration.payment_status === 'payment_approved'`;
- `registration.user_id === actor.id`;
- prova pertence ao evento e (se `workouts.division_id` estiver preenchido) à divisão da inscrição;
- gestor do evento não está `expired`.

### 6.2 Cálculo de penalidade e formatação (`src/lib/scoring.ts`)

Direção do tipo de prova:

| Tipo | Direção | Penalidade 15% |
|---|---|---|
| `fortime` | menor é melhor | `valor × 1,15` → `Math.ceil` (segundos inteiros) |
| `amrap`, `reps`, `points` | maior é melhor | `valor × 0,85` → `Math.floor` (inteiros) |
| `maxweight`, `distance` | maior é melhor | `valor × 0,85` → arredondado a 2 casas |

Formatação do `result` textual (`formatScoreResult(type, value)`):
- `fortime` → `mm:ss` (ou `hh:mm:ss` acima de 3600s);
- `maxweight` → `N kg`; `distance` → `N m`; `reps`/`amrap`/`points` → `N`.

**O texto original submetido nunca é perdido:** fica em `score_submissions.submitted_result`. `final_result` guarda o texto recalculado.

Parsing do valor submetido (`parseScoreInput(type, text)`): `fortime` aceita `mm:ss` e `hh:mm:ss`; demais aceitam inteiro/decimal. Rejeita negativos e não numéricos.

### 6.3 Ranking — fonte única de verdade

**Problema atual:** o ranking Low-Point roda **no cliente** (`AppContext.recalculateWorkoutScores`, `src/context/AppContext.tsx:941`) e é persistido via `adminPersist('upsertScores')`. Isso é read-modify-write sem lock — dois gestores lançando scores simultaneamente já podem corromper ranks hoje. Com múltiplos judges julgando em paralelo o problema piora muito.

**Proposta (faseada):**

- **Fase 1 (qualifier):** extrair a lógica pura para `src/lib/scoring.ts` (`rankWorkoutScores(type, scores, divisionAthleteCount)`), consumida pelo `AppContext` (comportamento idêntico ao atual) **e** pela rota de revisão do judge. A gravação do judge acontece dentro de uma RPC Postgres `qualifier_apply_review(...)` que:
  1. adquire `pg_advisory_xact_lock(hashtext(workout_id || division_id))`;
  2. valida `version` da submissão (concorrência otimista — 409 se divergir);
  3. grava `score_submissions` + `score_submission_reviews`;
  4. faz upsert do score do atleta;
  5. recalcula rank/points de **toda** a divisão+prova em SQL (window function) na mesma transação.

- **Fase 2 (opcional, fora deste escopo):** migrar o `upsertScores` legado para a mesma RPC, eliminando o ranking no cliente.

**Risco assumido na Fase 1:** duas implementações do mesmo ranking (TS e SQL). Mitigação obrigatória: `tests/scoring-parity.test.mjs` com fixtures compartilhadas (empates, ausentes, rejeitados, divisão de 1 atleta, divisão vazia) verificando saída idêntica. Sem esse teste, a Fase 1 não é aceitável.

### 6.4 Semântica das decisões

| Decisão | `submissions.status` | Score gravado | Justificativa |
|---|---|---|---|
| Validado 100% | `validated` | `value = submitted_value`, `result_status='validated'` | opcional |
| Penalidade 15% | `penalized` | valor penalizado (§6.2), `penalty_percent=15`, `result_status='penalized'` | **obrigatória** |
| Rejeitado | `rejected` | `value=0`, `result='0'`, `result_status='rejected'` | **obrigatória** |
| Ajuste manual | `validated` | valor informado pelo judge, `result_status='manual'` | **obrigatória** |

**Cuidado crítico com a rejeição:** em provas `fortime` o menor valor vence — gravar `value = 0` ingenuamente colocaria o rejeitado em **primeiro lugar**. Por isso `rankWorkoutScores` trata `result_status = 'rejected'` exatamente como "sem resultado": `rank = 0`, `points = nº de atletas da divisão + 1`. O mesmo vale para quem não submeteu. Essa é a decisão P5.

### 6.5 Contestação no qualifier

- Alvo passa a ser a **submissão** (`submission_id`), não bateria/raia.
- Créditos: mantém 2 por inscrição, `calculateContestationCredits` reaproveitado sem mudança.
- Deferimento (`approved`) pelo gestor **opcionalmente** reabre a submissão: grava review com `decision='reopened'`, volta `status='pending_review'` e **remove o score correspondente** (recalculando a divisão). Reabrir é uma ação explícita do gestor, não automática ao deferir.
- E-mail de status reaproveita `sendContestationStatusEmail`; o texto precisa de variante sem "Bateria/Raia".

### 6.6 Cronograma do qualifier

- Aba mantida. Geração de baterias (`renderAbaSchedule`, `admin/page.tsx:5026`) fica **oculta** quando o evento é qualifier.
- Exibe duas seções:
  1. **Prazos das provas** — derivada automaticamente de `workouts.submission_closes_at` (read-only, sempre em sincronia);
  2. **Datas importantes** — itens manuais em `events.event_schedule` com os kinds existentes + novo kind `'deadline'`.
- `event_schedule` é JSONB sem constraint → o novo kind não exige migration; exige apenas rótulo novo em `getScheduleKindLabel` (`event/[id]/page.tsx:237`) e no admin.

---

## 7. Superfície de API

### 7.1 Atleta

**`POST /api/submissions`** — cria ou substitui submissão
`requireSession(['athlete'])` · rate limit `submissions:{userId}` 20/min

```jsonc
// request
{ "registrationId": "...", "workoutId": "...", "result": "08:14", "videoUrl": "https://youtu.be/...", "note": "" }
// 200
{ "success": true, "submission": { ... } }
// 409 fora da janela | 403 inscrição de outro usuário | 400 URL/valor inválido
```

Validações server-side, nessa ordem: sessão → inscrição pertence ao ator → pagamento aprovado → evento é qualifier → gestor não expirado → prova do evento → janela aberta → submissão inexistente **ou** `pending_review` → URL YouTube válida → valor parseável.

**`GET /api/submissions?event_id=`** — lista submissões do próprio atleta com histórico de reviews.

### 7.2 Gestor (dentro de `/api/admin/persistence`, seguindo o padrão de dispatcher por `action`)

| Action | Efeito |
|---|---|
| `createJudge` | cria `users(role='judge', parent_manager_id)` + `users_secrets` + vínculo em `event_judges`. Rollback do perfil se o segredo falhar (mesmo padrão de `create-user/route.ts:71`) |
| `assignJudgeToEvent` | insere `event_judges`; valida ownership do evento e do judge |
| `removeJudgeFromEvent` | remove `event_judges` |
| `deleteJudge` | remove usuário; reviews preservam `judge_name` |
| `updateWorkout` | ganha `submission_opens_at` / `submission_closes_at` na allowlist |

> Reaproveita `ensureEventOwner`, `pickAllowedFields` e `assertManagerOperationalAccess` já existentes na rota.

### 7.3 Judge

**`GET /api/judge/queue?event_id=&status=`**
`requireSession(['judge','manager','owner'])` + `assertJudgeEventAccess`
Retorna submissões com: atleta (nome, box, categoria), prova, valor submetido, link do vídeo, status, histórico. **Nunca** retorna e-mail, telefone, CPF ou dados de pagamento.

**`POST /api/judge/reviews`**
```jsonc
{
  "submissionId": "...",
  "version": 3,
  "decision": "penalized",          // validated | penalized | rejected | manual_adjustment
  "manualResult": "09:20",          // só em manual_adjustment
  "justification": "Rep 7 sem lockout"
}
```
Chama a RPC `qualifier_apply_review`. Erros: `409 stale_version`, `409 self_review`, `403 not_assigned`, `400 justification_required`.

---

## 8. Frontend

### 8.1 Área do Atleta (`src/app/admin/page.tsx`, branch `isAthleteLoggedIn`)

Nova seção lateral **"Envio de Resultados"** (`activeAthleteSection` ganha `'submissions'`, hoje em `admin/page.tsx:473`), visível apenas se o atleta tiver ao menos uma inscrição aprovada em evento qualifier. Cada prova vira um card com:
- estado da janela (`abre em` / `aberto até` / `encerrado`) com contagem regressiva;
- formulário: resultado (máscara conforme `workout.type`) + link do YouTube + observação;
- status da revisão: `Aguardando análise` / `Validado` / `Penalizado 15%` / `Rejeitado`, com justificativa e nome do judge;
- botão "Contestar" quando já houver decisão e ainda houver crédito.

### 8.2 Dashboard do Judge (`src/app/judge/page.tsx` — novo)

Página enxuta e separada — o `admin/page.tsx` já tem 10.172 linhas e não deve crescer mais.
- Seletor de evento (apenas eventos atribuídos);
- Filtros: prova, categoria, status (padrão: pendentes);
- Lista com dados mínimos do atleta;
- Painel de revisão: player embutido (ou link externo — §9.3) + botões das 4 decisões + campo de justificativa (obrigatório em 3 delas) + histórico da submissão.

**Roteamento:** o login continua em `/admin`. Após autenticar como `judge`, redirecionar para `/judge`. `admin/page.tsx:109` (`isLoggedIn`) precisa reconhecer o papel, senão o judge logado fica preso na tela de login.

### 8.3 Painel do Gestor

- Aba **"Provas (WODs)"**: campos de janela de submissão quando qualifier.
- Nova aba **"Submissões"**: mesma fila do judge + gestão de judges (criar, atribuir, remover) + poder de revisar/sobrescrever.
- Aba **"Cronograma"**: comportamento de §6.6.
- Aba **"Contestações"**: liberada para qualifier.

---

## 9. Segurança

### 9.1 Superfície pública
`buildPublicBootstrapPayload` e `buildPublicEventBootstrapPayload` (`src/lib/bootstrapPayload.ts`) **não** são alterados — submissões, vídeos e judges nunca aparecem em payload anônimo. Se algum dia o vídeo for público, passa a exigir decisão explícita (P7) e sanitização própria.

### 9.2 Validação de URL (`src/lib/videoProof.ts`)
- Parse com `new URL()`; rejeita se falhar.
- Protocolo obrigatoriamente `https:` (bloqueia `javascript:`, `data:`, `file:`).
- Host em allowlist estrita: `youtube.com`, `www.youtube.com`, `m.youtube.com`, `youtu.be`, `www.youtube-nocookie.com`. Comparação por igualdade exata do hostname — **nunca** `includes()` ou `endsWith()` (evita `youtube.com.evil.tld`).
- Extrai `videoId` (`[A-Za-z0-9_-]{11}`) e **armazena a URL canônica reconstruída**, não a string crua do usuário — elimina query params maliciosos e open redirect.
- Nenhuma requisição server-side à URL (sem SSRF).

### 9.3 CSP
Duas opções:
- **(a) Link externo** (`target="_blank" rel="noopener noreferrer"`): zero mudança em `next.config.ts`. Pior UX para o judge.
- **(b) Player embutido** via `https://www.youtube-nocookie.com/embed/{videoId}`: exige adicionar esse host ao `frame-src` (`next.config.ts:40`) e atualizar `docs/security/security-headers.md` + `tests/security-hardening.test.mjs`.

**Recomendação:** (b), pelo ganho real de produtividade do judge, com `sandbox` no iframe e `videoId` já validado por regex.

### 9.4 Outros controles
- **Rate limit:** submissões 20/min por usuário; reviews 60/min por judge. ⚠️ `checkRateLimit` é **em memória** (`serverSecurity.ts:257`) — não é distribuído e reinicia com o processo. Limitação pré-existente, aqui apenas herdada.
- **Mass assignment:** todo update passa por `pickAllowedFields`; `event_id`/`division_id`/`user_id` das submissões são sempre derivados do servidor a partir da inscrição, nunca do payload (mesmo princípio já documentado em `persistence/route.ts:47-49`).
- **Vazamento de erro:** usar `safeErrorMessage` em todas as rotas novas.
- **PII:** a fila do judge expõe nome e box do atleta (necessário para conferir o vídeo) e nada além disso.
- **Auditoria:** `score_submission_reviews` é append-only por contrato de aplicação — nenhuma rota faz `UPDATE`/`DELETE` nela.
- **Senha do judge:** criada pelo gestor via `hashPassword` (scrypt). Reaproveitar o fluxo de `/api/auth/request-password-reset` para o judge trocar depois. 🔸 confirmar se o judge deve receber e-mail de boas-vindas com credenciais.

---

## 10. Impactos no sistema atual (checklist de regressão)

### 10.1 🔴 Crítico — bootstrap privado quebra para o judge

`AppContext.fetchBootstrapPayload` (`src/context/AppContext.tsx:384`) só trata **401**, caindo para o endpoint público. Um **403** propaga como exceção → `bootstrapStatus = 'error'` → tela de erro no app inteiro.

Como `/api/app/bootstrap` hoje aceita `['owner','manager','athlete']` (`route.ts:57`), um judge logado receberia 403 e **quebraria a aplicação inteira**, não só o dashboard dele.

**Obrigatório:** adicionar `'judge'` à lista e criar um branch que retorne apenas eventos atribuídos (via `event_judges`) + suas divisões/provas, com `registrations`, `coupons`, `users` e `mercadopagoAccounts` **vazios**.

### 10.2 🟠 Comparações `=== 'functional_fitness'` que excluem o qualifier

Todo `eventType === 'fitness_racing' ? A : B` já trata o qualifier corretamente (cai em B). O perigo está nas comparações **de igualdade explícita com `'functional_fitness'`**:

| Local | Efeito se não corrigido |
|---|---|
| `src/app/api/contestations/route.ts:135` | contestação bloqueada no qualifier |
| `src/app/admin/page.tsx:2764` | inscrição do qualifier não aparece como contestável |
| `src/app/admin/page.tsx:8772` e `8793` | aba "Contestações" some no qualifier |
| `src/app/admin/page.tsx:3776` | render da aba de categorias |

### 10.3 🟡 Tipos de união que precisam do terceiro valor
`src/types/index.ts:151`; `AppContext.tsx:89,1033`; `admin/page.tsx:539,540,3710,8862`. Sem isso o `npm run typecheck` falha (efeito colateral positivo: o compilador aponta os pontos esquecidos).

### 10.4 🟡 Testes estáticos existentes que vão quebrar
Os testes leem os fontes e fazem `assert.match` (ver `CLAUDE.md` § Testing):
- `tests/functional-fitness-contestations.test.mjs` — afirma o guard `!== 'functional_fitness'`;
- `tests/security-hardening.test.mjs` — afirma o conteúdo da CSP (se optarmos por 9.3(b));
- `tests/api-surface-hardening.test.mjs` — afirma RLS por tabela; as três tabelas novas devem ser incluídas;
- `tests/persistence-isolation.test.mjs` — afirma que toda action valida ownership; as novas actions de judge precisam entrar.

### 10.5 🟢 Sem impacto esperado (validar mesmo assim)
Checkout, split Mercado Pago, webhook, cupons, service fee, upload de mídia, evento em destaque na home, perfil do atleta, reset de senha. Nenhum deles ramifica por `event_type`.

### 10.6 ⚠️ Lacunas pré-existentes que este trabalho encosta

Não são regressões novas, mas o auditor deve saber que existem:
1. **Ranking client-side sem lock** (§6.3) — race já presente hoje.
2. **Relocação de categoria** (`admin_update_registration_details`) move o atleta de divisão, mas os `scores` (chave `athlete_id + workout_id`) não são recalculados nas duas divisões afetadas. No qualifier, isso deixa ranking inconsistente. Precisa de tratamento explícito ou de bloqueio de relocação após haver submissão julgada.
3. **`leaderboard_entries`** é sincronizada por trigger em `AFTER UPDATE` de `registrations` (`20260610100000_leaderboard_entries.sql:111`). Inscrição criada já aprovada (cupom 100%) não gera entrada — o `getLeaderboard` tem fallback, mas isso deve ser verificado no qualifier.
4. **Cancelamento pós-submissão:** cancelar a inscrição remove a entrada do leaderboard, mas o registro em `scores` permanece. Definir se a submissão deve ser invalidada junto.

---

## 11. Migrations

Ordem sugerida (timestamps a definir no momento da implementação):

| # | Arquivo | Conteúdo |
|---|---|---|
| 1 | `..._qualifier_event_type.sql` | CHECK de `event_type`, janela em `workouts`, role `judge`, `parent_manager_id`, colunas em `scores` |
| 2 | `..._qualifier_judges.sql` | `event_judges` + índices + RLS |
| 3 | `..._qualifier_submissions.sql` | `score_submissions`, `score_submission_reviews`, triggers de `updated_at`, RLS |
| 4 | `..._qualifier_contestations.sql` | `lane` nullable, `submission_id` |
| 5 | `..._qualifier_apply_review_rpc.sql` | RPC transacional com advisory lock + recálculo de ranking |

Todas idempotentes (`IF NOT EXISTS` / `DROP ... IF EXISTS`), sem editar migrations já aplicadas.

---

## 12. Testes

| Arquivo | Cobertura |
|---|---|
| `tests/scoring-parity.test.mjs` | **bloqueante** — paridade entre ranking TS e SQL: empates, ausentes, rejeitados, divisão vazia, divisão de 1 |
| `tests/qualifier-scoring.test.mjs` | penalidade por tipo de prova, arredondamento, `parseScoreInput`, `formatScoreResult`, rejeitado ≠ 1º lugar em `fortime` |
| `tests/qualifier-video-proof.test.mjs` | allowlist de host (incl. `youtube.com.evil.tld`), `javascript:`, extração de `videoId`, canonicalização |
| `tests/qualifier-submission-window.test.mjs` | `not_open`/`open`/`closed`/`unconfigured`, fuso America/Fortaleza, limites exatos |
| `tests/qualifier-judge-access.test.mjs` | judge sem vínculo → 403; judge de outro evento → 403; auto-revisão → 409; gestor expirado → 403 |
| `tests/qualifier-submissions.test.mjs` | regressão estática: RLS habilitado, judge no bootstrap privado, ausência de submissões no payload público, ownership nas novas actions |
| Atualizações | `functional-fitness-contestations`, `security-hardening`, `api-surface-hardening`, `persistence-isolation` |

Gate de qualidade: `npm run lint`, `npm run typecheck`, `npm test` verdes antes de qualquer fase ser considerada concluída.

---

## 13. Fases de entrega

| Fase | Entrega | Depende de |
|---|---|---|
| **F0** | Migrations 1–4 + tipos + `scoring.ts`/`videoProof.ts`/`submissionWindow.ts` + testes puros | — |
| **F1** | Bootstrap privado com judge + `serverJudgeAccess.ts` + actions de judge no persistence + UI de gestão de judges | F0 |
| **F2** | Janela de submissão no cadastro de prova + cronograma do qualifier | F0 |
| **F3** | `/api/submissions` + seção "Envio de Resultados" na Área do Atleta | F0, F2 |
| **F4** | RPC `qualifier_apply_review` + `/api/judge/*` + `/judge` + aba "Submissões" do gestor | F1, F3 |
| **F5** | Contestação ligada à submissão + e-mails | F4 |
| **F6** | Regressão completa + atualização dos testes estáticos + docs | todas |

F1 e F2/F3 podem correr em paralelo depois de F0.

---

## 14. Riscos

| Risco | Sev. | Mitigação |
|---|---|---|
| Bootstrap privado devolvendo 403 para judge derruba o app inteiro | 🔴 Alta | §10.1 — judge no bootstrap é pré-requisito de F1, com teste dedicado |
| Divergência entre ranking TS e SQL | 🔴 Alta | `scoring-parity.test.mjs` bloqueante; Fase 2 elimina a duplicação |
| Rejeitado com `value=0` virando 1º lugar em `fortime` | 🔴 Alta | `result_status='rejected'` tratado como "sem resultado" no ranking + teste específico |
| Judges concorrentes corrompendo rank | 🟠 Média | advisory lock + `version` (concorrência otimista) na RPC |
| Ambiguidade de fuso na janela de submissão | 🟠 Média | conversão explícita em `America/Fortaleza` + fuso visível na UI |
| `admin/page.tsx` (10k linhas) ficando ingerenciável | 🟠 Média | judge em rota separada; extrair a fila de submissões em componente reutilizável |
| Testes estáticos quebrando em refactor | 🟡 Baixa | atualizar asserções junto (prática já documentada no `CLAUDE.md`) |
| Rate limit em memória insuficiente sob carga | 🟡 Baixa | limitação herdada; registrar como dívida técnica |

---

## 15. Questões abertas para o solicitante

1. **P4/P6** — a penalidade de 15% em provas AMRAP/reps arredonda para baixo (perde reps). Confirma? E o time cap pode ser ultrapassado pela penalidade?
2. **P5** — atleta rejeitado e atleta que não submeteu devem receber a mesma pontuação (último lugar), ou o rejeitado deve ficar atrás?
3. **P3** — o atleta pode substituir a submissão enquanto a janela estiver aberta, ou só envia uma vez?
4. **P7** — o link do vídeo deve ficar visível publicamente no leaderboard, ou permanece restrito?
5. **P8** — deferir uma contestação deve reabrir automaticamente a submissão, ou o gestor decide caso a caso?
6. **P11** — só YouTube, ou aceitar também Vimeo/Google Drive?
7. **§9.4** — o judge recebe e-mail de boas-vindas com credenciais, ou o gestor entrega a senha manualmente?
8. **§8.3** — o gestor pode sobrescrever a decisão de um judge? (assumido que sim, com registro no histórico)
9. Um evento qualifier pode ter **mais de um judge por prova**? Se sim, a primeira decisão vale e as demais viram override auditado?

---

## 16. Auditoria técnica do plano v1 — Quinn (QA)

**Resultado da primeira auditoria:** `CONCERNS` — o plano v1 não deve seguir para implementação ainda.

### 16.1 Achados críticos corrigidos no plano v2

| ID | Severidade | Achado | Correção obrigatória antes da implementação |
|---|---|---|---|
| QA-01 | 🔴 Alta | O plano criava APIs e telas, mas não previa comandos operacionais para submissão, fila, revisão e judges. Isso viola `CLI First`. | Criar primeiro uma camada de domínio/serviço consumida por CLI e APIs; adicionar `bin/qualifier.mjs` e script `qualifier:cli` com operações de judge, submissão, fila, revisão e consulta de histórico. A UI será cliente fino dessa camada. |
| QA-02 | 🔴 Alta | O papel `judge` foi previsto em `types/index.ts`, mas o contrato autoritativo de sessão continua limitado a `owner \| manager \| athlete`. O bootstrap atual também trata judge como atleta e devolveria eventos indevidos. | Alterar `SessionUser`, login, `requireSession`, mappers e bootstrap. O branch judge deve retornar somente eventos qualifier vinculados em `event_judges`, suas divisões/provas e nenhum registro financeiro ou PII de contato. Toda API nova deve validar o evento no servidor, sem confiar no bootstrap. |
| QA-03 | 🔴 Alta | Os prazos foram adicionados apenas ao modelo conceitual de `Workout`. Os selects públicos/privados e os mappers atuais não carregam `submission_opens_at`/`submission_closes_at`; o cadastro/edição também não os envia. | Propagar os campos por migration, selects, `AppContext`, tipos, criação, edição, tela do gestor, painel do atleta e cronograma público. A API deve exigir `submission_closes_at` para qualifier e validar a janela no servidor. |
| QA-04 | 🔴 Alta | P3 permite reenvio e promete histórico de versões, mas `score_submissions` tem somente uma linha por inscrição/prova. Sobrescrever a linha perderia vídeo, score e data anteriores. | Adicionar `score_submission_versions` append-only, com `submission_id`, número de versão, score normalizado, vídeo, nota e timestamps; reviews devem apontar para a versão analisada. Manter uma linha atual ou um ponteiro transacional para a versão ativa. Se o produto decidir “uma única submissão”, remover P3 em vez de manter uma promessa impossível. |
| QA-05 | 🔴 Alta | O ranking atual é client-side e não representa de modo determinístico submissões pendentes, rejeitadas e atletas que não submeteram. O plano v1 propõe SQL, mas não define quando um resultado entra no leaderboard nem como ausências são materializadas. | Antes da RPC, aprovar a máquina de estados de publicação/ranking: `pending_review` não pode ser tratado como resultado final; `validated`, `penalized`, `manual` e `rejected` precisam de semântica explícita; a regra para “não submeteu após o prazo” deve ser definida. Implementar a mesma regra no serviço puro, na RPC e na leitura do leaderboard. |
| QA-06 | 🔴 Alta | `Score` e `PUBLIC_SCORE_SELECT` não carregam `result_status`; uma decisão rejeitada poderia ser recalculada como score normal por código legado ou perder sua procedência no cliente. | Adicionar `resultStatus` ao tipo, select, mappers, payload privado/público e lógica do leaderboard. `scores.submission_id` deve ter FK para `score_submissions` e ser escrito somente pela operação transacional de revisão. |
| QA-07 | 🔴 Alta | A RPC proposta não previa revogação explícita de execução, validação completa das relações nem proteção real do histórico. “Append-only por contrato” não é suficiente para uma trilha de auditoria. | Na migration, revogar `EXECUTE` de `PUBLIC`, `anon` e `authenticated`, conceder somente a `service_role`, usar `SECURITY DEFINER`/`search_path` seguro quando necessário, validar que submission/workout/division/registration/event são coerentes e criar trigger que rejeite `UPDATE`/`DELETE` em `score_submission_reviews`. |
| QA-08 | 🔴 Alta | O cronograma público ainda renderiza qualquer item `heat`; esconder a geração no admin não impede que baterias antigas sejam exibidas num qualifier. Além disso, os prazos derivados não chegam à página pública. | Filtrar/recusar `heat` no fluxo qualifier tanto no admin quanto em `event/[id]`; renderizar deadlines publicados e itens manuais. Preservar heats legados de eventos presenciais sem alterar o comportamento existente. |

### 16.2 Achados de segurança e consistência

| ID | Severidade | Achado | Tratamento no plano v2 |
|---|---|---|---|
| QA-09 | 🟠 Média | `createJudge` em `/api/admin/persistence` precisa ser atômico; inserções separadas de usuário, segredo e vínculo podem deixar contas órfãs. | Preferir RPC administrativa transacional ou rollback completo testado. Validar `role='judge'`, `parent_manager_id`, e que o evento é qualifier pertencente ao ator; bloquear judge com inscrição ativa no evento. |
| QA-10 | 🟠 Média | `assertJudgeEventAccess` v1 liberava owner/manager antes de verificar que o evento era qualifier. | Primeiro carregar e validar `event_type='functional_fitness_qualifier'`; depois aplicar owner/manager/judge e validade operacional. A mesma regra vale para queue, review e CLI. |
| QA-11 | 🟠 Média | Transições de revisão, override de gestor e concorrência entre judges ficaram implícitos. | Definir uma máquina de estados e política de conflito: primeira decisão aceita com `version`; judge não revisa resultado final; override de manager/owner, se aprovado, cria nova review append-only. Registrar `previous_*` e `applied_*` em cada alteração. |
| QA-12 | 🟠 Média | A extensão da contestação não pode apenas tornar `lane` nullable: deferimento/reabertura e remoção do score precisam ser atômicos, e o e-mail atual assume bateria/raia. | Associar `submission_id`, validar alvo e ownership, executar eventual reabertura/recalculo na mesma transação e criar variante de notificação sem bateria/raia. Manter os requisitos atuais para eventos presenciais. |
| QA-13 | 🟠 Média | A allowlist de vídeo v1 adicionava hosts não exigidos, incluindo `youtube-nocookie.com` como entrada do atleta. | Aceitar somente os hosts e caminhos YouTube definidos pelo requisito. Usar `youtube-nocookie.com` apenas como origem do iframe, se o player embutido for aprovado; nunca fazer fetch server-side da URL. |
| QA-14 | 🟠 Média | As migrations declaradas como idempotentes usam `ADD CONSTRAINT` sem estratégia para constraint já existente. | Nomear constraints/triggers e usar bloco seguro de verificação ou migration não repetível documentada; não prometer idempotência onde o Postgres não a oferece. Incluir rollback/backup operacional antes de aplicar em produção. |
| QA-15 | 🟠 Média | O fuso e o arredondamento da penalidade foram assumidos no plano, mas não derivam do pedido. O utilitário de validade do gestor usa data, não resolve sozinho timestamps de submissão. | Armazenar instantes em UTC e definir explicitamente o fuso de entrada/exibição antes da implementação. A fórmula, direção, unidade e arredondamento dos 15% são decisões bloqueantes; sem aprovação, não codificar `Math.ceil`/`Math.floor`. |
| QA-16 | 🔴 Alta | `upsertScores` e a aba atual de lançamento manual aceitam scores para qualquer evento do gestor. No qualifier isso permitiria publicar/alterar resultado sem submissão ou revisão e sem histórico. | Bloquear `upsertScores` para qualifier, esconder/desabilitar a aba manual nesse tipo e permitir alteração somente pela operação transacional de submissão/revisão prevista no plano. Qualquer ajuste administrativo deve usar a mesma trilha auditável. |
| QA-17 | 🔴 Alta | Excluir evento, prova ou categoria pode acionar `ON DELETE CASCADE` e remover submissões/reviews, destruindo o histórico exigido. Alterar `event_type` também pode deixar dados de qualifier órfãos. | Bloquear exclusão quando houver submissão/review, ou criar arquivamento que preserve dados. Tornar `event_type` e a identidade estrutural da prova imutáveis após a primeira submissão; alterações de tipo/divisão devem ser rejeitadas ou gerar fluxo de migração auditado. |
| QA-18 | 🔴 Alta | `updateRegistration` permite relocação de divisão e `cancelRegistration` altera o estado da inscrição sem uma regra para submissões/scores já analisados. | Para qualifier, bloquear relocação/cancelamento após submissão ou executar uma operação transacional que invalide a submissão, remova/recalcule o score e registre a razão. A política deve ser aprovada antes da implementação. |
| QA-19 | 🟠 Média | O admin pode persistir `event_schedule` diretamente; ocultar o gerador de baterias não impede que um payload manual grave `heat` em qualifier. | Validar `event_type` no endpoint `updateEvent` e rejeitar `heat` para qualifier. O mesmo guard deve existir no CLI e nos testes de isolamento. |
| QA-20 | 🟡 Baixa | A nova modalidade pode aparecer como “Functional Fitness” em banners/labels públicos por causa dos fallbacks atuais de `eventType === 'fitness_racing'`. | Inventariar labels públicos e administrativos e exibir “Functional Fitness Qualifier” onde o tipo é apresentado, sem alterar a lógica de checkout/inscrição reaproveitada. |

### 16.3 Verificação do auditor

Após incorporar QA-01 a QA-20, não restam falhas arquiteturais inevitáveis no desenho. A aprovação continua **condicional** às decisões de produto da seção 15 e à criação de uma story válida em `docs/stories/`, conforme a Constitution. Nenhum arquivo de código foi alterado nesta auditoria.

---

## 17. Plano v2 aprovado tecnicamente — sequência corrigida

Esta sequência substitui a ordem da seção 13 para respeitar CLI First e os gates de segurança:

| Fase | Entrega | Gate de saída |
|---|---|---|
| **F0 — contrato e CLI** | Story aprovada; decisões de produto fechadas; tipos de domínio; serviço puro de janela, URL, parsing, penalidade e ranking; CLI de consulta/criação/atribuição/submissão/fila/revisão; testes puros e de autorização | CLI executa os fluxos sem UI; nenhuma regra de negócio fica somente em React; `npm test` dos novos contratos passa |
| **F1 — banco seguro** | Migrations de tipo, prazos, judge, versões, submissions, reviews, vínculo score-submission, contestação e RPCs transacionais | FKs/checks, RLS, revogação de RPC, trigger append-only e concorrência testados; migration validada sem editar migrations aplicadas |
| **F2 — API server-side** | Bootstrap escopado, criação/atribuição de judges, `/api/submissions`, queue/reviews, integração de contestação e mapeamentos privados/públicos | Matriz de autorização e isolamento entre eventos/tenants validada; nenhum vídeo/submission aparece em payload público |
| **F3 — operação do gestor e cronograma** | Cadastro/edição de prazos, gestão de judges, aba de submissões e cronograma qualifier no admin; cronograma público sem heats | Eventos presenciais mantêm baterias; qualifier exibe somente deadlines/datas; datas e fuso são consistentes |
| **F4 — atleta e judge** | Área do atleta, dashboard do judge, player/link seguro, estados de submissão e histórico | UI apenas consome operações autoritativas; auto-revisão, evento não atribuído, janela fechada e stale version bloqueados |
| **F5 — ranking e contestação** | Publicação dos resultados finais, ranking qualifier, overrides aprovados e reabertura de contestação | Fixtures de empate, ausência, rejeição, penalidade, override, cancelamento e reabertura produzem resultado determinístico |
| **F6 — regressão e qualidade** | Atualização de testes estáticos e comportamentais, documentação, checklist/file list da story | `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` e `git diff --check` passam |

### 17.1 CLI mínimo obrigatório

O novo entrypoint deve oferecer, no mínimo:

- `judge create`, `judge assign`, `judge remove`, `judge list`;
- `submission create`, `submission replace`, `submission show`;
- `queue list` com filtros por evento/prova/categoria/status;
- `review apply` com decisão, versão, justificativa e ajuste manual;
- `review history` e consulta do estado do ranking.

As operações devem chamar os mesmos serviços/RPCs das APIs, para não existir uma regra paralela entre CLI, API e UI.

### 17.2 Artefatos que faltavam na matriz v1

Além dos arquivos já listados, o plano passa a incluir explicitamente:

- `src/lib/serverSecurity.ts` e `src/lib/serverManagerAccess.ts` para o novo papel e herança de validade;
- `src/lib/bootstrapPayload.ts` e todos os mappers/seletores do `AppContext` para prazos e procedência do score;
- `src/app/event/[id]/page.tsx` para o cronograma público do qualifier;
- `bin/qualifier.mjs`, `package.json` e testes do CLI;
- migration/tabela de versões das submissões e triggers de imutabilidade;
- serviço de domínio compartilhado entre CLI, APIs e UI;
- story aprovada em `docs/stories/` com acceptance criteria, checklist e file list.

---

## 18. Gate de aprovação do plano

**Status atual:** `AGUARDANDO APROVAÇÃO DO PRODUTO`.

O plano pode seguir para implementação somente quando:

1. as respostas às questões P3–P8, P11–P12 e às questões 7–9 forem registradas;
2. a regra de ranking para submissão pendente, ausência após prazo e rejeição for aprovada;
3. a política de override e de múltiplos judges for aprovada;
4. uma story for criada/aprovada em `docs/stories/`;
5. o agente @qa repetir a auditoria sobre a versão aprovada e emitir `PASS`/`CONCERNS` sem achados críticos ou altos.

Até esse gate, a única alteração permitida é documental. O código permanece intocado.
