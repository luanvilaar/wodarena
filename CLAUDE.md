# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

WODArena — plataforma Next.js (App Router) de eventos de Functional Fitness e Fitness Race: inscrições online, checkout via Mercado Pago, leaderboards em tempo real e gestão de eventos por organizadores. Persistência em Supabase (Postgres). UI em português.

## Commands

```bash
npm run dev          # Next.js dev server (localhost:3000)
npm run build        # Production build
npm run lint         # ESLint (eslint.config.mjs, flat config)
npm run typecheck    # next typegen + tsc --noEmit (gera tipos de rotas antes de checar)
npm test             # node --test sobre todos os tests/*.test.mjs
```

Rodar um único teste:

```bash
node --test tests/security-hardening.test.mjs
```

CLIs operacionais (scripts em `bin/`, leem direto do Supabase via service role):

```bash
npm run contestations:cli
npm run athlete-profile:cli
npm run manager-service:cli
```

## Architecture

### Bootstrap público vs privado (o conceito central)

Todo o estado do app é carregado por **um** de dois endpoints de bootstrap, nunca por queries diretas ao Supabase a partir do cliente:

- `GET /api/app/bootstrap/public` — dados anônimos. Atletas/leaderboard passam por `sanitizeNamePII` ([src/lib/bootstrapPayload.ts](src/lib/bootstrapPayload.ts)); inscrições individuais não são expostas, apenas `registrationsCount` agregado.
- `GET /api/app/bootstrap` (privado) — exige sessão; retorna dados completos conforme o papel do usuário.

[src/context/AppContext.tsx](src/context/AppContext.tsx) decide qual chamar (`fetchBootstrapPayload(preferPrivate)`), normaliza as rows snake_case do banco para os tipos camelCase de [src/types/index.ts](src/types/index.ts) (ver os `mapXFromDb`), e expõe tudo via `useApp()`. Componentes consomem esse contexto — **não** importam `supabase` diretamente para ler domínio.

### Camada de acesso a dados

- `supabase` ([src/lib/supabase.ts](src/lib/supabase.ts)) — client **anon**, uso restrito. A maior parte do banco está protegida por RLS; leitura pública direta foi removida (ver migration `..._api_surface_hardening.sql`).
- `createSupabaseAdmin()` ([src/lib/serverSecurity.ts](src/lib/serverSecurity.ts)) — client **service role**, somente em rotas de API server-side. É por aqui que toda escrita e leitura sensível acontece.

### Sessão e autenticação (custom, não Supabase Auth)

Auth é implementada à mão em [src/lib/serverSecurity.ts](src/lib/serverSecurity.ts):

- Senhas: scrypt com prefixo `scrypt$salt$hash` (`hashPassword`/`verifyPassword`, com `needsRehash` para legados).
- Sessão: token HMAC-SHA256 (`WODA_SESSION_SECRET`) em cookie `woda_session` HttpOnly, 12h. Nada de JWT de terceiros.
- Rotas protegem-se com `requireSession(request, ['owner'|'manager'|'athlete'])`, que retorna `{ user }` ou `{ response }` (401/403).
- Existe também um token efêmero separado (`createRegistrationAccessToken`/`verifyRegistrationAccessToken`) para dar acesso ao fluxo de checkout sem sessão completa.
- `checkRateLimit` é um rate limiter **em memória** (não distribuído — reinicia com o processo).

### Mutações administrativas centralizadas

Toda escrita de evento/divisão/workout/score passa por `POST /api/admin/persistence` ([src/app/api/admin/persistence/route.ts](src/app/api/admin/persistence/route.ts)) — um dispatcher por `action`. O cliente chama `adminPersist(action, payload)` (em AppContext). O endpoint:
1. exige sessão `manager`/`owner`;
2. valida validade do gestor com `assertManagerOperationalAccess`;
3. verifica ownership (`ensureEventOwner`/`ensureDivisionOwner`/`ensureWorkoutOwner`) — `owner` pode tudo, `manager` só os próprios eventos.

Ao adicionar uma operação administrativa, adicione um `case` aqui em vez de criar query no cliente.

### Validade de acesso do gestor (manager access)

[src/lib/managerAccess.ts](src/lib/managerAccess.ts) (puro) + `serverManagerAccess.ts` (enforcement). Um `manager` tem `serviceValidUntil`; o status (`active`/`expiring_soon`/`expired`/`unconfigured`) é calculado no fuso `America/Fortaleza`. Gestor `expired` é bloqueado de operar e de vender — checagens entram em rotas de persistência e checkout.

### Checkout Mercado Pago (marketplace split)

Fluxo em `/api/checkout/*` apoiado por [src/lib/serverCheckout.ts](src/lib/serverCheckout.ts) e [src/lib/mercadopagoServer.ts](src/lib/mercadopagoServer.ts). Cada evento liga-se a uma conta Mercado Pago conectada via OAuth (`mercadopago_accounts`); cobra-se `application_fee` (marketplace) calculada de `marketplaceFee`. Pagamentos: cartão (tokenizado no client via SDK), PIX, e preference (redirect). Confirmação assíncrona chega em `/api/webhooks/mercadopago` (valida `MERCADOPAGO_WEBHOOK_SECRET`); o `paymentStatus` da inscrição é a fonte de verdade, não a resposta síncrona.

### Dois tipos de evento

`eventType: 'functional_fitness' | 'fitness_racing'`. Fitness racing tem lógica própria de percurso/estações e faixas etárias em [src/lib/fitnessRacing.ts](src/lib/fitnessRacing.ts) (ex.: `buildFitnessRacingCourse`, `getAgeGroupFromDate`). Ao mexer em divisões/leaderboard, cheque qual tipo está em jogo.

### Telas (App Router)

`src/app/page.tsx` (home pública), `admin/` (gestão de eventos + login), `owner/` (painel do dono da plataforma), `event/[id]/` (página pública do evento + `leaderboard/`), `termos/`. Os arquivos `admin/page.tsx` e `event/[id]/page.tsx` são grandes e concentram muita UI.

## Testing

Os testes (`tests/*.test.mjs`, `node:test`) são majoritariamente **regressão estática**: leem arquivos-fonte/migrations e fazem `assert.match` sobre o conteúdo para garantir que invariantes de segurança/contrato não regridam (ex.: RLS habilitado, policies públicas removidas, PII sanitizada). Não sobem servidor nem banco. Logo, **renomear símbolos ou reescrever trechos pode quebrar um teste mesmo sem mudança de comportamento** — rode `npm test` após refactors e ajuste a asserção junto.

## Conventions

- Import alias: `@/*` → `src/*`.
- Banco é snake_case; tipos do app são camelCase. Faça a tradução nos mappers do AppContext / payload helpers, não espalhe snake_case pela UI.
- Variáveis de ambiente do app (distintas das chaves do AIOX em `.env.example`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WODA_SESSION_SECRET`, `MERCADOPAGO_CLIENT_ID/CLIENT_SECRET/REDIRECT_URI/WEBHOOK_SECRET`, `MERCADOPAGO_PLATFORM_USER_ID` (id da conta Mercado Pago dona da aplicação marketplace — o MP recusa `application_fee` quando o vendedor é essa própria conta, então ela é bloqueada como conta de gestor), `RESEND_API_KEY`/`RESEND_FROM_EMAIL`, `WODARENA_OWNER_EMAIL`, `COMMERCIAL_LEADS_OWNER_EMAIL`, `APP_URL`/`NEXT_PUBLIC_APP_URL`.
- Segurança HTTP (CSP, HSTS, etc.) é definida em [next.config.ts](next.config.ts); a allowlist de CSP precisa acompanhar qualquer novo domínio externo (Supabase/Mercado Pago já liberados). Ver [SECURITY-HEADERS.md](SECURITY-HEADERS.md).
- Migrations em `supabase/migrations/` (snapshot ordenado por timestamp). Mudança de schema acompanha migration nova; não edite migrations já aplicadas.

## AIOX framework

Este repo opera sob o meta-framework Synkra AIOX. Stories de desenvolvimento ficam em `docs/stories/` (`{epic}.{story}.story.md`) e regras de agentes/workflow em `.claude/` — ver [.claude/CLAUDE.md](.claude/CLAUDE.md) para o sistema de agentes, boundaries L1–L4 e a constitution. `git push` e criação de PR são exclusivos do agente @devops.
