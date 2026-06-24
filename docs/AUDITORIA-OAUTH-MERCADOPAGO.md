# Auditoria — Integração OAuth Mercado Pago

**Data:** 2026-06-24
**Status:** Análise para aprovação — nenhuma alteração de código, banco, autenticação ou infraestrutura foi realizada.
**Escopo:** Análise estática completa do fluxo OAuth do Mercado Pago.

---

## Sumário executivo

O fluxo OAuth apresenta **um problema crítico de configuração** (divergência de `client_id` entre ambientes) que impede gestores de conectar a conta Mercado Pago, bloqueando o recebimento de pagamentos. Além disso, foram identificados **cinco problemas secundários** de robustez, segurança e manutenibilidade. A correção do problema crítico não exige alteração de código — é puramente de configuração de infraestrutura.

---

## 1. Problemas encontrados

### Problema 1 — Divergência de `client_id` entre ambientes `CRÍTICO`

**O que é:**
O fluxo OAuth exige que o mesmo app Mercado Pago seja usado de ponta a ponta. O `client_id` que gera a URL de autorização e o par `client_id` + `client_secret` que realiza a troca de token precisam ser do **mesmo app**, e esse app precisa ter o `redirect_uri` cadastrado no painel.

**O que está acontecendo:**
Há evidência de pelo menos dois `client_id` em circulação:

| `client_id` | Onde está |
|---|---|
| `7404163593060982` | `.env` local — `MERCADOPAGO_CLIENT_ID` (linha 110) |
| `5059936541987710` | URL de autorização gerada pelo ambiente de **produção** (observado em tela) |

O código **não tem nenhum `client_id` fixo no código-fonte** — as rotas `src/app/api/admin/mercadopago/route.ts:47` e `src/app/api/mercadopago/oauth/callback/route.ts:56` leem exclusivamente `process.env.MERCADOPAGO_CLIENT_ID`. Isso prova que **produção está rodando com uma env var diferente do `.env` local**.

**O que acontece tecnicamente:**
1. A URL de autorização é gerada com o `client_id` do app que está em produção.
2. A troca de token envia o `client_id` + `client_secret` de outro app (ou do mesmo `client_id` com o `secret` errado).
3. O Mercado Pago rejeita com `invalid_client`.
4. O backend registra o erro no log e retorna ao frontend a mensagem genérica:

```
Erro de comunicação com o Mercado Pago.
```

**Localização do erro no código** — `callback/route.ts:84–88`:
```ts
if (!mpResponse.ok) {
  const errorData = await mpResponse.json();
  console.error('[OAuth Callback] Erro retornado pela API do Mercado Pago:', errorData);
  return NextResponse.json({ error: 'Erro de comunicação com o Mercado Pago.' }, { status: 400 });
}
```

O `errorData` com o código real do MP só vai para o log de produção — o usuário nunca o vê.

---

### Problema 2 — `useEffect` de callback com dupla execução em potencial `MÉDIO`

**Localização:** `src/app/admin/page.tsx:284–339`

```ts
useEffect(() => {
  // processa code + state da URL
  processOauth();
}, [currentUser]);  // ← dependência problemática
```

**O que é:**
O efeito que intercepta `code` e `state` da URL re-executa toda vez que `currentUser` muda. Como o `AppContext` atualiza `currentUser` durante o carregamento (fetch de bootstrap), o efeito pode disparar **duas vezes** com o mesmo `code`.

**Consequência:**
O `authorization_code` do Mercado Pago é de uso único. Na segunda execução, o `state` já foi consumido pelo backend (`callback/route.ts:45`) e o `code` já foi trocado. O segundo disparo retorna erro, podendo exibir mensagem de falha mesmo após conexão bem-sucedida.

*Atenuante existente:* o frontend limpa os parâmetros da URL com `window.history.replaceState` antes de chamar `processOauth`, o que previne re-execução por reload. O risco persiste apenas para re-renders dentro da mesma sessão com `currentUser` mudando.

---

### Problema 3 — PKCE ausente — desvio da especificação técnica `MÉDIO`

**O que é:**
O documento `docs/mercado-pago-oauth-spec.md` descreve o fluxo como "Authorization Code com PKCE opcional" e prevê armazenar `code_verifier` na tabela de states. A implementação atual:

- Não envia `code_challenge` na URL de autorização (`admin/mercadopago/route.ts:70`).
- Não envia `code_verifier` na troca de token (`callback/route.ts:69–82`).
- A migration `20260624140000` não criou a coluna `code_verifier` na tabela.

**Consequência:**
Se a aplicação Mercado Pago estiver configurada para exigir PKCE, a troca de token falha silenciosamente. Mesmo sem PKCE obrigatório, a ausência enfraquece a segurança do fluxo.

---

### Problema 4 — Sem renovação automática do `access_token` `MÉDIO`

**O que é:**
O token OAuth do Mercado Pago expira em ~180 dias (`expires_in` gravado em `callback/route.ts:91`). A coluna `expires_at` é persistida em `mercadopago_accounts`, mas **não existe nenhuma lógica para verificar a expiração e usar o `refresh_token`** antes de processar pagamentos.

A especificação técnica (`mercado-pago-oauth-spec.md`, seção 3-C) previa um helper `getOrganizerToken()` com renovação automática — que **nunca foi implementado**.

**Consequência:**
Em ~180 dias após cada gestor conectar, os pagamentos dos eventos desse gestor começam a falhar silenciosamente. O gestor precisará reconectar manualmente.

---

### Problema 5 — Webhook depende de `event_id` como query param manual `MÉDIO`

**Localização:** `src/app/api/webhooks/mercadopago/route.ts:189–191`

```ts
const eventId = searchParams.get('event_id');
if (!eventId) {
  return NextResponse.json({ error: 'Evento obrigatorio para processar webhook.' }, { status: 400 });
}
```

**O que é:**
O webhook exige que o `event_id` (do evento WODArena) chegue como query param na URL. Isso significa que o webhook precisa ser cadastrado no painel do Mercado Pago no formato:

```
https://wodarena.com.br/api/webhooks/mercadopago?event_id=<id>
```

— um webhook separado por evento, configurado manualmente.

**Consequência:**
Se o webhook for cadastrado com URL genérica (sem `event_id`), **todos os retornos de pagamento são descartados com erro 400** e nenhuma inscrição tem seu status atualizado automaticamente. Isso força conciliação manual de todos os pagamentos.

---

### Problema 6 — Mensagem de erro do MP não propagada para diagnóstico `BAIXO`

**O que é:**
O campo `errorData` com o código real do erro do Mercado Pago (`invalid_client`, `invalid_grant`, `invalid_redirect_uri` etc.) só vai para o log do servidor — jamais chega ao frontend ou ao suporte sem acesso direto a logs de produção.

**Consequência:**
Cada incidente de OAuth exige acesso ao servidor para diagnóstico. Sem observabilidade centralizada (ex.: Sentry), o suporte não consegue identificar a causa sem o usuário fornecer logs.

---

## 2. Possíveis soluções

### Solução A — Consolidar env vars de produção no app correto

Garantir que os quatro pontos abaixo apontem para o **mesmo** app Mercado Pago (`7404163593060982`):

1. `MERCADOPAGO_CLIENT_ID` em produção = `7404163593060982`
2. `MERCADOPAGO_CLIENT_SECRET` em produção = secret **deste** app (confirmado no painel MP)
3. `MERCADOPAGO_REDIRECT_URI` em produção = `https://wodarena.com.br/admin` (idêntico ao cadastrado no painel)
4. Painel do app `7404163593060982`: `redirect_uri` `https://wodarena.com.br/admin` cadastrado

Após ajuste: **redeploy de produção** e **reteste com gestor real**. A URL de autorização gerada por produção deve conter `client_id=7404163593060982`.

**Natureza:** Configuração de infraestrutura — zero alteração de código.
**Atende:** Problema 1.

---

### Solução B — Corrigir a dependência do `useEffect` de callback

Substituir a dependência `[currentUser]` por um `useRef` guard que garante execução única:

```ts
const oauthProcessed = useRef(false);

useEffect(() => {
  if (oauthProcessed.current) return;
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  if (code && state) {
    oauthProcessed.current = true;
    processOauth();
  }
}, []);  // array vazio: executa apenas na montagem
```

**Natureza:** Mudança de código — frontend.
**Atende:** Problema 2.

---

### Solução C — Implementar ou verificar PKCE

**C1 — Verificar se PKCE é exigido no painel** (configuração): se não for obrigatório no app `7404…`, o fluxo atual é compatível com a política do MP — mas é menos seguro. Decisão a registrar.

**C2 — Implementar PKCE no fluxo** (recomendado a médio prazo): adicionar `code_challenge` na URL de autorização e `code_verifier` na troca de token, persistindo o verifier na tabela `mercadopago_oauth_states` via migration de nova coluna. Alinha com a especificação técnica original.

**Natureza C1:** Verificação de configuração.
**Natureza C2:** Mudança de código (backend) + migration.
**Atende:** Problema 3.

---

### Solução D — Implementar renovação automática do `access_token`

Criar um helper `getMercadoPagoAccessToken(userId)` que, antes de entregar o token ao checkout, verifica `expires_at` e usa o `refresh_token` para renovar automaticamente caso esteja dentro de uma janela de segurança (ex.: 7 dias antes do vencimento). O token renovado é gravado em `mercadopago_secrets`.

**Natureza:** Mudança de código — backend (`mercadopagoServer.ts`).
**Atende:** Problema 4.

---

### Solução E — Resolver o `event_id` internamente no webhook

**E1 (imediato):** Documentar e garantir que todos os eventos ativos tenham webhook cadastrado com `event_id` na URL.

**E2 (recomendado a médio prazo):** Refatorar o webhook para resolver o `event_id` a partir de `metadata.event_id` gravado no pagamento no momento do checkout, eliminando a dependência de query param manual.

**Natureza E1:** Processo/documentação.
**Natureza E2:** Mudança de código — backend.
**Atende:** Problema 5.

---

### Solução F — Melhorar observabilidade do erro OAuth

No backend do callback, propagar com segurança o campo `error` (sem tokens, secrets ou `code`) da resposta do MP:

```ts
return NextResponse.json({
  error: 'Erro de comunicação com o Mercado Pago.',
  detail: errorData?.error || 'unknown'  // apenas o código de erro, nunca tokens/secrets
}, { status: 400 });
```

**Natureza:** Mudança de código — backend.
**Atende:** Problema 6.

---

## 3. Riscos e impactos de cada solução

| Solução | Tipo | Risco | Impactos a considerar |
|---|---|---|---|
| **A** — Consolidar env vars de produção | Config/infra | **Baixo** | Se o `client_secret` for regenerado no painel, o anterior é invalidado imediatamente — outros sistemas que o usem precisam ser atualizados na mesma janela. Exige redeploy. Nenhum dado é alterado. |
| **B** — Corrigir `useEffect` | Código (frontend) | **Baixo-Médio** | Elimina risco de dupla execução. Requer reteste do fluxo completo same-origin (autorização → retorno → sucesso). Risco baixo de regressão na página admin. |
| **C1** — Verificar PKCE no painel | Config | **Baixo** | Sem alteração de código. Se PKCE não for exigido, nenhum impacto. Se exigido, revela a causa-raiz do Problema 3. |
| **C2** — Implementar PKCE | Código + migration | **Médio** | Maior esforço. Requer migration, alteração nas duas rotas de backend e reteste completo. Mais seguro a longo prazo. |
| **D** — Renovação automática de token | Código (backend) | **Médio** | Toca o caminho crítico de checkout. Exige testes robustos de falha de renovação (ex.: `refresh_token` inválido) para não bloquear pagamentos em produção. |
| **E1** — Documentar webhook por evento | Processo | **Baixo** | Sem código. Não escala bem com o crescimento do número de eventos. |
| **E2** — Refatorar webhook | Código (backend) | **Médio** | Altera o caminho de confirmação de pagamento — o mais crítico do sistema. Requer testes extensivos e validação de que `metadata.event_id` está presente em todos os pagamentos existentes. |
| **F** — Melhorar observabilidade | Código (backend) | **Baixo** | Cuidado obrigatório: nunca expor `access_token`, `refresh_token`, `client_secret` ou `code` nos logs ou na resposta. Limitado ao campo `error` (string) do MP. |

---

## 4. Recomendação da melhor abordagem

### Passo 0 — Confirmar a causa antes de agir (sem nenhuma alteração)

Acessar os logs de produção da rota `/api/mercadopago/oauth/callback` e localizar a linha:

```
[OAuth Callback] Erro retornado pela API do Mercado Pago: { ... }
```

O campo `error` dessa linha confirma definitivamente qual solução aplicar:

| Campo `error` do log | Causa confirmada | Solução |
|---|---|---|
| `invalid_client` | Apps divergentes em produção | **Solução A** |
| `invalid_grant` | `code` expirado/reutilizado | **Solução B** |
| `invalid_redirect_uri` | `redirect_uri` divergente | **Solução A** (ajuste do URI no painel) |
| Menção a PKCE | PKCE exigido pelo app | **Solução C** |

---

### Passo 1 — Solução A (configuração, sem código) — ação primária

Esta é a correção mais provável dado o sintoma: a URL de produção continha `client_id=5059936541987710` enquanto o app correto confirmado pelo time é `7404163593060982`. Consolidar os quatro pontos descritos na Solução A, fazer redeploy e retestar com um gestor real.

**Critério de validação:** a URL de autorização gerada por produção deve conter `client_id=7404163593060982` e o retorno deve concluir com "Conta do Mercado Pago conectada com sucesso!".

---

### Passo 2 — Soluções B + C1 (reforço, sem migration)

Após o Passo 1 destravar o bloqueio imediato, corrigir a dependência do `useEffect` e confirmar no painel se PKCE é exigido. Ambas são mudanças de baixo risco que eliminam causas secundárias.

---

### Passo 3 — Soluções D, E2 e F (endurecimento posterior)

Implementar renovação automática de token, refatorar o webhook para não depender de `event_id` na URL e melhorar a observabilidade. São melhorias de robustez que evitam reincidências — mas não são pré-requisito para destravar o problema atual.

---

## Anexo — Arquivos analisados

| Arquivo | Relevância |
|---|---|
| `src/app/api/mercadopago/oauth/callback/route.ts` | Troca de token — origem do erro reportado |
| `src/app/api/admin/mercadopago/route.ts` | Geração da URL de autorização e configuração manual |
| `src/lib/mercadopagoServer.ts` | Resolução do `redirect_uri` e config de checkout |
| `src/lib/serverSecurity.ts` | Sessão, autenticação e `canActOnUser` |
| `src/lib/serverCheckout.ts` | Checkout e renovação (ausente) de token |
| `src/app/api/webhooks/mercadopago/route.ts` | Confirmação assíncrona de pagamentos |
| `src/app/admin/page.tsx` (seção OAuth) | Fluxo frontend — `useEffect` de callback |
| `supabase/migrations/20260624140000_create_mercadopago_oauth_states.sql` | Tabela de states CSRF |
| `supabase/migrations/20260604130000_mercadopago_marketplace.sql` | Schema original das tabelas MP |
| `supabase/migrations/20260605210000_secure_mercadopago_accounts.sql` | Separação public/secrets |
| `supabase/migrations/20260607230131_relax_mercadopago_user_unique.sql` | Constraint de unicidade |
| `supabase/migrations/20260608120000_reenable_rls_security_baseline.sql` | RLS baseline |
| `supabase/migrations/20260621153000_api_surface_hardening.sql` | Fechamento de políticas públicas |
| `docs/mercado-pago-oauth-spec.md` | Especificação técnica original do fluxo |

---

*Nenhuma alteração foi aplicada ao código, banco de dados, autenticação ou infraestrutura. A implementação de qualquer solução está condicionada à validação e autorização explícita.*
