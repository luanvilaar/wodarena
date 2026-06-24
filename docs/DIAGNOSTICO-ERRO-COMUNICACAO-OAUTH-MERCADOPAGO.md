# Diagnóstico — "Erro de comunicação com o Mercado Pago" na conexão OAuth do gestor

**Data:** 2026-06-24 (rev. 2 — evidência de `client_id` divergente entre ambientes)
**Status:** Análise para aprovação — **nenhuma alteração de código, banco, autenticação ou infraestrutura foi realizada.**
**Escopo:** Falha na etapa final do fluxo OAuth (troca de `authorization_code` por Access Token).
**Relacionado:** Story 1.19 — Resiliência do OAuth e Callbacks do Mercado Pago.

---

## 0. Atualização 2026-06-24 (revisão após evidência de `client_id` divergente)

Nova evidência levantada pelo time e **confirmada no repositório** muda a hipótese principal: o problema mais provável não é só o `client_secret`, e sim **a aplicação Mercado Pago divergir entre os ambientes** (client_id / client_secret / redirect_uri pertencentes a apps diferentes).

### Três `client_id` em circulação — onde cada um realmente está (verificado)

| `client_id` | Onde aparece (verificação no repo) | Situação |
|---|---|---|
| **`7404163593060982`** | **`.env` local**, `MERCADOPAGO_CLIENT_ID` (linha 110) | **App correta** (confirmada pelo time) |
| `5059936541987710` | **URL de autorização que falhou** (print/contexto inicial) → valor que estava na env do **ambiente que gerou a URL** | App **errada/antiga**, observada em produção |
| `6111964651817080` | **Nenhuma ocorrência no repositório** (nem código, nem `.env`, nem config) | Não está no projeto — ver nota abaixo |

### O código NÃO tem `client_id` fixo (hardcoded)
Verificação em `src/`: as **duas** rotas OAuth leem **exclusivamente** `process.env.MERCADOPAGO_CLIENT_ID` — **não há nenhum `client_id` literal no código**. O número `6111964651817080` **não existe em lugar nenhum** do repositório. Logo, o `client_id` efetivo é **sempre** o que estiver na variável de ambiente do ambiente em execução (local lê o `.env`; produção lê as env vars do host). A suspeita de "código configurado com `6111964651817080`" está **descartada**.

### Implicação direta
A URL inicial que falhou trazia `client_id=5059936541987710`, mas o `.env` local hoje tem `7404163593060982`. Como o código só lê a env var, isso **prova que o ambiente que gerou aquela URL (produção) estava com `MERCADOPAGO_CLIENT_ID` diferente do `.env` local**. Produção e o valor correto **divergem** — e essa divergência é a causa-raiz mais provável do erro atual na troca de token (nova hipótese **H0**, Seção 2).

---

## 1. Descrição detalhada do erro encontrado

### Sintoma observado
O gestor inicia a conexão da conta Mercado Pago, **avança normalmente pelas telas de autorização** do Mercado Pago (diferente do problema anterior, em que aparecia a tela genérica "Estamos um problema"). A autorização aparenta ter ocorrido com sucesso e o navegador é redirecionado de volta para o site da WODArena (`/admin?tab=payments`). **No retorno**, em vez da mensagem de sucesso, é exibida a mensagem:

> **Erro de comunicação com o Mercado Pago.**

### Onde o erro é gerado
A mensagem é produzida **exclusivamente** pelo backend, na rota `POST /api/mercadopago/oauth/callback`, quando a chamada à API de token do Mercado Pago retorna um status diferente de 2xx:

```ts
// src/app/api/mercadopago/oauth/callback/route.ts (linhas 84-88)
if (!mpResponse.ok) {
  const errorData = await mpResponse.json();
  console.error('[OAuth Callback] Erro retornado pela API do Mercado Pago:', errorData);
  return NextResponse.json({ error: 'Erro de comunicação com o Mercado Pago.' }, { status: 400 });
}
```

Ou seja, o erro acontece **depois** de:
1. O gestor autorizar no Mercado Pago (a tela de consentimento foi exibida → `redirect_uri` já está correto e aceito).
2. O Mercado Pago redirecionar de volta com `code` + `state`.
3. O frontend interceptar `code`/`state` e chamar o backend via `POST` same-origin.
4. O backend validar a sessão do gestor, validar o `state` (uso único, não expirado) e iniciar a troca do `code` por token.

A falha está **estritamente no passo 4**, na requisição `POST https://api.mercadopago.com/oauth/token`.

### Onde está a causa real (que o gestor não vê)
O motivo concreto do Mercado Pago **não é exibido ao usuário** — ele é apenas registrado no log do servidor, na linha:

```
[OAuth Callback] Erro retornado pela API do Mercado Pago: { ... }
```

Esse objeto `errorData` contém o campo (`error` / `message` / `cause`) que **identifica a causa exata**. **Recuperar esse log de produção é o passo decisivo do diagnóstico** (ver Seção 4).

---

## 2. Explicação técnica do que está causando o problema

A troca de `authorization_code` por Access Token é a única etapa do OAuth que usa **simultaneamente** o `client_id` **e** o `client_secret` (segredo da aplicação), além de exigir que `redirect_uri` e `code` sejam exatamente os esperados. A etapa anterior (autorização) usa **apenas** o `client_id` (público).

Isso explica o padrão do sintoma: **"autorizou bem, mas falhou ao voltar"** indica que o que falha é algo específico da troca de token. As hipóteses, ordenadas por probabilidade dado o sintoma:

### H0 — Aplicação Mercado Pago divergente entre ambientes (probabilidade ALTA — **hipótese principal**)
O fluxo OAuth só funciona se **uma única aplicação** Mercado Pago for usada de ponta a ponta: o `client_id` da autorização, o **par** `client_id` + `client_secret` da troca de token e a aplicação sob a qual o `redirect_uri` (`https://wodarena.com.br/admin`) está cadastrado **precisam ser todos do mesmo app**. A Seção 0 mostra **pelo menos dois apps em circulação** (`7404163593060982` correto × `5059936541987710` observado em produção). Combinações que produzem **exatamente** o sintoma "autoriza, mas falha na troca":
- Produção autoriza com o `client_id` de um app, mas a troca usa `client_secret` de outro → `invalid_client`.
- O `redirect_uri` está cadastrado sob um app e as credenciais de produção são de outro → a autorização passa, mas a troca falha.
- Produção foi alterada (`5059…` → `7404…`) deixando `client_id` e `client_secret` **temporariamente de apps diferentes**.

Esta hipótese **engloba e refina** as antigas H1/H5: não basta o `secret` "estar certo" — ele precisa ser o secret **do mesmo app** do `client_id` e do `redirect_uri`, e esse app precisa ser o `7404163593060982` em **todos** os pontos (env de produção, painel MP e `.env` local).

### H1 — `client_secret` de produção incorreto ou não corresponde ao `client_id` (probabilidade MÉDIA-ALTA — caso particular de H0)
A configuração de produção (env vars no host) foi ajustada recentemente. Se o `MERCADOPAGO_CLIENT_SECRET` de produção estiver errado, vazio, truncado, ou for de **outra aplicação/ambiente** (ex.: credencial de teste com `client_id` de produção), a API responde tipicamente com `invalid_client`. Encaixe perfeito no sintoma: a autorização (só `client_id`) funciona; a troca (usa o `secret`) falha.

### H2 — `authorization_code` reutilizado ou expirado (probabilidade MÉDIA)
O `authorization_code` do Mercado Pago tem **validade de 10 minutos e uso único**. Duas situações o invalidam:
- **Dupla submissão do callback:** o efeito de frontend que processa `code`/`state` depende de `currentUser` (`useEffect(..., [currentUser])`). Se ele disparar mais de uma vez (re-render/troca de estado do usuário, recarregamento da página com os parâmetros ainda presentes), o segundo envio usa um `code` já consumido → `invalid_grant`.
- **Demora:** se o gestor levou mais de 10 minutos entre autorizar e concluir, o `code` expira → `invalid_grant`.

Atenuante atual: o frontend limpa os parâmetros da URL (`window.history.replaceState`) logo no início, o que reduz o risco de reprocessamento. Ainda assim não há trava explícita de "processar uma única vez".

### H3 — `redirect_uri` da troca diferente do registrado/autorizado (probabilidade MÉDIA-BAIXA)
A API exige que o `redirect_uri` enviado na troca seja **idêntico** ao usado na autorização e ao cadastrado no painel. O código usa o mesmo resolvedor (`resolveMercadoPagoRedirectUri`) nas duas pontas, o que tende a manter consistência. Porém, diferenças sutis entre o valor cadastrado no painel e o valor efetivo em produção (ex.: `www.wodarena.com.br` vs `wodarena.com.br`, barra final, `http` vs `https`) podem gerar `invalid_grant` mesmo após a autorização ter passado.

### H4 — PKCE obrigatório na aplicação, sem `code_verifier` no fluxo (probabilidade MÉDIA-BAIXA)
O fluxo atual **não usa PKCE** (não envia `code_challenge` na autorização nem `code_verifier` na troca). Se a aplicação Mercado Pago estiver configurada para **exigir PKCE**, a autorização pode até prosseguir, mas a troca de token falha por ausência do `code_verifier`.

### H5 — Mistura de ambiente/conta (teste × produção, país) (probabilidade MÉDIA — caso particular de H0)
`client_id` e `client_secret` precisam pertencer à **mesma aplicação** — que deve ser a `7404163593060982` — e ao mesmo ambiente. Combinações cruzadas (secret de teste, app de outra conta, app antigo `5059936541987710`) resultam em `invalid_client`.

### H6 — Formato/headers do request (probabilidade BAIXA)
O request envia `Content-Type: application/json`. A API atual do Mercado Pago aceita JSON nesse endpoint, então esta é uma causa improvável — listada apenas para completude.

> **Conclusão técnica:** O sintoma "autoriza, mas falha no retorno", somado à evidência de `client_id` divergente entre produção (`5059936541987710`) e o app correto (`7404163593060982`), aponta fortemente para **aplicação MP inconsistente entre ambientes (H0)** — ou, em menor grau, **código consumido/expirado (H2)**. O campo `errorData` no log de produção desambigua de forma definitiva: `invalid_client` → H0/H1/H5; `invalid_grant` → H2/H3/H4.

---

## 3. Impacto desse erro para usuários e gestores

| Afetado | Impacto |
|--------|---------|
| **Gestor (organizador)** | Não consegue conectar a conta Mercado Pago via OAuth. Sem conta conectada, **não pode receber pagamentos** dos eventos dele. |
| **Atleta (usuário final)** | Eventos do gestor afetado **não aceitam inscrição/pagamento online** (cartão, PIX, preference), pois o checkout depende das credenciais do organizador. Resultado: perda de conversão de inscrições. |
| **Plataforma (WODArena)** | Bloqueio de onboarding de novos gestores e de receita de marketplace (a `application_fee` só é cobrada quando há transação). Aumento de chamados de suporte. |
| **Integridade dos dados** | **Sem efeito colateral de dados.** O código só grava em `mercadopago_accounts`/`mercadopago_secrets` **após** a troca de token bem-sucedida. Como a troca falha antes, **nada é gravado** — não há conta "meio conectada" nem credencial inválida persistida. O `state` é consumido (uso único), exigindo reiniciar o fluxo a cada tentativa. |

**Severidade:** Alta — funcionalidade central de monetização inoperante para o(s) gestor(es) afetado(s), porém **sem corrupção de dados**.

---

## 4. Possíveis soluções para correção

> Pré-requisito comum a todas: **coletar o `errorData` do log de produção** (`[OAuth Callback] Erro retornado pela API do Mercado Pago:`). É leitura de log — não altera código nem infra. Esse valor confirma qual das soluções abaixo aplicar.

### Solução A — Consolidar TODOS os pontos na aplicação correta `7404163593060982` (recomendada)
Garantir que **os quatro pontos** apontem para o **mesmo** app `7404163593060982`:
1. **Env de produção** `MERCADOPAGO_CLIENT_ID = 7404163593060982`.
2. **Env de produção** `MERCADOPAGO_CLIENT_SECRET` = o secret **desse** app (`7404…`), regenerado no painel se houver dúvida.
3. **Painel Mercado Pago** do app `7404163593060982`: `redirect_uri` `https://wodarena.com.br/admin` cadastrado **sob este app**.
4. **`.env` local**: `client_id` já está `7404163593060982` — confirmar que o `client_secret` local também é desse app.

Depois: redeploy de produção e reteste. **A divergência atual (produção em `5059936541987710`) é exatamente o que esta solução corrige.**
**Atende:** H0, H1, H5. **(Configuração/infra — sem código.)**

### Solução B — Alinhar exatamente o `redirect_uri` nas três pontas
Garantir que o valor registrado no painel, a env `MERCADOPAGO_REDIRECT_URI` e o domínio efetivo de produção sejam idênticos (mesmo subdomínio `www`/apex, mesma barra final, `https`).
**Atende:** H3. **(Configuração — sem código.)**

### Solução C — Verificar/ajustar a exigência de PKCE no painel
Conferir se a aplicação exige PKCE. Opções: (C1) desabilitar PKCE no painel (configuração); ou (C2) implementar PKCE no fluxo (`code_challenge` na autorização + `code_verifier` na troca) — **mudança de código**.
**Atende:** H4.

### Solução D — Tornar o callback idempotente / single-submit (frontend)
Adicionar trava de "processa uma única vez" (ex.: `useRef` guard) e melhorar o tratamento de `code` expirado, orientando o gestor a reiniciar quando o `code` já tiver sido consumido.
**Atende:** H2. **(Mudança de código — frontend.)**

### Solução E — Melhorar observabilidade do erro (diagnóstico)
Propagar de forma segura o código de erro do Mercado Pago (campos `error`/`message`, **sem expor segredos**) para a resposta e/ou para logs estruturados, de modo que o motivo apareça para o suporte sem precisar caçar log bruto.
**Atende:** acelera o diagnóstico de qualquer hipótese. **(Mudança de código — backend.)**

---

## 5. Riscos e impactos de cada solução proposta

| Solução | Tipo | Risco | Impacto / observações |
|--------|------|-------|------------------------|
| **A** — Corrigir credenciais | Config/infra | **Baixo** | Resolve a causa mais provável (H1/H5). Regenerar `client_secret` **invalida o secret anterior** — qualquer outro serviço que use o mesmo secret precisa ser atualizado. Exige redeploy. Não toca dados. |
| **B** — Alinhar `redirect_uri` | Config | **Baixo** | Sem efeito colateral. Se o domínio canônico mudar (apex ↔ www), precisa refletir em painel + env + qualquer link. |
| **C1** — Desabilitar PKCE | Config | **Baixo-Médio** | Reduz uma camada de segurança do OAuth. Aceitável para fluxo server-side com `client_secret`, mas é uma decisão de segurança a registrar. |
| **C2** — Implementar PKCE | Código | **Médio** | Mais robusto e seguro, porém maior esforço e necessidade de persistir o `code_verifier` por `state`. Só vale se o painel exigir PKCE. |
| **D** — Idempotência do callback | Código (frontend) | **Baixo-Médio** | Elimina o reprocessamento de `code`. Risco de regressão na UX da aba `payments`; exige reteste do fluxo same-origin (Story 1.19). |
| **E** — Observabilidade | Código (backend) | **Baixo** | **Cuidado obrigatório:** nunca logar/retornar `access_token`, `refresh_token`, `client_secret` nem o `code`. Bem feito, acelera suporte sem risco de segurança. |

**Risco transversal:** cada tentativa consome o `state` (uso único). Testes repetidos exigem reiniciar o fluxo a cada vez — comportamento esperado, não um bug.

---

## 6. Recomendação da melhor abordagem

**Abordagem recomendada — em ordem, com o menor risco primeiro:**

1. **Confirmar a causa antes de agir (custo zero, sem alteração):** em paralelo a (a) **recuperar o `errorData` do log de produção** da rota de callback e (b) **inspecionar qual `client_id` produção está gerando** na URL de autorização. Os indícios decidem o caminho:
   - `invalid_client` **ou** URL de produção com `client_id` ≠ `7404163593060982` → **Solução A** (consolidar tudo no app `7404163593060982` — H0/H1/H5).
   - `invalid_grant` + indício de PKCE → **Solução C**.
   - `invalid_grant` por reuso/expiração → **Solução D** (+ orientar reinício do fluxo).
   - menção a `redirect_uri` → **Solução B**.

2. **Ação primária mais provável — Solução A (configuração, sem código):** a evidência já mostra que **produção rodou `5059936541987710` enquanto o app correto é `7404163593060982`**. Consolidar **os quatro pontos** (env de produção `MERCADOPAGO_CLIENT_ID` + `MERCADOPAGO_CLIENT_SECRET`, `redirect_uri` no painel do app `7404…`, e `.env` local) no **mesmo** app `7404163593060982`, fazer **redeploy** e **retestar com um gestor real**. **Critério de validação:** a URL de autorização gerada por produção deve conter `client_id=7404163593060982`, e o retorno deve concluir com "conta conectada".

3. **Reforço de configuração — Solução B + verificação de PKCE (Solução C):** confirmar o alinhamento exato do `redirect_uri` e se o painel exige PKCE, eliminando H3/H4 de uma vez.

4. **Endurecimento posterior (somente após aprovação) — Soluções E e D:** melhorar a observabilidade (mensagem/erro do MP exposta com segurança) e tornar o callback idempotente. São melhorias de robustez/diagnóstico que reduzem reincidência e tempo de suporte futuro, mas **não são pré-requisito** para destravar a conexão.

> **Resumo:** A correção mais provável é **de configuração (Solução A)** e **não exige mudança de código**. O passo imediato e sem risco é **ler o `errorData` do log de produção** para confirmar. Mudanças de código (C2, D, E) ficam reservadas para depois da validação, **mediante aprovação explícita**, conforme solicitado.

---

## Anexo — Evidências de código analisadas (sem modificação)

- `src/app/api/mercadopago/oauth/callback/route.ts:69-88` — chamada `POST /oauth/token` e geração da mensagem "Erro de comunicação com o Mercado Pago.".
- `src/app/api/mercadopago/oauth/callback/route.ts:56-63` — leitura de `MERCADOPAGO_CLIENT_ID`/`MERCADOPAGO_CLIENT_SECRET` e `resolveMercadoPagoRedirectUri(origin)`.
- `src/app/admin/page.tsx:284-339` — efeito de frontend que intercepta `code`/`state` e dispara o `POST` same-origin (dependência `[currentUser]`; sem trava de execução única).
- `src/lib/mercadopagoServer.ts` — `resolveMercadoPagoRedirectUri` (compartilhado entre autorização e troca de token).
- Verificação: **nenhuma** ocorrência de `PKCE`/`code_verifier`/`code_challenge` no código-fonte.
- **Evidência de `client_id` (grep em todo o repo, exceto `node_modules`/`.git`):**
  - `7404163593060982` → apenas em `.env` (linha 110, `MERCADOPAGO_CLIENT_ID`).
  - `5059936541987710` → apenas neste documento (origem: URL de autorização inicial / env de produção).
  - `6111964651817080` → **nenhuma ocorrência** no repositório.
  - **Nenhum `client_id` literal/hardcoded em `src/`** — as rotas usam `process.env.MERCADOPAGO_CLIENT_ID` (`callback/route.ts:56`, `admin/mercadopago/route.ts:47`).

**Nenhuma alteração foi aplicada. Aguardando validação do diagnóstico e autorização para implementação.**
