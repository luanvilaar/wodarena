# Plano de Implementação — Live Timing (Fitness Race)

> **Status:** AGUARDANDO APROVAÇÃO — nenhuma alteração em código, banco, autenticação ou infraestrutura foi executada.
> **Base:** `wodarena_live_timing_implementation_plan.md`
> **Data da análise:** 2026-08-27
> **Método:** AS-IS → TO-BE → DELTA (conforme §40 do documento base)

---

## Sumário executivo

O WODArena **já possui 60% da modelagem conceitual** que o documento base pede — só que resolvida por lançamento manual em vez de leitura automática. O percurso de Fitness Race já é uma sequência ordenada configurável (`divisions.course_layout`), os splits já existem e já são renderizados na UI (`scores.splits`), e o tempo total já é a fonte de verdade da classificação.

O que **não existe** e precisa ser construído: ingestão autenticada, identidade de chip, imutabilidade/auditoria de leituras, deduplicação, monitoramento de leitores e atualização ao vivo.

A recomendação central deste plano é **não criar um sistema paralelo de resultados**. O Timing Engine deve terminar exatamente onde o sistema atual começa: escrevendo em `scores.splits` e `scores.value` do workout `TOTAL`. Assim o leaderboard público, a análise de performance, o desempate e as contestações continuam funcionando sem reescrita.

Três decisões de arquitetura divergem do documento base — todas por análise do stack real, e todas justificadas na seção "Divergências".

---

# PARTE I — AS-IS (arquitetura atual)

## 1. Stack verificado

| Camada | Tecnologia real | Evidência |
|---|---|---|
| Framework | Next.js 16.3.1 (App Router) + React 19.2.4 | `package.json` |
| Linguagem | TypeScript 5, alias `@/*` → `src/*` | `package.json`, `CLAUDE.md` |
| Banco | Supabase Postgres — **sem ORM**, SQL puro em migrations | `supabase/migrations/` (43 arquivos) |
| Acesso a dados | `@supabase/supabase-js` client anon (restrito) + `service_role` server-side | `src/lib/supabase.ts`, `src/lib/serverSecurity.ts` |
| Auth | **Custom**, não Supabase Auth: token HMAC-SHA256 em cookie `woda_session` (12h), senhas scrypt | `src/lib/serverSecurity.ts` |
| Papéis | `owner` \| `manager` \| `athlete` \| `judge` | `SessionUser` em `serverSecurity.ts` |
| Deploy | **Vercel serverless** (`.vercel/project.json`) — sem `vercel.json`, sem cron, sem workflow de CI | raiz do projeto |
| Fila / worker | **NÃO EXISTE** (nem BullMQ, nem Redis, nem SQS, nem Celery) | `package.json` — 5 dependências de produção |
| Realtime | **NÃO EXISTE** — zero uso de Realtime, WebSocket ou SSE | busca por `.channel(`/`EventSource`/`WebSocket` em `src/`: 0 resultados |
| Testes | `node:test`, majoritariamente **regressão estática** sobre arquivos-fonte | `tests/*.test.mjs` (35 arquivos) |

### 1.1 Achados que condicionam o desenho

**a) Não existe camada realtime.** A atualização de dados hoje é re-fetch do bootstrap. O único mecanismo periódico é um `setInterval(…, 15000)` no painel admin ([admin/page.tsx:938](src/app/admin/page.tsx#L938)). O item §13 do documento base ("reutilizar a solução realtime existente") **não tem o que reutilizar** — precisa ser construído.

Ponto positivo: a CSP em [next.config.ts](next.config.ts) **já libera `wss://` do Supabase** no `connect-src`, então Supabase Realtime não exigiria mudança de header.

**b) Não existe infraestrutura para processamento assíncrono.** Vercel serverless não tem worker de background persistente. O §9 do documento (enfileirar → responder 202 → worker processa) **não tem onde rodar** sem adicionar infraestrutura nova (Upstash/QStash, Vercel Cron, container separado).

**c) O rate limiter atual é inutilizável para ingestão.** `checkRateLimit` ([serverSecurity.ts](src/lib/serverSecurity.ts)) é um `Map` em memória do processo. Em Vercel serverless isso é **por instância** e reseta a cada cold start. Serve para login (baixo volume), não serve como proteção de um endpoint que recebe milhares de POSTs durante uma prova.

**d) IDs são `TEXT` gerados na aplicação**, não UUID (exceto `leaderboard_entries.id`). Timestamps de domínio (`events.date`, `athletes.birth_date`) são `TEXT`. Novas tabelas de timing **não devem herdar esse padrão** para tempo — exigem `TIMESTAMPTZ` com precisão de milissegundos (§26).

**e) O cálculo do leaderboard é 100% client-side.** `getLeaderboard()` ([AppContext.tsx:1859](src/context/AppContext.tsx#L1859)) roda no browser sobre o payload do bootstrap. Não existe leaderboard materializado com posições persistidas.

---

## 2. Modelo de dados relevante (já existente)

```
events (id TEXT, event_type, organizer_id, status)
  └── divisions (id TEXT, event_id, course_layout JSONB, use_age_groups, age_groups)
        └── workouts (id TEXT, event_id, division_id, code, type, tie_breaker)
              └── scores (PK: athlete_id + workout_id)
                    ├── result TEXT      -- "56:38"
                    ├── value NUMERIC    -- 3398 (segundos) ← ordenação
                    ├── rank, points INTEGER
                    ├── splits JSONB     -- { "run-1": "03:42", "ski-erg": "02:14" }
                    └── result_status

athletes (id TEXT, division_id, name, box, gender, is_team, team_members JSONB)
registrations (id TEXT, event_id, division_id, athlete_id, payment_status, …)
leaderboard_entries (cache desnormalizado; sync por trigger em registrations)
```

## 3. Fitness Racing hoje — o mapeamento que muda tudo

O `CourseStage` ([types/index.ts](src/types/index.ts)) **já é o percurso configurável** que o §4 do documento pede:

```ts
interface CourseStage {
  id: string;                    // "run-1", "ski-erg", "sled-push"
  name: string;
  type: 'run' | 'station';
  orderIndex: number;            // ← sequência esperada
  distance?, reps?, maleWeight?, femaleWeight?
}
```

`buildFitnessRacingCourse()` ([fitnessRacing.ts](src/lib/fitnessRacing.ts)) gera 8 estações intercaladas com 8 corridas = **16 stages ordenados**. O gestor pode editar (`course_layout` é `DIVISION_UPDATABLE_FIELDS` em `persistence/route.ts`).

Cada divisão de Fitness Racing tem **um único workout**, `code: 'TOTAL'`, `type: 'fortime'`.

**Os splits já existem e já são consumidos pela UI.** [Leaderboard.tsx:1028-1060](src/components/Leaderboard.tsx#L1028-L1060) lê `score.splits[stage.id]` para montar a "Análise de Performance" (melhor/pior split, comparação run vs. station).

A classificação é ordenação pura por `scores.value` do workout TOTAL; sem resultado → `999999` ([AppContext.tsx:1884](src/context/AppContext.tsx#L1884)).

> **Consequência de projeto:** o contrato de saída do Timing Engine já está definido pelo código existente. O engine deve produzir `scores.splits` chaveado por `CourseStage.id` e `scores.value` em segundos. Nada na UI de leaderboard precisa ser reescrito.

## 4. Postura de segurança atual (a régua a ser mantida)

O projeto tem uma postura de segurança deliberada e documentada, que qualquer coisa nova precisa respeitar:

- **RLS habilitado em todas as tabelas**; a superfície REST/anon do Supabase foi **fechada** na migration `20260621153000_api_surface_hardening.sql` — inclusive `leaderboard_entries`, que **teve sua policy de leitura pública removida**.
- Todo acesso público passa por rotas server-side (`/api/app/bootstrap/public`) com sanitização de PII (`sanitizeNamePII`).
- Toda escrita administrativa passa por um dispatcher único: `POST /api/admin/persistence`, com `requireSession(['manager','owner'])` → `assertManagerOperationalAccess` → `ensureEventOwner/DivisionOwner/WorkoutOwner`.
- **Allowlist de campos** (`EVENT_UPDATABLE_FIELDS` etc.) impede mass assignment — o comentário no código é explícito sobre o risco de troca de tenant.
- Autorização derivada do **dado efetivamente mutado**, não de parâmetros paralelos do cliente (ver comentário em `upsertScores`).

### 4.1 O módulo Qualifier é o padrão de referência

`20260816120000_functional_fitness_qualifier.sql` já implementa, para submissões de vídeo, **exatamente o rigor que o timing exige**:

| Padrão | Implementação existente |
|---|---|
| Registros imutáveis | `qualifier_prevent_review_mutation()`, `qualifier_prevent_submission_version_mutation()` — triggers que bloqueiam UPDATE/DELETE |
| Autorização no banco | RPCs `SECURITY DEFINER SET search_path = public` com `p_actor_id`, verificação de role, ownership e validade do gestor |
| Concorrência | Optimistic locking via `p_expected_version` + `SELECT … FOR UPDATE` |
| Conflito de interesse | `IF v_submission.user_id = p_actor_id THEN RAISE EXCEPTION` |
| Superfície fechada | `REVOKE ALL … FROM PUBLIC, anon, authenticated` + `GRANT … TO service_role` |

**O módulo de timing deve clonar esse padrão, não inventar outro.**

### 4.2 HMAC já resolvido

O webhook do Mercado Pago ([webhooks/mercadopago/route.ts](src/app/api/webhooks/mercadopago/route.ts)) já valida assinatura no formato `ts=…,v1=…` com `createHmac('sha256')` + `timingSafeEqual`. É o molde direto para `X-WodArena-Signature` (§19).

---

# PARTE II — DIAGNÓSTICO (gaps)

| # | Gap | Severidade | Impacto |
|---|---|---|---|
| G1 | Sem identidade de chip/bib no modelo | **Bloqueante** | Impossível associar leitura → atleta |
| G2 | Sem ingestão autenticada | **Bloqueante** | §19 inteiro por fazer |
| G3 | Sem armazenamento imutável de leituras | **Bloqueante** | §6/§43 — "uma leitura nunca deve desaparecer" |
| G4 | Sem timing points nem mapa reader→ponto | **Bloqueante** | §2.3, §3.2, §3.3 |
| G5 | Sem deduplicação | **Alto** | §7 — RFID gera rajadas; splits duplicados corrompem o tempo |
| G6 | Sem realtime | **Alto** | §13 — não há nada a reutilizar |
| G7 | Rate limit em memória não funciona em serverless | **Alto** | Endpoint de ingestão fica sem proteção real de flood |
| G8 | Sem fila/worker | **Médio** | §9 não tem onde rodar em Vercel |
| G9 | Sem audit log de correções manuais | **Alto** | §16/§28 |
| G10 | Sem monitoramento de leitores | **Médio** | §18, §35 |
| G11 | `courseLayout` é *trecho*, não *ponto* | **Médio** | Precisa de derivação explícita (ver §6 deste plano) |
| G12 | Timestamps de domínio são TEXT | **Médio** | Timing exige TIMESTAMPTZ com ms |

---

# PARTE III — TO-BE (arquitetura proposta)

## 5. Dimensionamento antes de otimizar (§31)

| Métrica | Valor real derivado do código |
|---|---|
| Atletas por evento (teto) | `slotsLimit` default 100 × 10 divisões = **~1.000** |
| Timing points por divisão | 16 stages + START = **17** |
| Leituras por evento inteiro | 1.000 × 17 ≈ **17.000** |
| Pico realista (largadas em heat) | **< 20 leituras/s** |

**Conclusão:** Postgres processa isso com folga em modo síncrono. **Não há justificativa para fila, Kafka, Redis ou TCP gateway no MVP** — e adicioná-los violaria o §9 ("não adicionar infraestrutura desnecessária caso a escala atual não exija").

## 6. Decisão central: `CourseStage` → `timing_points`

O documento fala em pontos (`STATION_IN`, `STATION_OUT`, `FINISH`); o WODArena modela trechos (`run-1`, `ski-erg`). A ponte:

```
courseLayout:        [START]  run-1   ski-erg   run-2   sled-push  …  (16 stages)
                        │       │        │        │         │
timing_points:        seq 0   seq 1    seq 2    seq 3     seq 4    …  seq 16=FINISH
                     (START) (exit)   (exit)   (exit)    (exit)
                        │       │
split do stage "run-1" = timestamp(seq 1) − timestamp(seq 0)
```

Cada `CourseStage` gera **um ponto de saída**; o tempo do stage é a diferença para o ponto anterior. Um ponto extra `START` (seq 0) e o último ponto é o `FINISH`.

**Benefícios:**
- `scores.splits` continua chaveado por `CourseStage.id` → **UI intacta**
- `orderIndex` já define a sequência esperada → detecção de `OUT_OF_SEQUENCE` sai de graça
- Eventos que quiserem `STATION_IN` + `STATION_OUT` separados só adicionam pontos com `stage_id` compartilhado — o modelo suporta, o MVP não usa

## 7. Fluxo proposto

```
  Software do provider
        │  HTTPS + HMAC (X-WodArena-Key/Signature/Timestamp)
        ▼
  POST /api/v1/timing/read[/batch]        ← Next.js Route Handler
        │  1. valida assinatura + janela anti-replay (5 min)
        │  2. resolve provider → event (multi-tenant)
        │  3. INSERT em timing_readings (IMUTÁVEL, payload cru)
        │  4. chama RPC timing_process_reading()   ← síncrono, Postgres
        ▼
  RPC timing_process_reading()  [SECURITY DEFINER]
        ├─ resolve reader → timing_point            (senão UNKNOWN_READER)
        ├─ resolve chip → athlete_chips → athlete   (senão UNKNOWN_CHIP)
        ├─ dedup: mesmo chip+ponto dentro da janela (senão DUPLICATE)
        ├─ valida sequência vs. orderIndex          (senão OUT_OF_SEQUENCE)
        ├─ UPSERT athlete_splits
        ├─ recompõe scores.splits + scores.value (workout TOTAL)
        └─ INSERT em timing_live_feed (cursor incremental)
        ▼
  Resposta 202 com { reading_id, status, athlete_id?, bib? }
        ▼
  GET /api/v1/timing/feed?eventId=…&since=…   ← leaderboard e painel
```

## 8. Novas tabelas (7)

Todas com `TIMESTAMPTZ`, RLS habilitado e `REVOKE ALL FROM PUBLIC, anon, authenticated`.

### 8.1 `timing_providers`
```
id TEXT PK
event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE
name, slug TEXT
provider_type TEXT            -- 'generic_http' | 'race_result' | 'chronotrack' | …
api_key_hash TEXT NOT NULL    -- scrypt; NUNCA a chave em claro
api_key_prefix TEXT           -- 8 primeiros chars, para exibir no painel
webhook_secret_hash TEXT
configuration JSONB           -- mapeamento de campos do Generic Adapter (§22)
status TEXT                   -- 'active' | 'paused' | 'revoked'
is_test_mode BOOLEAN          -- §34
created_at, updated_at, revoked_at, last_used_at TIMESTAMPTZ
```

### 8.2 `timing_points`
```
id TEXT PK
event_id, division_id TEXT NOT NULL
code TEXT NOT NULL            -- 'START' | 'RUN_01' | 'FINISH'
name TEXT
type TEXT                     -- START|RUN_SPLIT|STATION_IN|STATION_OUT|TRANSITION|LAP|FINISH|CUSTOM
sequence_order INTEGER NOT NULL
stage_id TEXT                 -- ← link para CourseStage.id (NULL em START)
metadata JSONB
UNIQUE(event_id, division_id, sequence_order)
UNIQUE(event_id, division_id, code)
```
Gerados por uma função a partir de `divisions.course_layout` (idempotente, re-executável quando o gestor edita o percurso — **bloqueada** se já houver leituras processadas, espelhando `qualifier_protect_workout_after_submission()`).

### 8.3 `timing_readers`
```
id TEXT PK
event_id, provider_id TEXT NOT NULL
external_reader_id TEXT NOT NULL      -- "04", "reader_04", "antenna-5"
name TEXT
timing_point_id TEXT REFERENCES timing_points(id)
status TEXT                            -- ONLINE|DEGRADED|OFFLINE|UNKNOWN (derivado)
last_seen_at TIMESTAMPTZ
readings_count BIGINT DEFAULT 0
last_error TEXT
metadata JSONB
UNIQUE(event_id, provider_id, external_reader_id)
```

### 8.4 `athlete_chips`
```
id TEXT PK
event_id TEXT NOT NULL
registration_id TEXT REFERENCES registrations(id)
athlete_id TEXT REFERENCES athletes(id)
division_id TEXT NOT NULL
bib_number INTEGER
chip_id TEXT NOT NULL
is_secondary BOOLEAN DEFAULT FALSE
is_active BOOLEAN DEFAULT TRUE
assigned_at, unassigned_at TIMESTAMPTZ
assigned_by TEXT

-- Um chip ativo pertence a UM atleta por evento (anti-clonagem)
UNIQUE INDEX (event_id, chip_id) WHERE is_active
UNIQUE INDEX (event_id, bib_number) WHERE is_active
```

### 8.5 `timing_readings` — IMUTÁVEL (§6, §43)
```
id TEXT PK
event_id, provider_id, reader_id TEXT
timing_point_id TEXT                   -- resolvido; NULL se UNKNOWN_READER
external_reader_id, chip_id TEXT NOT NULL
athlete_id TEXT                        -- resolvido; NULL se UNKNOWN_CHIP
decoder_timestamp   TIMESTAMPTZ        -- §25, prioridade 1
provider_timestamp  TIMESTAMPTZ        -- prioridade 2
gateway_timestamp   TIMESTAMPTZ        -- prioridade 3
received_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()   -- prioridade 4
normalized_timestamp TIMESTAMPTZ NOT NULL                -- o efetivamente usado
timestamp_source TEXT NOT NULL         -- qual das 4 venceu
sequence BIGINT
request_id TEXT                        -- idempotência ponta a ponta (§24)
raw_payload JSONB NOT NULL
processing_status TEXT NOT NULL        -- PROCESSED|DUPLICATE|UNKNOWN_CHIP|UNKNOWN_READER|
                                       -- OUT_OF_SEQUENCE|INVALID_TIMESTAMP|REJECTED|MANUAL_REVIEW
processing_error TEXT
is_test BOOLEAN DEFAULT FALSE          -- §34
invalidated_at TIMESTAMPTZ
invalidated_by TEXT
invalidation_reason TEXT
created_at TIMESTAMPTZ DEFAULT NOW()

UNIQUE(provider_id, request_id) WHERE request_id IS NOT NULL
INDEX (event_id, created_at DESC)
INDEX (event_id, chip_id, timing_point_id, normalized_timestamp)   -- dedup
INDEX (event_id, processing_status) WHERE processing_status <> 'PROCESSED'
```
**Trigger `timing_prevent_reading_mutation()`**: bloqueia `DELETE` e bloqueia `UPDATE` de qualquer coluna exceto `athlete_id`, `timing_point_id`, `processing_status`, `processing_error`, `invalidated_*` (reprocessamento e invalidação são permitidos; reescrever o fato bruto, não).

### 8.6 `athlete_splits`
```
id TEXT PK
event_id, division_id, athlete_id, timing_point_id TEXT NOT NULL
reading_id TEXT REFERENCES timing_readings(id)
absolute_time  TIMESTAMPTZ NOT NULL    -- timestamp da passagem
elapsed_ms     BIGINT                  -- desde o START
split_ms       BIGINT                  -- desde o ponto anterior
position_at_split INTEGER
status TEXT                            -- 'auto' | 'manual' | 'corrected' | 'invalidated'
source TEXT                            -- 'timing' | 'manual'
version INTEGER DEFAULT 1              -- optimistic locking
created_at, updated_at TIMESTAMPTZ
UNIQUE(event_id, athlete_id, timing_point_id)
```

### 8.7 `timing_audit_log` (§28)
```
id TEXT PK
event_id TEXT NOT NULL
actor_user_id TEXT NOT NULL
actor_role TEXT NOT NULL
action TEXT NOT NULL      -- add_passage|edit_passage|invalidate|reprocess|assign_chip|
                          -- swap_chip|manual_time|fix_timestamp|move_point|revoke_key
entity_type, entity_id TEXT
previous_state JSONB
new_state JSONB
reason TEXT NOT NULL      -- obrigatório, espelhando qualifier_review_justification_required
ip_address, user_agent TEXT
created_at TIMESTAMPTZ DEFAULT NOW()
```
Trigger `timing_prevent_audit_mutation()`: append-only.

## 9. Alterações em estruturas existentes

| Objeto | Mudança | Risco |
|---|---|---|
| `divisions.course_layout` | **Nenhuma mudança de schema.** `timing_points` são derivados. | Nulo |
| `scores.splits` | Passa a ser **escrito** pelo engine além do lançamento manual. Formato inalterado. | Baixo |
| `scores.value` / `result` | Escritos pelo engine para o workout `TOTAL` quando o atleta cruza o `FINISH`. | Médio — conflito com lançamento manual (resolvido: `source` + audit) |
| `Score` (types) | `resultStatus` ganha `'timing'` opcional; `Registration` ganha `bibNumber?`, `chipId?` (derivados de `athlete_chips`) | Baixo |
| `bootstrapPayload.ts` | Novo builder `buildTimingOperationalPayload()` para o painel do gestor | Baixo |
| `persistence/route.ts` | ~12 novos `case` para operações de timing | Baixo — segue o padrão |
| Auth (`serverSecurity.ts`) | **Nenhuma mudança no modelo de sessão.** Ingestão usa HMAC próprio, caminho separado. | Nulo |

## 10. API

### 10.1 Ingestão (provider → WODArena)

```http
POST /api/v1/timing/read
POST /api/v1/timing/read/batch          -- máx. 500 leituras/requisição

X-WodArena-Key:       tp_live_a1b2c3d4…
X-WodArena-Timestamp: 1794835641
X-WodArena-Signature: v1=<hex HMAC-SHA256>
Idempotency-Key:      <uuid>            -- opcional, recomendado
Content-Type: application/json
```

Manifesto assinado: `${timestamp}.${rawBody}` — mesma construção do webhook Mercado Pago já em produção.

Respostas:
| Código | Situação |
|---|---|
| `202` | Aceito e processado (ou aceito com status não-PROCESSED) |
| `400` | Payload malformado |
| `401` | Chave inválida / assinatura inválida |
| `403` | Provider revogado, evento não-live, ou gestor com serviço expirado |
| `409` | `Idempotency-Key` já usado (retorna o `reading_id` original) |
| `413` | Batch acima do limite |
| `422` | Timestamp fora da janela anti-replay |
| `429` | Rate limit excedido |

**Nunca `5xx` por leitura não reconhecida.** Chip desconhecido e reader desconhecido retornam `202` com `status: "UNKNOWN_CHIP"` — a leitura é armazenada e fica disponível para reprocessamento (§17). Isso evita que o software do provider entre em retry-storm no meio da prova.

### 10.2 Consumo

```http
GET  /api/v1/timing/feed?eventId=…&since=<cursor>     -- público, sem PII, incremental
GET  /api/admin/timing/dashboard?eventId=…            -- gestor: leitores, métricas, últimas leituras
GET  /api/admin/timing/readings?eventId=…&status=…    -- gestor: stream operacional (§15)
POST /api/admin/persistence                            -- gestor: todas as mutações
```

Novos `case` no dispatcher `persistence`:
`createTimingProvider`, `rotateTimingProviderKey`, `revokeTimingProvider`, `generateTimingPoints`, `upsertTimingReader`, `assignTimingReaderPoint`, `importAthleteChips`, `assignAthleteChip`, `swapAthleteChip`, `addManualPassage`, `editPassage`, `invalidatePassage`, `reprocessReadings`, `simulateReading`.

## 11. Timing Engine (regras)

**Prioridade de timestamp (§25):** `decoder > provider > gateway > received_at`. Todos armazenados; `timestamp_source` registra o vencedor. Normalização em **UTC** (§27); exibição no fuso do evento (`America/Fortaleza`, já usado em `managerAccess.ts`).

**Deduplicação (§7):** mesmo `event_id + chip_id + timing_point_id` dentro de `duplicate_window_ms` (default **2000**, configurável por provider) → primeira leitura gera o split, as demais gravam como `DUPLICATE`. Índice dedicado torna a checagem O(log n).

**Ordem (§8):** `OUT_OF_SEQUENCE` quando falta ponto anterior obrigatório. **Não rejeita** — grava, gera split provisório e marca para revisão. Reprocessamento em lote reavalia (leitura atrasada de reader com buffer é o caso normal, não o excepcional).

**Cálculo (§11):**
```
elapsed_ms = normalized_timestamp(ponto N) − normalized_timestamp(START)
split_ms   = normalized_timestamp(ponto N) − normalized_timestamp(ponto N−1)
```
No `FINISH`: `scores.value = ceil(elapsed_ms / 1000)`, `scores.result = secondsToTime(value)` — usando exatamente a mesma semântica de `src/lib/scoring.ts` para não divergir do lançamento manual.

**Escrita em `scores`:** o engine recompõe `splits` mapeando `timing_point.stage_id → secondsToTime(split_ms)` e faz `UPSERT` em `scores`. Regra de precedência: um score marcado como manual/corrigido pelo gestor **não é sobrescrito** pelo engine sem invalidação explícita — o inverso corromperia correções oficiais.

**Leaderboard (§12):** enquanto ninguém termina, ordena por (pontos concluídos DESC, timestamp do último ponto ASC). Após o `FINISH`, `elapsed` total decide. Isso **estende** `getLeaderboard()` para `fitness_racing`, preservando o comportamento atual quando não há timing.

## 12. Realtime — divergência justificada

O documento (§13) pede WebSocket/Realtime. O projeto **removeu deliberadamente** as policies de leitura pública do Supabase (`api_surface_hardening`), inclusive de `leaderboard_entries`. Reintroduzir uma policy `USING (true)` para alimentar Supabase Realtime seria **regressão da postura de segurança** e provavelmente quebraria `tests/api-surface-hardening.test.mjs`.

**Proposta MVP:** endpoint público `GET /api/v1/timing/feed?since=<cursor>` sobre uma tabela estreita `timing_live_feed` (event_id, athlete_id, bib, timing_point_code, elapsed_ms, position, seq BIGSERIAL), sem PII, servido por `service_role` com `Cache-Control: no-store`. Cliente faz long-poll a cada 2s com cursor incremental.

- Payload por tick: bytes, não a lista inteira
- Zero mudança em RLS, zero regressão de teste
- 1.000 espectadores × 0,5 req/s = 500 req/s — dentro do Vercel; degradável para 5s se necessário

**Fase 3:** migrar para Supabase Realtime Broadcast (canal autenticado por token efêmero, no molde de `createRegistrationAccessToken`), que não exige policy pública. A CSP já libera `wss://`.

---

# PARTE IV — SEGURANÇA

Esta é a seção que o Requisito Crítico (§43) torna inegociável. O modelo de ameaça assume **adversário motivado**: em competição, resultado tem valor.

## 13. Modelo de ameaça e controles

| # | Ameaça | Vetor | Controle proposto |
|---|---|---|---|
| **T1** | Atleta forja leitura própria | Descobre `/api/v1/timing/read` e posta JSON | HMAC obrigatório; chave só existe no servidor do provider; **nunca** trafega para o browser. `api_key_hash` no banco (scrypt), nunca em claro. Nenhum endpoint público retorna chave |
| **T2** | Replay de payload legítimo | Captura tráfego e reenvia | Janela de 5 min sobre `X-WodArena-Timestamp` (assinado); `UNIQUE(provider_id, request_id)`; dedup por janela mata a passagem repetida mesmo se a assinatura passar |
| **T3** | Clonagem de chip | Dois transponders com mesmo ID | `UNIQUE(event_id, chip_id) WHERE is_active`; **detecção de impossibilidade física**: mesmo chip em dois pontos com intervalo menor que o mínimo do percurso → `MANUAL_REVIEW` + alerta no painel |
| **T4** | "Coelho" (terceiro carrega o chip) | Fora do escopo de software | Mitigação parcial: perfil de tempo anômalo (split X% melhor que o histórico do atleta) → flag. Decisão final é humana, com audit log |
| **T5** | Cross-tenant: gestor A manipula evento de B | Chamada direta à API admin | `ensureEventOwner` em **todo** case novo; `provider → event_id` resolvido no servidor, **nunca** aceito do payload; RPCs validam `p_actor_id` no banco (padrão qualifier) |
| **T6** | Escalação por mass assignment | `data: { organizer_id: … }` | Allowlists `TIMING_*_UPDATABLE_FIELDS`, espelhando `EVENT_UPDATABLE_FIELDS` |
| **T7** | Insider apaga leitura desfavorável | `DELETE FROM timing_readings` | Trigger de imutabilidade bloqueia DELETE **no banco**, não na aplicação. Invalidação exige `invalidation_reason` e gera audit log |
| **T8** | Insider edita split silenciosamente | UPDATE direto | Toda correção passa por RPC que exige `reason` e escreve `previous_state`/`new_state` em `timing_audit_log` (append-only) |
| **T9** | DoS / flood na ingestão | Milhares de POSTs durante a prova | **Rate limit persistente em Postgres** por `provider_id` (janela deslizante, counter atômico) — o `Map` em memória atual não serve. Limite de 500 itens/batch, `413` acima. Body size cap |
| **T10** | Envenenamento por leitura de teste | Provider em test mode contamina resultado oficial | `is_test` propagado de `timing_providers.is_test_mode` → `timing_readings` → filtro **obrigatório** em toda agregação (§34) |
| **T11** | Vazamento de PII no feed público | Feed expõe nome/e-mail | `timing_live_feed` só carrega `athlete_id`, `bib`, código do ponto e tempo. Nomes continuam vindo do bootstrap público já sanitizado por `sanitizeNamePII` |
| **T12** | Chave vazada e reutilizada | Chave em log/repo do provider | `last_used_at` + IP do último uso no painel; `rotateTimingProviderKey` e `revokeTimingProvider` com efeito imediato; prefixo exibido para identificação sem exposição |
| **T13** | Timestamp forjado (atleta "chega" antes) | Provider comprometido envia tempo impossível | `INVALID_TIMESTAMP` se fora de `[event.start − 2h, event.start + 24h]`; rejeita `normalized_timestamp` anterior ao START do próprio atleta; rejeita futuro > 5 min do relógio do servidor |
| **T14** | Ingestão em evento encerrado | Injeção pós-prova | Ingestão só aceita `event.status = 'live'` (ou janela explícita definida pelo gestor); fora disso → `403` + audit |
| **T15** | Gestor com serviço expirado opera | Bypass de `managerAccess` | `assertManagerOperationalAccess` em todas as rotas admin de timing, como já é feito em `persistence` |

## 14. Invariantes de segurança (viram testes de regressão)

1. Nenhuma resposta de API retorna `api_key_hash` ou `webhook_secret_hash`.
2. `timing_readings` não aceita DELETE por nenhum papel.
3. `timing_audit_log` não aceita UPDATE nem DELETE.
4. Toda tabela nova tem RLS habilitado e `REVOKE` para `anon`/`authenticated`.
5. Todo `case` de timing em `persistence` chama `ensureEventOwner`.
6. `event_id` da ingestão vem do provider resolvido no servidor, nunca do body.
7. Toda agregação de resultado filtra `is_test = false` e `invalidated_at IS NULL`.
8. Nenhuma correção manual é aceita sem `reason` não-vazio.

---

# PARTE V — DELTA E EXECUÇÃO

## 15. Fases

### Fase 0 — Descoberta (bloqueia adapter específico, **não** bloqueia Fase 1)
Enviar à empresa de cronometragem o questionário de 18 itens do §38. O Generic HTTP Adapter (§22) permite começar sem resposta: o gestor configura `{chip_field, reader_field, timestamp_field}` em `timing_providers.configuration`.

### Fase 1 — Núcleo (MVP)
Migrations das 7 tabelas + triggers de imutabilidade · geração de `timing_points` a partir de `course_layout` · `POST /api/v1/timing/read` com HMAC + anti-replay · RPC `timing_process_reading` (dedup, sequência, splits) · escrita em `scores` · importação CSV de chips (§5) · painel "Cronometragem" com últimas leituras (§15) · feed incremental · leaderboard ao vivo.

Critérios de aceite: itens 1–11 do §42.

### Fase 2 — Operação
Correções manuais completas (§16) com audit log · fila de chips desconhecidos + associação retroativa com reprocessamento (§17) · monitoramento de leitores ONLINE/DEGRADED/OFFLINE (§18) · `POST /read/batch` · modo de teste com simulador (§34) · painel operacional completo (§35).

Critérios de aceite: itens 12–14 do §42.

### Fase 3 — Resiliência
Supabase Realtime Broadcast substituindo polling · adapters específicos por fabricante · métricas (§30) · alertas · TCP Gateway como serviço separado (§23) **somente se** o provider exigir · buffer offline no gateway (§24).

## 16. Testes

Seguindo a convenção do repo (regressão estática sobre fontes/migrations + unitários reais):

| Arquivo | Cobertura |
|---|---|
| `tests/timing-security.test.mjs` | Os 8 invariantes da §14 |
| `tests/timing-engine.test.mjs` | Dedup, out-of-order, prioridade de timestamp, cálculo de split/elapsed, paridade com `scoring.ts` |
| `tests/timing-ingestion.test.mjs` | HMAC válido/inválido, replay, idempotência, batch, códigos de resposta |
| `tests/timing-schema.test.mjs` | RLS, REVOKE, triggers de imutabilidade, índices únicos |
| `tests/timing-manual-operations.test.mjs` | Audit log obrigatório, precedência manual sobre automático |

Cenários do §41 cobertos: unit, integration, duplicate, out-of-order, unknown chip, reader failure. **Load e offline** ficam para a Fase 3 (exigem ambiente dedicado).

## 17. Divergências deliberadas do documento base

| § | Documento pede | Proposta | Razão |
|---|---|---|---|
| §9 | Fila + worker assíncrono | Processamento **síncrono** em RPC Postgres | Vercel serverless não tem worker; volume real (<20 leituras/s) não exige. Alinhado ao próprio §9 ("não adicionar infraestrutura desnecessária") |
| §13 | WebSocket/Realtime | **Polling incremental** com cursor no MVP; Realtime Broadcast na Fase 3 | Realtime via Postgres Changes exigiria policy `USING (true)`, revertendo o hardening de `api_surface_hardening` |
| §3.3 | `TimingPoint` como entidade primária | **Derivado** de `divisions.course_layout` | §39: "não criar sistemas paralelos se já houver estruturas equivalentes". Preserva `scores.splits` e a UI existente |
| §23 | TCP Gateway | Fora do MVP | Só se o provider não oferecer HTTP. Vercel não hospeda listener TCP — exigiria infraestrutura nova |

## 18. Verificação pós-aprovação (subagentes)

Após aprovação e implementação de cada fase:

| Agente | Missão |
|---|---|
| `aiox-qa` | Caça a bugs de implementação, cobertura de testes, quality gate PASS/CONCERNS/FAIL |
| `cyber-chief` | Squad de segurança: tentar burlar resultados pelos vetores T1–T15, buscar bypass de autorização e cross-tenant |
| `aiox-data-engineer` | Auditoria de schema, RLS, triggers, índices e migrations |
| `general-purpose` | Revisão cruzada: paridade entre engine e `scoring.ts`, invariantes da §14 |

---

## 19. O que este plano NÃO faz

- Não altera o modelo de autenticação de usuários.
- Não altera o schema de `events`, `divisions`, `workouts`, `athletes` ou `registrations`.
- Não reescreve o leaderboard nem a UI de análise de performance.
- Não adiciona dependências npm no MVP (HMAC usa `node:crypto`, já em uso).
- Não adiciona infraestrutura externa (Redis, fila, container) no MVP.
- Não implementa adapter de fabricante específico antes da Fase 0.

---

**Aguardando validação do diagnóstico e da solução proposta para autorizar a implementação.**
