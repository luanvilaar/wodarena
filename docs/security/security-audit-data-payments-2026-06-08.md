# Auditoria de Seguranca: Dados, Pagamentos e Mercado Pago

Data: 2026-06-08
Escopo: cadastro de usuarios/atletas, dados sensiveis, transacoes financeiras, cartao de credito, Pix, chaves de acesso de gestores e integracao Mercado Pago.

## Sumario Executivo

Veredito: FAIL para producao.

O sistema possui falhas criticas de autenticacao, autorizacao e protecao de dados sensiveis. A maior parte do risco vem de uma combinacao de:

- APIs server-side usando `SUPABASE_SERVICE_ROLE_KEY` e aceitando identificadores vindos do cliente sem sessao assinada.
- RLS desabilitado em tabelas operacionais com PII.
- Senhas e tokens Mercado Pago persistidos em texto claro.
- Checkout financeiro calculando valores a partir de payload controlado pelo cliente.
- Sessao de usuario baseada em `localStorage`, sem token server-side verificavel.

## Acompanhamento de Implementacao - 2026-06-08

Status desta rodada:

- Implementado helper server-side de sessao assinada por cookie HttpOnly e hashing de senha.
- Rotas administrativas de usuarios e Mercado Pago passaram a derivar o ator autenticado do cookie, nao do body.
- Checkout Pix/cartao/preference passou a usar snapshot de inscricao persistido no servidor, com metadata opaca.
- Webhook Mercado Pago passou a validar assinatura quando `MERCADOPAGO_WEBHOOK_SECRET` estiver configurado e a conciliar por `registration_id`.
- Criada migration baseline de RLS: `supabase/migrations/20260608120000_reenable_rls_security_baseline.sql`.
- Mutacoes administrativas antes feitas no `AppContext` via cliente Supabase anonimo foram movidas para `src/app/api/admin/persistence/route.ts`, com `requireSession` e checagem de posse do evento.
- Carga inicial do app foi movida para `src/app/api/app/bootstrap/route.ts`; o bootstrap anonimo nao retorna email, telefone ou tamanho de camisa de atletas.

Risco residual antes de producao:

- Aplicar a migration de RLS primeiro em staging e validar os fluxos de owner, gestor, atleta e visitante anonimo.
- Revisar as policies definitivas com testes de banco por papel; a migration atual e uma baseline conservadora.
- Resolver o `npm audit` de `postcss` via atualizacao segura de Next quando houver versao compativel, pois o fix automatico sugerido e quebravel.

## Achados Criticos

### SEC-001: Senhas em texto claro

Severidade: Critica

Evidencia:

- `supabase/migrations/20260605200000_secure_users_table.sql:2-5` cria `users_secrets.password TEXT NOT NULL`.
- `src/app/api/auth/login/route.ts:41-55` busca a senha e compara `secret.password !== password`.
- `src/app/api/admin/create-user/route.ts:59-65` grava a senha recebida diretamente.
- `src/app/api/auth/change-password/route.ts:49-52` atualiza a nova senha diretamente.
- `src/app/api/auth/reset-password/route.ts:49-54` faz upsert da nova senha diretamente.
- `src/app/api/registrations/start/route.ts:122-127` grava senha do atleta em texto claro.
- `src/data/mockData.ts:3-27` contem credenciais padrao de owner/gestores.

Impacto:

Qualquer vazamento de banco, log interno ou abuso de `service_role` compromete todas as contas. Tambem impede um modelo seguro de recuperacao e troca de senha.

Correcao recomendada:

Migrar para hash de senha forte com `bcrypt`, `argon2id` ou Supabase Auth. Criar migration que re-hashe senhas existentes no proximo login ou force reset. Nunca retornar nem armazenar senha em `User`.

### SEC-002: Ausencia de autenticacao/autorizacao real nas APIs administrativas

Severidade: Critica

Evidencia:

- `src/app/api/admin/create-user/route.ts:21-25` recebe dados de novo gestor e nao valida que o solicitante e owner autenticado.
- `src/app/api/admin/mercadopago/route.ts:34-55` recebe `userId` do body e apenas confere se aquele `userId` existe e tem role manager/owner.
- `src/app/api/admin/mercadopago/route.ts:136-194` permite desconectar Mercado Pago de qualquer manager/owner se o atacante informar o `userId`.
- `src/context/AppContext.tsx:445-458` chama `/api/admin/create-user` sem enviar token de sessao verificavel.
- `src/app/admin/page.tsx:299-345` envia `userId`, `publicKey` e `accessToken` diretamente do cliente.

Impacto:

Um usuario nao autenticado pode criar gestores, sobrescrever credenciais Mercado Pago de gestores existentes ou desconectar contas. A checagem atual valida o alvo, nao o autor da acao.

Correcao recomendada:

Implementar sessao server-side assinada. Em cada rota admin, derivar o usuario autenticado do token/cookie, nunca do body. Exigir role `owner` para criar gestores e exigir `currentUser.id === targetUserId` ou permissao owner para alterar Mercado Pago.

### SEC-003: RLS desabilitado em tabelas com PII e dados operacionais

Severidade: Critica

Evidencia:

- `supabase/migrations/20260603002000_disable_rls.sql:4-10` desabilita RLS para `users`, `events`, `divisions`, `workouts`, `athletes`, `scores`, `registrations`.
- `supabase/migrations/20260605190000_disable_rls_mercadopago_accounts.sql:1-2` desabilita RLS em `mercadopago_accounts`.
- `supabase/migrations/20260605220000_disable_rls_coupons.sql:1-2` desabilita RLS em `coupons`.
- `src/context/AppContext.tsx:141-247` le `users`, `athletes`, `registrations`, `coupons`, `events`, `divisions`, `workouts`, `mercadopago_accounts` via cliente anonimo.

Impacto:

Com a anon key publica, qualquer cliente pode consultar dados pessoais de atletas e gestores, inscricoes, telefones, emails, datas de nascimento e contas Mercado Pago publicas. Tambem pode haver escrita indevida onde o client usa `supabase.from(...).insert/update/delete`.

Correcao recomendada:

Reabilitar RLS em todas as tabelas. Criar policies por papel e posse: publico le apenas eventos publicados e dados publicos minimos; atleta le apenas suas inscricoes; gestor le e altera apenas seus eventos; owner tem acesso administrativo. Mover mutacoes criticas para APIs autenticadas.

### SEC-004: Checkout aceita valores financeiros controlados pelo cliente

Severidade: Critica

Evidencia:

- `src/app/api/registrations/start/route.ts:184-205` persiste `ticket_price`, `quantity`, `total_paid`, `coupon_code` vindos de `registrationData`.
- `src/app/api/checkout/card/route.ts:88-99` calcula `transactionAmount` usando `registrationData.totalPaid`.
- `src/app/api/checkout/pix/route.ts:40-47` calcula `transactionAmount` usando `registrationData.totalPaid`.
- `src/app/api/checkout/preference/route.ts:35-49` calcula `unit_price` usando `registrationData.totalPaid`.
- `src/components/CardPaymentModal.tsx:190-205` monta `registrationData.totalPaid` no browser.
- `src/components/PixPaymentModal.tsx:135-149` monta `registrationData.totalPaid` no browser.

Impacto:

Um atacante pode alterar o payload no browser e pagar valor menor, registrar inscricao em categoria/evento indevido ou manipular cupom/quantidade.

Correcao recomendada:

Servidor deve receber apenas `eventId`, `divisionId`, dados do atleta e metodo de pagamento. Recalcular preco, cupom, quantidade, disponibilidade e total a partir do banco dentro da API. Persistir um `registrationId` com snapshot server-side e usar esse registro como fonte unica para Pix/cartao/preference.

### SEC-005: Webhook Mercado Pago sem verificacao de assinatura/origem

Severidade: Alta

Evidencia:

- `src/app/api/webhooks/mercadopago/route.ts:24-57` aceita notificacao sem validar assinatura `x-signature`/`x-request-id` ou segredo de webhook.
- `src/app/api/webhooks/mercadopago/route.ts:51-57` aceita `event_id` da query para escolher credenciais.
- `src/app/api/webhooks/mercadopago/route.ts:77-99` usa `metadata.registration_json` retornado do pagamento para atualizar inscricao.

Impacto:

Embora a rota consulte o Mercado Pago antes de aprovar, a origem do webhook nao e autenticada e `event_id` controlado por query pode causar processamento indevido, ruido operacional e tentativas de conciliacao com credenciais de outro evento.

Correcao recomendada:

Validar assinatura oficial do Mercado Pago, rejeitar webhooks sem assinatura valida, registrar idempotencia por `payment_id` e vincular `payment_id` a inscricao/evento ja existente no banco antes de aplicar atualizacao.

### SEC-006: Dados sensiveis em metadata do Mercado Pago

Severidade: Alta

Evidencia:

- `src/app/api/checkout/card/route.ts:109-115` envia CPF e `registrationData`/`athleteProfile` serializados em `metadata`.
- `src/app/api/checkout/pix/route.ts:58-64` envia CPF e dados completos de inscricao/atleta em `metadata`.
- `src/app/api/checkout/preference/route.ts:25-31` envia dados completos em `metadata`.
- `src/app/api/checkout/status/route.ts:143-148` retorna `registrationData`, `athleteProfile` e CPF do metadata.

Impacto:

PII desnecessaria fica duplicada em provedor externo e pode voltar para clientes sem autenticacao via status endpoint.

Correcao recomendada:

Enviar apenas identificadores opacos: `registration_id`, `event_id`, `user_id` se necessario. CPF deve ser usado somente no payload do pagador quando exigido pelo gateway, nao em metadata. Status endpoint deve retornar somente status publico minimo ou exigir autenticacao/ownership.

### SEC-007: Sessao em localStorage sem token verificavel

Severidade: Alta

Evidencia:

- `src/hooks/useLocalStorage.ts:13-17` carrega o usuario do browser storage.
- `src/hooks/useLocalStorage.ts:33-35` persiste o usuario em localStorage.
- `src/context/AppContext.tsx:431` salva `data.user` como `currentUser`.
- Rotas administrativas nao validam cookie/JWT server-side.

Impacto:

Qualquer usuario pode manipular `woda_current_user` no browser para alterar a UI. Como algumas APIs tambem confiam em `userId` enviado do cliente, isso vira vetor de ataque real.

Correcao recomendada:

Usar cookies HttpOnly/Secure/SameSite com JWT ou Supabase Auth. No server, validar token e role em todas as rotas sensiveis. LocalStorage pode guardar apenas preferencias nao sensiveis.

## Achados Altos e Medios

### SEC-008: Endpoint de segunda via de e-mail sem autenticacao

Severidade: Alta

Evidencia:

- `src/app/api/checkout/email/route.ts:14-29` aceita `registrationId` e busca inscricao por service role.
- `src/app/api/checkout/email/route.ts:128-136` dispara e-mail sem validar que o solicitante e atleta dono, gestor do evento ou owner.

Impacto:

Pode ser abusado para spam, enumeracao de inscricoes ou reenvio indevido de comprovantes.

Correcao recomendada:

Exigir autenticacao e ownership, ou token publico de segunda via com escopo e expiracao. Aplicar rate limit por IP/usuario/registration.

### SEC-009: Rate limiting ausente em login, reset e pagamentos

Severidade: Alta

Evidencia:

- `src/app/api/auth/login/route.ts:21-61` nao limita tentativas.
- `src/app/api/auth/request-password-reset/route.ts:31-97` nao limita solicitacoes por IP/email.
- `src/app/api/checkout/card/route.ts:63-162` nao limita tentativas de pagamento por inscricao/IP.

Impacto:

Facilita brute force, enumeracao operacional, abuso de gateway e custos externos.

Correcao recomendada:

Adicionar rate limit por IP, email, usuario e registrationId. Registrar tentativas falhas e bloquear progressivamente.

### SEC-010: Idempotency key de cartao usa timestamp

Severidade: Media

Evidencia:

- `src/app/api/checkout/card/route.ts:125` usa `card-${registrationData.id}-${Date.now()}`.

Impacto:

Reenvios do mesmo pagamento podem gerar multiplas cobrancas em vez de deduplicar.

Correcao recomendada:

Usar chave estavel por tentativa de pagamento server-side, por exemplo `card-${registrationId}-${paymentAttemptId}`.

### SEC-011: Fallbacks hardcoded de Supabase

Severidade: Media

Evidencia:

- `src/lib/supabase.ts:3-5` contem URL de projeto e anon key fallback.
- Varias APIs usam fallback para `https://momigbtnsswoldqnadmc.supabase.co`.

Impacto:

Ambientes mal configurados podem apontar para projeto indevido. Isso aumenta risco de vazamento e dificulta isolamento entre dev/staging/prod.

Correcao recomendada:

Remover fallbacks reais. Falhar o boot/build quando variaveis obrigatorias nao estiverem configuradas.

### SEC-012: Logs com PII e detalhes operacionais

Severidade: Media

Evidencia:

- `src/app/api/auth/login/route.ts:36-60` loga emails e resultado de login.
- `src/app/api/admin/create-user/route.ts:28-74` loga emails de gestores.
- `src/app/api/admin/mercadopago/route.ts:86-127` loga operacao de credenciais por gestor.

Impacto:

Logs podem expor dados pessoais e facilitar enumeracao/ataques internos.

Correcao recomendada:

Mascarar emails/IDs, usar logs estruturados com niveis e nunca registrar dados de pagamento, token, CPF ou senha.

## Evidencia Positiva

- `src/components/CardPaymentModal.tsx:150-161` tokeniza cartao com SDK do Mercado Pago no cliente; PAN/CVV nao sao enviados diretamente para a API propria, apenas token.
- `supabase/migrations/20260605210000_secure_mercadopago_accounts.sql:1-8` separa `mercadopago_secrets` de `mercadopago_accounts`.
- `supabase/migrations/20260607103000_password_reset_tokens.sql:2-15` armazena hash de token de reset e habilita RLS.
- `src/app/api/auth/request-password-reset/route.ts:53-55` evita enumeracao direta de email no reset.

Esses pontos nao mitigam os achados criticos enquanto APIs sem autenticacao, RLS desabilitado e senhas/tokens em texto claro permanecerem.

## Plano de Correcao Prioritario

1. Bloquear superficie critica:
   - Reabilitar RLS em tabelas operacionais.
   - Desabilitar temporariamente endpoints admin sensiveis sem sessao verificavel.
   - Remover criacao publica de gestores via `/api/admin/create-user`.

2. Autenticacao e autorizacao:
   - Migrar para Supabase Auth ou cookies HttpOnly com JWT assinado.
   - Criar helper server-side `requireUser()` e `requireRole()`.
   - Cobrir todas as rotas admin, checkout status/e-mail e mutacoes.

3. Senhas:
   - Hash com algoritmo forte.
   - Migration de reset/rehash.
   - Remover credenciais demo reais e impedir fallback de usuarios mock em producao.

4. Checkout:
   - Recalcular preco/cupom/quantidade no servidor.
   - Usar inscricao server-side como fonte de verdade.
   - Metadata Mercado Pago deve conter apenas IDs opacos.

5. Mercado Pago:
   - Criptografar `mercadopago_secrets.access_token` e `refresh_token` em repouso, ou armazenar em vault/KMS.
   - Validar assinatura do webhook.
   - Vincular pagamento a registro existente antes de aprovar.

6. Observabilidade segura:
   - Rate limit em login/reset/checkout/email.
   - Logs sem PII.
   - Alertas para alteracoes de credenciais Mercado Pago e tentativas falhas.

## Testes Recomendados

- Teste que usuario anonimo nao consegue criar manager.
- Teste que manager A nao consegue salvar/deletar Mercado Pago do manager B.
- Teste que atleta nao acessa inscricoes de outro atleta.
- Teste que `totalPaid` manipulado no client e ignorado pelo servidor.
- Teste que cupom expirado/limite esgotado e rejeitado server-side.
- Teste que webhook sem assinatura valida e rejeitado.
- Teste que `password` salvo nunca e igual ao texto original.
- Teste que anon key nao consegue `select *` em `registrations`, `athletes`, `users`, `mercadopago_accounts`.

## Gates Executados

Executados em 2026-06-08:

- `npm run lint`: passou, com 19 warnings pre-existentes/nao bloqueantes reportados pelo ESLint.
- `npm run typecheck`: passou.
- `npm test`: passou, 48/48 testes.
- `npm audit`: falhou com 2 vulnerabilidades moderadas em `postcss` via `next`. O fix sugerido pelo npm e `npm audit fix --force`, mas ele rebaixa/instala versao quebravel de Next segundo a propria saida, entao nao deve ser aplicado automaticamente sem avaliacao.

Observacao: os testes atuais cobrem fluxos funcionais de Mercado Pago, reset de senha e persistencia, mas nao provam autorizacao server-side, RLS por papel, hashing de senha ou validacao financeira server-side.
