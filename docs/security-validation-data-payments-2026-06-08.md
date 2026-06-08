# Auditoria de Validacao: Dados, Pagamentos e RLS

Data: 2026-06-08
Escopo: validacao das correcoes aplicadas apos `docs/security-audit-data-payments-2026-06-08.md`.

## Veredito

Status: PASS WITH RESIDUAL CONCERNS.

As correcoes principais foram implementadas: senhas agora usam hash, sessao server-side assinada foi adicionada, rotas administrativas sensiveis derivam o ator autenticado do cookie, checkout recalcula valores no servidor, metadata Mercado Pago foi reduzida e as mutacoes do `AppContext` foram movidas para APIs server-side.

Atualizacao desta rodada:

1. `checkout/status` agora retorna snapshot completo apenas para atleta dono, gestor do evento ou owner.
2. `app/bootstrap` agora retorna todos os usuarios apenas para owner; manager e atleta recebem apenas o proprio usuario.
3. Webhook Mercado Pago foi simplificado para atualizar inscricao existente por `registration_id + event_id`, sem upsert legado de atleta/registration.
4. Rotas de pagamento por cartao e Pix receberam rate limit por IP, inscricao e metodo.

Ainda exige validacao operacional antes de producao:

1. Rodar staging com RLS ativo e validar fluxos por papel.
2. Resolver ou aceitar explicitamente o risco de `npm audit` em `postcss` via `next`.

## Achados de Validacao

### VAL-001: Checkout status publico ainda expoe PII

Status: Resolvido nesta rodada.
Severidade anterior: Alta

Evidencia:

- `src/app/api/checkout/status/route.ts` usa `getRequestSession(request)`.
- `src/app/api/checkout/status/route.ts` aplica `canReadRegistrationSnapshot` antes de carregar `registrationData` e `athleteProfile`.
- Chamadas anonimas continuam podendo consultar status minimo, mas recebem `registrationData: null` e `athleteProfile: null`.

Risco residual:

O endpoint ainda faz conciliacao publica de status por identificador de pagamento/inscricao. O payload sensivel foi removido do caminho anonimo; se o produto exigir sigilo ate do status, usar token opaco de curta duracao.

### VAL-002: Bootstrap autenticado retorna todos os usuarios para manager/atleta

Status: Resolvido nesta rodada.
Severidade anterior: Alta

Evidencia:

- `src/app/api/app/bootstrap/route.ts` seleciona todos os usuarios apenas quando `session?.role === 'owner'`.
- Para sessoes de manager e athlete, a query aplica `.eq('id', session.id)`.

Risco residual:

Gestores continuam recebendo dados completos de atletas vinculados aos seus eventos, o que e esperado para o painel administrativo. Validar em staging que atletas logados nao recebem PII de outros atletas alem do necessario para leaderboard/perfil publico.

### VAL-003: Webhook ainda tem caminho legado redundante de upsert

Status: Resolvido nesta rodada.
Severidade anterior: Media

Evidencia:

- `src/app/api/webhooks/mercadopago/route.ts` exige `metadata.registration_id`.
- A rota busca a inscricao existente por `id` e `event_id`.
- A rota atualiza status/payment data e nao faz `registrations.upsert`.
- Cupom e e-mail sao processados apenas na transicao para `payment_approved`.

Risco residual:

Webhook ainda depende de `event_id` na query para resolver credenciais Mercado Pago. Isso esta consistente com as rotas de checkout atuais, mas deve ser validado contra assinatura/metadata em staging.

### VAL-004: RLS baseline e conservadora, mas ainda nao prova politicas por papel

Severidade: Media

Evidencia:

- `supabase/migrations/20260608120000_reenable_rls_security_baseline.sql:4-12` reabilita RLS nas tabelas operacionais.
- `supabase/migrations/20260608120000_reenable_rls_security_baseline.sql:51-69` nega SELECT anonimo em `users`, `athletes`, `registrations` e `coupons`.
- A migration nao cria policies de `INSERT/UPDATE/DELETE` por papel; o app depende das APIs com service role para mutacoes.

Risco:

Esse desenho pode funcionar porque as mutacoes passaram para APIs server-side, mas ainda precisa ser validado em staging. Sem testes de banco por papel, nao ha prova de que visitante, atleta, manager e owner enxergam exatamente o esperado quando RLS estiver ativo.

Recomendacao:

Adicionar testes de policies Supabase por role/cenario, ou rodar uma bateria manual em staging antes de aplicar em producao. Validar pelo menos: visitante anonimo, atleta dono, atleta nao dono, manager dono do evento, manager nao dono, owner.

### VAL-005: Rate limit de pagamento ainda pendente

Status: Resolvido nesta rodada.
Severidade anterior: Media

Evidencia:

- `src/app/api/auth/login/route.ts:22-28` agora tem rate limit de login.
- `src/app/api/auth/request-password-reset/route.ts` tambem usa rate limit.
- `src/app/api/checkout/card/route.ts` aplica `checkRateLimit` com chave `checkout:{ip}:{registrationId}:card`.
- `src/app/api/checkout/pix/route.ts` aplica `checkRateLimit` com chave `checkout:{ip}:{registrationId}:pix`.

Risco residual:

O rate limit atual e em memoria do processo. Em ambiente serverless/multiplas instancias, considerar storage compartilhado para bloqueio consistente.

## Status dos Achados Originais

- SEC-001 senhas em texto claro: mitigado para novos writes e rehash em login.
- SEC-002 APIs administrativas sem auth real: mitigado nas rotas revisadas.
- SEC-003 RLS desabilitado: parcialmente mitigado; migration baseline existe, mutacoes criticas foram movidas para APIs, mas requer staging/teste por papel.
- SEC-004 checkout aceita valores do cliente: mitigado para calculo financeiro principal.
- SEC-005 webhook sem assinatura: mitigado para producao quando `MERCADOPAGO_WEBHOOK_SECRET` estiver configurado; fluxo legado removido.
- SEC-006 PII em metadata Mercado Pago: mitigado nas rotas de checkout revisadas.
- SEC-007 sessao so em localStorage: parcialmente mitigado; cookie HttpOnly existe, mas UI ainda guarda `currentUser` no localStorage para estado local.
- SEC-008 segunda via de email sem auth: parcialmente mitigado por rate limit e status aprovado; ainda nao ha ownership/token publico.
- SEC-009 rate limit ausente: mitigado em login/reset/email e rotas de pagamento principais; considerar storage compartilhado.
- SEC-010 idempotency key com timestamp: mitigado para cartao e Pix por registration id.
- SEC-011 fallbacks hardcoded Supabase: mitigado.

## Evidencia de Execucao

- `npm run typecheck`: PASS.
- `npm test`: PASS, 54/54.
- `npm run lint`: PASS com 19 warnings existentes.
- `npm audit`: FAIL por 2 vulnerabilidades moderadas em `postcss` via `next`; `npm audit fix --force` sugere downgrade/alteracao quebravel.

## Proxima Acao Recomendada

Executar staging com RLS ativo antes de qualquer deploy de producao. Validar visitante anonimo, atleta dono, atleta nao dono, manager dono do evento, manager nao dono e owner.
