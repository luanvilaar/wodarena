# Auditoria de APIs Expostas — 2026-06-21

## Escopo

- Rotas Next em `src/app/api/**`
- Server actions do App Router
- Uso direto de Supabase no frontend
- Exposição pública via Supabase REST/RPC derivada de RLS/policies/migrations
- Uso de `SUPABASE_SERVICE_ROLE_KEY`
- Permissões por papel (`athlete`, `manager`, `owner`)

## Resumo Executivo

- Foram encontradas **23 rotas** em `src/app/api`.
- **Nenhuma server action** foi encontrada no código pesquisado.
- **Nenhuma chamada direta ao Supabase no frontend** foi encontrada; o cliente público existe em `src/lib/supabase.ts`, mas não está importado em outros arquivos `src/**`.
- A aplicação depende fortemente de **APIs server-side com `service_role`**, inclusive em rotas públicas.
- Há **exposição pública relevante** em duas camadas:
  - endpoints Next públicos;
  - endpoints diretos do Supabase (REST/RPC) implícitos por RLS/policies.
- O modelo de permissão atual vive principalmente na **camada de aplicação**, não no banco. No banco, hoje há uma mistura de:
  - tabelas com leitura pública ampla;
  - tabelas com RLS habilitado mas sem políticas granulares por papel;
  - tabelas criadas sem RLS.

## Evidências de Escopo

- Server actions: `rg "use server|formAction|action=\\{" src` sem resultados.
- Supabase no frontend: apenas `src/lib/supabase.ts` instancia `createClient(...)`; não há imports desse cliente fora do próprio arquivo.
- Papel `coach`: não foi encontrado no schema nem nas rotas.
- Papel `admin`: não existe como role separada; na prática, `owner` é o superusuário administrativo. A rota `/admin` é compartilhada por `athlete`, `manager` e `owner`.

## 1. Inventário de Endpoints Encontrados

### 1.1 Públicos ou com sessão opcional

| Endpoint | Métodos | Auth | Usa `service_role` | Retorno / comportamento | Sensibilidade |
| --- | --- | --- | --- | --- | --- |
| `/api/app/bootstrap` | `GET` | Pública, sessão opcional | Sim | Carrega bootstrap global com `users`, `athletes`, `scores`, `registrations`, `events`, `divisions`, `workouts`, `mercadopagoAccounts`, `leaderboardEntries` | Alta |
| `/api/auth/login` | `POST` | Pública | Sim | Autentica por e-mail/senha e emite cookie de sessão | Média |
| `/api/auth/logout` | `POST` | Pública | Não | Limpa cookie | Baixa |
| `/api/auth/request-password-reset` | `POST` | Pública | Sim | Gera token de reset para `manager` e `athlete` | Média |
| `/api/auth/reset-password` | `POST` | Pública | Sim | Redefine senha via token | Alta |
| `/api/checkout/card` | `POST` | Pública | Sim | Cobra cartão e atualiza a inscrição pelo `registrationId` informado | Alta |
| `/api/checkout/config` | `GET` | Pública | Sim, via `mercadopagoServer` | Retorna `publicKey` do evento | Baixa |
| `/api/checkout/coupon` | `POST` | Pública | Sim | Valida cupom e retorna desconto/total | Média |
| `/api/checkout/email` | `POST` | Pública | Sim | Lê inscrição/evento/atleta e envia comprovante por e-mail | Alta |
| `/api/checkout/pix` | `POST` | Pública | Sim | Gera cobrança Pix e atualiza a inscrição pelo `registrationId` informado | Alta |
| `/api/checkout/preference` | `POST` | Pública | Sim | Cria preferência Mercado Pago e atualiza a inscrição pelo `registrationId` informado | Alta |
| `/api/checkout/status` | `GET` | Sessão opcional | Sim | Consulta Mercado Pago e atualiza status da inscrição; devolve snapshot completo se o ator puder ler | Alta |
| `/api/commercial-leads` | `POST` | Pública | Sim | Cadastra lead comercial | Média |
| `/api/registrations/start` | `POST` | Pública | Sim | Cria/atualiza `users`, `users_secrets`, `athletes`, `registrations` | Crítica |
| `/api/webhooks/mercadopago` | `POST` | Pública, assinatura esperada | Sim | Processa webhook Mercado Pago e atualiza a inscrição | Alta |

### 1.2 Endpoints autenticados

| Endpoint | Métodos | Auth exigida | Usa `service_role` | Retorno / comportamento | Sensibilidade |
| --- | --- | --- | --- | --- | --- |
| `/api/admin/create-user` | `POST`, `PUT` | `owner` | Sim | Cria gestor e atualiza validade de uso | Alta |
| `/api/admin/mercadopago` | `GET`, `POST`, `DELETE` | `manager` ou `owner` | Sim | Lê/grava/remove credenciais Mercado Pago | Crítica |
| `/api/admin/persistence` | `POST` | `manager` ou `owner` | Sim | Multiplexa mutações administrativas de eventos/divisões/provas/cupons/inscrições/scores | Crítica |
| `/api/athlete/profile` | `GET`, `PATCH` | `athlete` | Sim | Lê e atualiza perfil do atleta | Alta |
| `/api/auth/change-password` | `POST` | Sessão válida | Sim | Altera senha do próprio usuário ou de outro usuário com validação de senha atual | Alta |
| `/api/commercial-leads` | `GET` | `owner` | Sim | Lista leads comerciais | Alta |
| `/api/contestations` | `GET` | `athlete`, `manager` ou `owner` | Sim | Lista contestações com filtro por papel | Alta |
| `/api/contestations` | `POST` | `athlete` | Sim | Cria contestação | Alta |
| `/api/contestations/[id]` | `PATCH` | `manager` ou `owner` | Sim | Decide contestação e dispara e-mail ao atleta | Alta |
| `/api/mercadopago/oauth/callback` | `GET` | `manager` ou `owner` | Sim | Troca `code` OAuth por tokens e grava credenciais | Crítica |

## 2. Quais São Públicos

### 2.1 Públicos no Next API

- `GET /api/app/bootstrap`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/auth/request-password-reset`
- `POST /api/auth/reset-password`
- `GET /api/checkout/config`
- `POST /api/checkout/coupon`
- `POST /api/checkout/preference`
- `POST /api/checkout/pix`
- `POST /api/checkout/card`
- `GET /api/checkout/status`
- `POST /api/checkout/email`
- `POST /api/commercial-leads`
- `POST /api/registrations/start`
- `POST /api/webhooks/mercadopago`

### 2.2 Públicos no Supabase (REST/RPC)

Observação: esta parte é uma **inferência baseada nas migrations/RLS do projeto e no comportamento padrão do Supabase**, porque não há revogações explícitas de grants nas migrations e o projeto usa o padrão Supabase de expor schema `public` via `anon`/`authenticated`.

| Superfície Supabase | Motivo | Exposição atual | Sensibilidade |
| --- | --- | --- | --- |
| `rest/v1/events` | Policy pública em `events` | Linhas públicas de eventos publicados; **todas as colunas da tabela** | Crítica por conter `mp_access_token` legado |
| `rest/v1/divisions` | Policy pública em `divisions` | Leitura pública de divisões de eventos publicados | Baixa |
| `rest/v1/workouts` | Policy pública em `workouts` | Leitura pública de provas de eventos publicados | Baixa |
| `rest/v1/scores` | Policy pública em `scores` com `USING (true)` | Leitura pública de todos os scores | Média |
| `rest/v1/leaderboard_entries` | Policy pública em `leaderboard_entries` | Leitura pública de leaderboard desnormalizado | Alta por incluir `birth_date` e `team_members` |
| `rest/v1/mercadopago_accounts` | Duas policies públicas coexistem | Leitura pública efetiva de todas as linhas | Alta |
| `rest/v1/contestations` | Tabela criada sem RLS | Provável CRUD público via anon/authenticated | Crítica |
| `rest/v1/commercial_leads` | Tabela criada sem RLS | Provável CRUD público via anon/authenticated | Crítica |
| `rest/v1/rpc/apply_coupon_usage` | `SECURITY DEFINER` + `GRANT EXECUTE TO anon, authenticated` | Chamada pública da função RPC | Alta |

## 3. Quais Exigem Autenticação

- `POST /api/admin/create-user` — `owner`
- `PUT /api/admin/create-user` — `owner`
- `GET /api/admin/mercadopago` — `manager` ou `owner`
- `POST /api/admin/mercadopago` — `manager` ou `owner`
- `DELETE /api/admin/mercadopago` — `manager` ou `owner`
- `POST /api/admin/persistence` — `manager` ou `owner`
- `GET /api/athlete/profile` — `athlete`
- `PATCH /api/athlete/profile` — `athlete`
- `POST /api/auth/change-password` — sessão válida
- `GET /api/commercial-leads` — `owner`
- `GET /api/contestations` — `athlete`, `manager` ou `owner`
- `POST /api/contestations` — `athlete`
- `PATCH /api/contestations/[id]` — `manager` ou `owner`
- `GET /api/mercadopago/oauth/callback` — `manager` ou `owner`

## 4. Quais Retornam Dados Sensíveis

### 4.1 Sem autenticação

| Endpoint / superfície | Dados sensíveis / excesso de dados |
| --- | --- |
| `GET /api/app/bootstrap` | Reexpõe `athletes` públicos com `birth_date`, `city`, `state`, `instagram`, `photo_url`, `team_members` em `sanitizePublicAthlete`; devolve também `leaderboardEntries` com `select('*')` |
| `rest/v1/events` | Pode expor `mp_access_token` legado porque a coluna está em `events` e a policy pública é por linha, não por coluna |
| `rest/v1/leaderboard_entries` | Expõe `birth_date` e `team_members` publicamente |
| `rest/v1/mercadopago_accounts` | Expõe `user_id`, `mercadopago_user_id`, `status`, `expires_at`, `public_key` com leitura pública efetiva |
| `rest/v1/commercial_leads` | Pode expor `phone`, `phone_normalized`, `owner_email_recipient`, `owner_email_error` |
| `rest/v1/contestations` | Pode expor `description`, `manager_note`, `lane`, `heat_id`, `status` |

### 4.2 Com autenticação

| Endpoint | Dados sensíveis |
| --- | --- |
| `GET/PATCH /api/athlete/profile` | Dados pessoais do atleta e suas inscrições |
| `GET /api/commercial-leads` | Leads comerciais completos |
| `GET/POST/PATCH /api/contestations*` | Relatos do atleta, observações do gestor, status, vínculo com inscrição |
| `POST /api/admin/persistence` | Inscrições, e-mails, telefones, atleta vinculado, score data |
| `GET/POST/DELETE /api/admin/mercadopago` | Fluxo administrativo que lida com tokens sensíveis no servidor |

## 5. Server Actions e Chamadas Diretas ao Supabase no Frontend

### 5.1 Server actions

- **Nenhuma encontrada**.

### 5.2 Chamadas diretas ao Supabase no frontend

- **Nenhuma encontrada** em `src/app/**`, `src/components/**` ou `src/context/**`.
- O cliente público existe em `src/lib/supabase.ts`, mas não foi encontrado uso prático desse cliente no frontend atual.
- O frontend hoje fala com dados principalmente via `fetch('/api/...')`.

## 6. Uso Incorreto de `service_role`

### 6.1 Casos críticos

1. `src/lib/serverSecurity.ts:29-40`
   - `createSupabaseAdmin()` usa `SUPABASE_SERVICE_ROLE_KEY`.
   - `getSessionSecret()` cai em `SUPABASE_SERVICE_ROLE_KEY` quando `WODA_SESSION_SECRET` não está configurado.
   - Isso mistura o segredo de sessão com a credencial administrativa do banco.

2. `src/app/api/app/bootstrap/route.ts:53-158`
   - Rota pública usa `service_role` para montar um payload grande e heterogêneo.
   - Na prática, a aplicação está substituindo RLS por filtragem manual em memória.

3. `src/app/api/registrations/start/route.ts:46-120`
   - Rota pública usa `service_role` para criar usuário, gravar segredo e escrever inscrição.
   - Também faz `upsert` em `users_secrets` para usuário atleta já existente.

4. `src/app/api/checkout/preference/route.ts:21-24`
   - A rota pública resolve inscrição e credenciais de pagamento apenas a partir de `registrationData.id`.

5. `src/app/api/checkout/pix/route.ts:28-31`
   - Mesmo padrão: rota pública com `service_role` e sem verificar posse da inscrição.

6. `src/app/api/checkout/card/route.ts:83-86`
   - Mesmo padrão para cartão.

7. `src/app/api/checkout/status/route.ts:63-75` e `82-151`
   - Rota pública consulta Mercado Pago e atualiza inscrições no banco.

8. `src/app/api/checkout/email/route.ts:27-143`
   - Rota pública lê PII completa da inscrição/atleta/evento e dispara e-mail.

### 6.2 Uso aceitável, mas ainda sensível

- `POST /api/auth/login`
- `POST /api/auth/request-password-reset`
- `POST /api/auth/reset-password`
- rotas administrativas autenticadas

Nesses casos o uso de `service_role` é compatível com a natureza server-side, mas ainda pede defesa em profundidade e menor acoplamento entre sessão e credencial do banco.

## 7. Tabelas Sem RLS

| Tabela | Evidência | Impacto |
| --- | --- | --- |
| `contestations` | Criada em `supabase/migrations/20260617113000_functional_fitness_contestations.sql` sem `ENABLE ROW LEVEL SECURITY` | Provável CRUD público via Supabase REST |
| `commercial_leads` | Criada em `supabase/migrations/20260620110000_commercial_leads.sql` sem `ENABLE ROW LEVEL SECURITY` | Provável CRUD público via Supabase REST |

## 8. Policies Públicas Demais

| Tabela / função | Evidência | Problema |
| --- | --- | --- |
| `events` | `supabase/migrations/20260608120000_reenable_rls_security_baseline.sql:14-17` | Policy pública por linha em tabela que também carrega `mp_access_token` legado |
| `scores` | `supabase/migrations/20260608120000_reenable_rls_security_baseline.sql:41-44` | `USING (true)` abre todos os scores |
| `leaderboard_entries` | `supabase/migrations/20260610100000_leaderboard_entries.sql:43-49` | Exposição pública de `birth_date` e `team_members` |
| `mercadopago_accounts` | `supabase/migrations/20260605210000_secure_mercadopago_accounts.sql:35-38` | Policy antiga `USING (true)` continua válida |
| `mercadopago_accounts` | `supabase/migrations/20260608120000_reenable_rls_security_baseline.sql:46-49` | Nova policy restringe a conectadas, mas não remove a antiga; juntas resultam em leitura pública efetiva |
| `apply_coupon_usage()` | `supabase/migrations/20260609100000_coupon_usage_tracking.sql:28-63` | `SECURITY DEFINER` com `GRANT EXECUTE` para `anon` e `authenticated` |

## 9. Permissões Atuais por Papel

| Papel | Estado atual | Observações |
| --- | --- | --- |
| `athlete` | Existe | Acesso é controlado nas rotas via `requireSession(...)`; não há policies RLS específicas por dono da inscrição |
| `manager` | Existe | Acesso é controlado nas rotas + checagem de posse do evento; não há políticas RLS específicas por organizador |
| `owner` | Existe | Atua como superusuário administrativo; na prática faz o papel de `admin` |
| `coach` | **Não existe** | Não há role, policy, rota ou modelagem específica para coach |
| `admin` | **Não existe como role** | O nome “admin” aparece na UI/rota `/admin`, mas a role real é `owner` ou `manager` |

### Conclusão sobre permissões

- A autorização por papel hoje é **predominantemente application-side**.
- O banco **não** implementa um modelo granular de least privilege para `athlete` e `manager`.
- Se uma rota pública com `service_role` falhar, **RLS não é a segunda linha de defesa** na maior parte dos fluxos.

## 10. Riscos Encontrados

### CRÍTICO 1 — `events.mp_access_token` potencialmente público

- Evidência:
  - `supabase/migrations/20260604002000_event_mercadopago_credentials.sql:1-3` adiciona `mp_access_token` em `events`.
  - `supabase/migrations/20260608120000_reenable_rls_security_baseline.sql:14-17` libera leitura pública de `events`.
- Impacto:
  - Se houver tokens legados preenchidos em `events`, eles podem estar acessíveis por `anon` via Supabase REST.
  - Compromete cobrança, consulta e eventual movimentação da conta Mercado Pago do organizador.

### CRÍTICO 2 — `POST /api/registrations/start` permite takeover de conta de atleta

- Evidência:
  - `src/app/api/registrations/start/route.ts:46-61` reaproveita usuário atleta existente pelo e-mail.
  - `src/app/api/registrations/start/route.ts:115-120` faz `upsert` da senha em `users_secrets`.
- Impacto:
  - Um atacante pode iniciar nova inscrição pública com o e-mail de um atleta já existente e sobrescrever sua senha.
  - Isso permite takeover da Área do Atleta sem passar pelo fluxo de recuperação.

### CRÍTICO 3 — `contestations` e `commercial_leads` sem RLS

- Evidência:
  - `supabase/migrations/20260617113000_functional_fitness_contestations.sql`
  - `supabase/migrations/20260620110000_commercial_leads.sql`
- Impacto:
  - Sob grants padrão do Supabase, ambas as tabelas ficam expostas via REST/RPC para `anon`/`authenticated`.
  - `contestations` contém descrições operacionais e notas do gestor.
  - `commercial_leads` contém telefone e metadados comerciais.

### ALTO 4 — `GET /api/app/bootstrap` expõe PII desnecessária sem autenticação

- Evidência:
  - `src/app/api/app/bootstrap/route.ts:26-39` inclui `birth_date`, `city`, `state`, `instagram`, `photo_url`, `team_members` em `sanitizePublicAthlete`.
  - `src/app/api/app/bootstrap/route.ts:76-90` faz `select('*')` em `athletes`, `registrations`, `leaderboard_entries`, etc.
  - `src/app/api/app/bootstrap/route.ts:143-157` devolve esse conjunto para visitantes sem sessão.
- Impacto:
  - PII e metadados de equipe ficam acessíveis publicamente.
  - O endpoint também entrega IDs de inscrições, úteis para abuso de outras rotas públicas.

### ALTO 5 — `mercadopago_accounts` tem leitura pública ampla por policy antiga remanescente

- Evidência:
  - `supabase/migrations/20260605210000_secure_mercadopago_accounts.sql:35-38`
  - `supabase/migrations/20260608120000_reenable_rls_security_baseline.sql:46-49`
- Impacto:
  - A policy antiga `USING (true)` não foi removida pela baseline.
  - Resultado prático: leitura pública efetiva de todas as linhas de `mercadopago_accounts`.

### ALTO 6 — Rotas públicas de checkout operam sobre `registrationId` sem posse/autorização

- Evidência:
  - `src/app/api/checkout/preference/route.ts:21-24`
  - `src/app/api/checkout/pix/route.ts:28-31`
  - `src/app/api/checkout/card/route.ts:83-86`
  - `src/app/api/checkout/status/route.ts:85-151`
  - `src/app/api/checkout/email/route.ts:27-143`
- Impacto:
  - Quem souber um `registrationId` consegue disparar efeitos sensíveis sobre a inscrição.
  - Em conjunto com `GET /api/app/bootstrap`, isso reduz o custo de enumeração.

### MÉDIO 7 — Função `apply_coupon_usage()` está exposta para `anon`

- Evidência:
  - `supabase/migrations/20260609100000_coupon_usage_tracking.sql:28-63`
- Impacto:
  - A função é `SECURITY DEFINER` e pode ser chamada diretamente fora da aplicação.
  - Permite abuso do contador de cupons se o atacante tiver IDs de inscrições compatíveis.

### MÉDIO 8 — Segredo da sessão reaproveita `SUPABASE_SERVICE_ROLE_KEY`

- Evidência:
  - `src/lib/serverSecurity.ts:40`
- Impacto:
  - A separação de segredos fica comprometida.
  - Um vazamento de segredo de sessão implica risco sobre a credencial administrativa, e vice-versa.

### MÉDIO 9 — OAuth callback usa `state` como `userId`, sem nonce antifraude

- Evidência:
  - `src/app/api/mercadopago/oauth/callback/route.ts:12-24`
- Impacto:
  - Falta o padrão de CSRF/state nonce armazenado e validado server-side.
  - A rota depende apenas de sessão + `state === userId`.

## 11. Plano de Correção

### Fase 0 — Contenção imediata

- Rotacionar `SUPABASE_SERVICE_ROLE_KEY` se houver qualquer chance de que `events.mp_access_token` tenha sido usado em produção.
- Configurar `WODA_SESSION_SECRET` dedicado e invalidar sessões antigas.
- Desabilitar ou restringir imediatamente `GET /api/app/bootstrap` para devolver apenas dados públicos mínimos.
- Suspender a reutilização de atleta existente em `POST /api/registrations/start` até corrigir o fluxo de senha.

### Fase 1 — Hardening do banco

- Criar **novas migrations forward-only** para:
  - remover o uso de `events.mp_access_token` e migrar qualquer valor legado para `mercadopago_secrets`;
  - habilitar RLS em `contestations`;
  - habilitar RLS em `commercial_leads`;
  - remover a policy ampla `Allow public select on mercadopago_accounts`;
  - restringir `leaderboard_entries` a colunas realmente públicas;
  - revogar `EXECUTE` de `apply_coupon_usage()` para `anon` e `authenticated`.
- Criar policies reais por papel:
  - `athlete` lê/edita apenas suas inscrições e contestações;
  - `manager` lê/edita apenas dados dos seus eventos;
  - `owner` com acesso administrativo explícito;
  - público lê apenas catálogo/evento/leaderboard minimizado.

### Fase 2 — Hardening das APIs públicas

- Trocar o modelo baseado em `registrationId` cru por um **token curto assinado** de checkout/recuperação de inscrição.
- Exigir esse token em:
  - `/api/checkout/preference`
  - `/api/checkout/pix`
  - `/api/checkout/card`
  - `/api/checkout/status`
  - `/api/checkout/email`
- Separar bootstrap por contexto:
  - `/api/public/bootstrap`
  - `/api/me/bootstrap`
  - `/api/manager/bootstrap`
  - `/api/owner/bootstrap`
- Minimizar payloads de resposta em todas as rotas públicas.

### Fase 3 — Revisão do fluxo de atleta

- Em `POST /api/registrations/start`:
  - nunca sobrescrever `users_secrets` de atleta existente em fluxo público;
  - se o e-mail já existir, exigir login prévio ou fluxo de reset;
  - se o objetivo for “retomar inscrição”, emitir token temporário em vez de trocar senha.
- Revisar retornos para evitar enumeração de contas e inscrições por mensagens muito precisas.

### Fase 4 — OAuth e credenciais de pagamento

- Implementar `state` nonce assinado/armazenado para o callback OAuth.
- Remover fallback `event_legacy` em `src/lib/mercadopagoServer.ts` depois da migração de credenciais legadas.
- Manter segredos apenas em `mercadopago_secrets`.

### Fase 5 — Testes e validação de segurança

- Adicionar testes estáticos e de integração para:
  - rotas públicas sem sessão;
  - rotas autenticadas por papel;
  - proteção contra takeover de atleta;
  - bloqueio de acesso cross-registration em checkout/status/email;
  - validação de policies RLS;
  - ausência de campos sensíveis em payloads públicos.

## 12. Arquivos que Precisam Ser Alterados

### Backend / segurança

- `src/lib/serverSecurity.ts`
- `src/lib/serverCheckout.ts`
- `src/lib/mercadopagoServer.ts`

### Rotas Next API

- `src/app/api/app/bootstrap/route.ts`
- `src/app/api/registrations/start/route.ts`
- `src/app/api/checkout/config/route.ts`
- `src/app/api/checkout/coupon/route.ts`
- `src/app/api/checkout/preference/route.ts`
- `src/app/api/checkout/pix/route.ts`
- `src/app/api/checkout/card/route.ts`
- `src/app/api/checkout/status/route.ts`
- `src/app/api/checkout/email/route.ts`
- `src/app/api/mercadopago/oauth/callback/route.ts`

### Banco / migrations novas

- `supabase/migrations/<nova>_remove_event_legacy_mp_access_token.sql`
- `supabase/migrations/<nova>_enable_rls_contestations.sql`
- `supabase/migrations/<nova>_enable_rls_commercial_leads.sql`
- `supabase/migrations/<nova>_tighten_mercadopago_accounts_policies.sql`
- `supabase/migrations/<nova>_tighten_leaderboard_public_surface.sql`
- `supabase/migrations/<nova>_revoke_public_coupon_rpc.sql`
- `supabase/migrations/<nova>_add_role_based_policies.sql`

### Frontend consumidor das APIs

- `src/context/AppContext.tsx`
- `src/components/RegisterModal.tsx`
- `src/components/PixPaymentModal.tsx`
- `src/components/CardPaymentModal.tsx`
- `src/app/admin/page.tsx`
- `src/app/owner/page.tsx`

## 13. Conclusão

- O projeto **não** usa Supabase diretamente no frontend hoje, o que ajuda.
- O principal problema atual não é “frontend falando com o banco”, e sim **rotas públicas server-side com `service_role`** e **superfícies Supabase públicas derivadas de schema/policies**.
- Os pontos mais urgentes são:
  - remover `mp_access_token` legado da tabela pública `events`;
  - impedir takeover de atleta em `/api/registrations/start`;
  - ativar RLS em `contestations` e `commercial_leads`;
  - reduzir drasticamente `/api/app/bootstrap`;
  - substituir `registrationId` cru por token assinado nas rotas de checkout.
