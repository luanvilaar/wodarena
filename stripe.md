# Pendências de implementação — Stripe no WODArena

Checklist do que falta para o Stripe entrar como segundo gateway de checkout (EUR/GBP), ao lado do Mercado Pago (BRL). Baseado no plano de i18n/multi-moeda já aprovado (Fase 6 — Stripe é a última fase, por ser a de maior risco).

## Já feito (Fase 1 do plano)
- [x] Migration `20260913120000_i18n_multi_currency_checkout.sql`: colunas `country_code`/`currency`/`time_zone`/`payment_gateway`/`default_locale` em `events`; `currency`/`payment_gateway`/`locale` em `registrations`; tabela `stripe_accounts` (RLS habilitada, sem policy pública, mesmo padrão de `mercadopago_accounts`).
- [x] `src/lib/paymentGateway.ts` — regra BRL → Mercado Pago, EUR/GBP → Stripe.
- [x] `src/lib/taxId.ts` — CPF (BR, obrigatório) / NIF (PT, opcional) / nenhum (GB), com `isValidCPF`/`isValidNIF` deduplicados.
- [x] `src/lib/intl/format.ts` — `toMinorUnits`/`fromMinorUnits` (ponte para os valores em centavos que a API da Stripe espera).

## Já feito (Fase 6 do plano — Stripe)
- [x] SDK instalado (`npm install stripe`, `^22.6.2`); Stripe.js carregado via `<script src="https://js.stripe.com/...">` liberado na CSP (ainda sem uso client-side de Elements — o checkout de cartão via Stripe usa Checkout Session hospedada, não coleta o cartão no nosso próprio formulário).
- [x] Env vars documentadas em `.env.example` e no `CLAUDE.md` (`STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`) — **ainda não preenchidas**, nenhuma chave real configurada em `.env`.
- [x] `src/lib/stripeServer.ts` — `resolveStripeCheckoutConfig`/`resolveStripePublicConfig`, `getStripeClient`, `buildStripeIdempotencyKey`, `extractApplicationFeeCharged`. Sem tabela de secrets própria, como planejado.
- [x] `src/lib/checkoutGateway.ts` (novo) — `resolveEventPaymentContext(supabaseAdmin, eventId)`, ponto único usado por `config`/`pix`/`card`/`preference` para decidir o gateway.
- [x] Onboarding Stripe Connect: `GET/DELETE /api/admin/stripe` (cria conta Express + Account Link, autenticado como `mercadopago`; uma conta por país — PT ou GB, não ambos na mesma conta) e `GET /api/stripe/return` (sincroniza `charges_enabled`/`payouts_enabled`/`details_submitted` direto da Stripe no retorno do onboarding). **Falta o botão "Conectar Stripe" na UI do painel** (`src/app/admin/page.tsx`) — as rotas existem, mas nada as chama ainda pela interface.
- [x] Dispatch por gateway em `GET /api/checkout/config`, `POST /api/checkout/preference` (Stripe cria Checkout Session com `transfer_data.destination` + `application_fee_amount`), `POST /api/checkout/pix` (409 `gateway_method_unavailable` fora do BRL) e `POST /api/checkout/card` (recusa explicitamente eventos não-Mercado Pago, já que o protocolo de tokenização atual é específico do MP).
- [x] `POST /api/webhooks/stripe` — valida `Stripe-Signature` via `stripe.webhooks.constructEvent`, trata `payment_intent.succeeded/payment_failed/canceled/processing` e `checkout.session.completed`, chama `applyCouponUsageForApprovedRegistration`/`triggerRegistrationApprovedEmail`.
- [x] `RegisterModal.tsx` — lê `gateway`/`pixSupported` de `/api/checkout/config`; esconde a escolha Pix/Cartão e o campo CPF quando o evento não é BRL (força `credit_card`); envia `locale` no corpo de `preference`; usa `data.redirectUrl` (com fallback para `data.init_point`) para o redirect.
- [x] CSP atualizada (`js.stripe.com`, `api.stripe.com`, `hooks.stripe.com`, `checkout.stripe.com`) em `next.config.ts` e documentada em `docs/security/security-headers.md`.
- [x] `tests/stripe-checkout.test.mjs` (8 testes) e `tests/checkout-gateway-routing.test.mjs` (7 testes, incluindo o checksum do NIF contra um caso real) — 256/256 na suíte completa, `typecheck`/`lint`/`build` limpos.

## Falta fazer

### 1. Configuração real (bloqueia qualquer teste de ponta a ponta)
- [ ] Criar a conta/projeto Stripe (sandbox) e preencher `STRIPE_SECRET_KEY`/`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`/`STRIPE_WEBHOOK_SECRET` no `.env` real — sem isso, `getStripeClient()` lança `StripeConfigError` em qualquer chamada.
- [ ] Registrar o endpoint `/api/webhooks/stripe` no Dashboard da Stripe e copiar o signing secret correspondente.

### 2. UI de onboarding no painel do gestor
- [x] Botão "Conectar Stripe" em `src/app/admin/page.tsx` (escolha de país PT/GB → chama `GET /api/admin/stripe?action=onboarding_url&country=...` → redireciona). Seção nova na aba "Pagamentos", abaixo do bloco do Mercado Pago.
- [x] Exibir o status da conexão (sem conta / onboarding pendente com `charges_enabled=false` / conectado) — mesmo padrão visual já usado para o Mercado Pago no painel. O retorno de `/api/stripe/return` (`?stripe_status=connected|pending|...`) abre a aba de pagamentos automaticamente e mostra o aviso correspondente.

### 3. Documento fiscal condicional no checkout (cosmético, não bloqueia o MVP)
- [ ] Renomear `cpf` → `taxId` em `RegisterModal.tsx`/`RegistrationVoucher.tsx`/`EventView.tsx` usando `getTaxIdRequirement`/`isValidTaxId` de `src/lib/taxId.ts`. **Não é estritamente necessário hoje**: como o Pix (único fluxo que pede CPF no formulário público) já fica oculto para eventos não-BRL, nenhum atleta de evento em EUR/GBP vê ou precisa preencher CPF — a lacuna é só semântica (o campo se chama `cpf` mesmo quando não se aplica).
- [ ] Se essa renomeação for feita depois, aceitar as duas chaves (`cpf` e `taxId`) no `sessionStorage`/body por um release, pelo motivo já registrado (payload sobrevive ao redirect do gateway).

### 4. Card checkout transparente via Stripe (fora do MVP atual)
- [ ] O checkout público (`RegisterModal`) só usa Checkout Session hospedada da Stripe (redirect), nunca `/api/checkout/card`. Se no futuro quiser cartão tokenizado no próprio formulário para eventos EUR/GBP, precisa: Stripe Elements no client, criar/confirmar PaymentIntent com `payment_method_id` do Stripe (formato incompatível com o `token`/`payment_method_id` do Mercado Pago que a rota atual espera) — `CardPaymentModal.tsx` está morto no código hoje e não é o ponto de partida certo para isso.

### 5. Validação antes de produção
- [ ] Testar em sandbox Stripe com um evento configurado em EUR de ponta a ponta: conectar conta (onboarding) → criar evento EUR → checkout completo → webhook → e-mail de confirmação. Nada disso foi exercitado de verdade ainda — só os testes de regressão estática (grep sobre o código-fonte), sem chamadas reais à API da Stripe.
- [ ] Confirmar visualmente que eventos BR existentes continuam 100% no caminho Mercado Pago (a coluna `payment_gateway`/moeda do evento é o que isola o código novo — validado nos testes, mas vale um teste manual com um evento real).

---

# Chaves de API

Use chaves de API para autenticar solicitações de API.

A Stripe usa chaves de API para autenticar solicitações da sua integração e determinar quais recursos da Stripe ela pode acessar. Escolha o tipo de chave que corresponde ao local em que seu código é executado e conceda às chaves no lado do servidor apenas as permissões de que sua integração precisa.

Use a página de [chaves de API](https://dashboard.stripe.com/apikeys) no Dashboard para criar, revelar, expirar e fazer a rotação das chaves da conta ou da área restrita que você está visualizando. Este guia aborda as chaves usadas com a API da Stripe. Para saber mais sobre endpoints, comportamento e testes da API v2, consulte a [visão geral da API v2](https://docs.stripe.com/api-v2-overview.md).

Se uma solicitação não incluir uma chave válida, a Stripe retorna um [erro de solicitação inválida](https://docs.stripe.com/error-handling.md#invalid-request-errors). Se uma solicitação incluir uma chave expirada, a Stripe retorna um [erro de autenticação](https://docs.stripe.com/error-handling.md#authentication-errors). Use os [logs de solicitação do Workbench](https://docs.stripe.com/workbench.md) para inspecionar solicitações da API e solucionar erros.

> #### Se você é novo na Stripe
> 
> - **Mantenha sua empresa segura:** leia nossas [práticas recomendadas](https://docs.stripe.com/keys-best-practices.md) para gerenciamento de chaves.
- **Criar e testar**: crie ou selecione uma [área restrita](https://docs.stripe.com/sandboxes.md) e use suas chaves de teste. Para novas integrações, use uma área restrita geral separada em vez da área restrita do modo de teste da sua conta, para que as configurações e os dados permaneçam isolados do modo de produção. As chaves da área restrita começam com `pk_test_` para chaves publicáveis, `rk_test_` para chaves restritas e `sk_test_` para chaves secretas.
- **Quando estiver tudo pronto para aceitar pagamentos reais**: [mude para suas chaves do modo de produção](https://docs.stripe.com/keys.md#switch-to-live-mode), que começam com `pk_live_`, `rk_live_` e `sk_live_`.
- **Se precisa encontrar um segredo de assinatura de webhook**: os segredos de webhook são separados das chaves de API. Encontre-os na seção [Webhooks](https://dashboard.stripe.com/webhooks) do Dashboard, em cada endpoint de webhook.

## Tipos de chave

Quando você se registra para uma conta Stripe, criamos três tipos de chaves de API para você:

| Tipo​​ | Seguro para expor | Descrição |
| --- | --- | --- |
| Chave de API publicável `pk_...` | Sim | Chave de API para Stripe.js, Elements e SDKs para dispositivos móveis. Ela pode identificar sua conta e criar tokens ou PaymentMethods a partir de detalhes de pagamento, mas não pode realizar operações confidenciais, como criar cobranças ou ler dados da conta. Você pode incluí-la no código de front-end ou nos aplicativos que você distribui. |
| Chave de API restrita (RAK) `rk_...` | Não | Chave de API com permissões que você controla. Limite os danos à sua empresa que um fraudador poderia causar caso obtivesse sua chave. Crie quantas RAKs quiser e atribua-as a diferentes partes do seu aplicativo. O Stripe Apps também pode usar a [autenticação RAK](https://docs.stripe.com/stripe-apps/api-authentication/rak.md) para gerar uma chave com permissões quando um usuário instala um aplicativo. [Este guia](https://docs.stripe.com/keys/restricted-api-keys.md) explica como configurar e usar RAKs. |
| Chave de API secreta `sk_...` | Não | Chave de API com permissões irrestritas em todas as APIs da Stripe. Como não é possível limitar as permissões, não recomendamos o uso de chaves secretas para novos casos de uso e, para integrações existentes, recomendamos migrar o uso de chaves secretas para RAKs. |
| Chave de API da organização `sk_org_...` | Não | Chave de API que funciona no nível da organização. Assim como as chaves secretas ou restritas no nível da conta, opera no nível da [organização](https://docs.stripe.com/get-started/account/orgs.md) para gerenciar várias contas Stripe de uma só vez. [Este guia](https://docs.stripe.com/keys/organization-api-keys.md) explica como configurar e usar chaves de API da organização. |

Também aceitamos [chaves de API gerenciadas](https://docs.stripe.com/keys/managed-api-keys.md) emitidas por determinadas plataformas de hospedagem. Chaves gerenciadas são chaves de API secretas que uma plataforma de hospedagem entrega diretamente para seus aplicativos hospedados. Não é necessário lidar com chaves gerenciadas diretamente; seu provedor de hospedagem as emite e as rotaciona para você.

> #### Segredos da assinatura Webhook
> 
> Os segredos de assinatura de webhook não são chaves de API, são segredos específicos de cada webhook que seu receptor de webhook usa para se certificar de que os webhooks realmente vieram da Stripe. Você pode encontrar o segredo de assinatura de cada endpoint de webhook na seção [Webhooks](https://dashboard.stripe.com/webhooks) do Dashboard.

Você é responsável por gerenciar suas chaves de API com segurança. Leia nosso guia de [práticas recomendadas para proteger chaves de API](https://docs.stripe.com/keys-best-practices.md).

### Área restrita e modo de produção

Todas as solicitações da API da Stripe ocorrem em uma ‘*‘área restrita’* (A sandbox is an isolated test environment that allows you to test Stripe functionality in your account without affecting your live integration. Use sandboxes to safely experiment with new features and changes)’ ou no ‘*‘modo de produção’* (Use this mode when you’re ready to launch your app. Card networks or payment providers process payments)’. Você pode usar uma área restrita para testar sua integração e acessar dados de teste, e o modo de produção para acessar dados reais da conta. Cada modo tem seu próprio conjunto de chaves de API, e os objetos de um modo não são acessíveis no outro. Por exemplo, um [objeto de produto](https://docs.stripe.com/api/products/object.md) de área restrita não pode fazer parte de um pagamento em modo de produção.

| Tipo | Quando usar | Objetos | Como usar | Considerações |
| --- | --- | --- | --- | --- |
| Áreas restritas | Use uma área restrita e as chaves de API de teste associadas enquanto cria sua integração. Em uma área restrita, as bandeiras de cartão e os provedores de pagamento não processam pagamentos. | As chamadas da API retornam objetos simulados. Por exemplo, você pode recuperar e usar objetos de teste de [Customer](https://docs.stripe.com/api/customers/object.md), [PaymentIntent](https://docs.stripe.com/api/payment_intents/object.md), [Refund](https://docs.stripe.com/api/refunds/object.md) e [Subscription](https://docs.stripe.com/api/subscriptions/object.md). | Use [cartões de crédito e contas de teste](https://docs.stripe.com/testing.md#cards). Não é possível aceitar formas de pagamento reais ou trabalhar com contas reais. | O [Identity](https://docs.stripe.com/identity.md) não realiza nenhuma verificação. Além disso, os [objetos de conta](https://docs.stripe.com/api/accounts/object.md) do Connect não retornam campos confidenciais. |
| Modo de produção | Use o modo de produção e as chaves de API de produção quando estiver pronto para lançar sua integração e aceitar dinheiro de verdade. No modo de produção, as bandeiras de cartão e os provedores de pagamento processam pagamentos. | As chamadas da API retornam objetos reais. Por exemplo, você pode recuperar e usar objetos reais de [Customer](https://docs.stripe.com/api/customers/object.md), [PaymentIntent](https://docs.stripe.com/api/payment_intents/object.md), [Refund](https://docs.stripe.com/api/refunds/object.md) e [Subscription](https://docs.stripe.com/api/subscriptions/object.md). | Aceite cartões de crédito reais e trabalhe com contas de clientes. É possível aceitar autorizações de pagamento, cobranças e capturas de cartões de crédito e contas. | Contestações têm um fluxo mais detalhado e um [processo de testes](https://docs.stripe.com/testing.md#disputes) mais simples. Além disso, algumas [formas de pagamento](https://docs.stripe.com/payments/payment-methods.md) têm um fluxo mais detalhado e exigem mais etapas. |

## Proteja suas chaves

Somente chaves publicáveis são seguras para serem expostas fora do backend do seu aplicativo. Você é responsável por proteger outras chaves de API da Stripe, incluindo chaves de API restritas. Para proteger suas chaves:

- Armazene chaves sensíveis em um cofre de segredos fornecido pela sua plataforma de hospedagem. [Este post do blog](https://stripe.dev/blog/securing-stripe-api-keys-aws-automatic-rotation) oferece um exemplo. Se você não puder usar um cofre de segredos, use variáveis de ambiente para fornecer as chaves aos seus aplicativos de backend.
- Não insira chaves no código-fonte nem em arquivos de configuração incluídos em controle de versão.
- Configure as [políticas de acesso](https://docs.stripe.com/keys.md#access-policies) para que as chaves só possam ser usadas a partir de seus servidores conhecidos.
- [Faça a rotação de chaves](https://docs.stripe.com/keys.md#rolling-keys) quando membros da equipe com acesso às chaves saírem da sua organização.
- Não compartilhe chaves por e-mail, conversar ou outros canais não criptografados.

Para um guia abrangente, consulte [práticas recomendadas para gerenciar chaves de API secretas](https://docs.stripe.com/keys-best-practices.md). Também mantemos [uma biblioteca de habilidades](https://github.com/stripe/ai/tree/main/skills) para ajudar agentes de IA a seguir essas práticas recomendadas.

## Gerencie suas chaves de API

As seções a seguir descrevem como criar e gerenciar chaves na página de chaves de API.

#### Crie uma chave de API restrita

Use [chaves de API restritas](https://docs.stripe.com/keys/restricted-api-keys.md) (RAKs) para a maioria dos casos de uso. Você pode usar uma RAK para atribuir as permissões exatas de que sua integração precisa. Isso pode ajudar a reduzir os danos que um fraudador pode causar à sua empresa se obtiver sua chave.

- Siga as instruções em [Chaves de API restritas](https://docs.stripe.com/keys/restricted-api-keys.md) para criar uma RAK, configurar suas permissões e migrar a partir de chaves secretas.

#### Crie uma chave de API secreta

Crie uma chave de API secreta irrestrita apenas quando sua integração exigir acesso a todas as APIs e recursos da Stripe sem restrições. Se um agente fraudulento obtiver sua chave secreta, poderá prejudicar sua empresa. Recomendamos usar RAKs em vez disso.

1. Na página [Chaves de API](https://dashboard.stripe.com/test/apikeys), clique em **Criar chave secreta**.
2. Na caixa de diálogo, insira o código de verificação que enviamos por e-mail ou mensagem de texto. Se a caixa de diálogo não continuar automaticamente, clique em **Continuar**.
3. Insira um nome no campo **Nome da chave** e clique em **Criar**.
4. Clique no valor-chave para copiá-lo.
5. Salve o valor da chave. Não é possível recuperá-lo mais tarde.
6. No campo **Adicionar uma nota**, insira a localização onde salvou a chave e clique em **Concluído**.

### Revelar uma chave API

Quando você cria uma chave secreta no modo de produção, a Stripe a exibe uma vez antes de você salvá-la. Copie a chave antes de salvá-la porque não será possível revelá-la posteriormente. Não podemos recuperar chaves que você esqueceu ou para as quais perdeu o acesso. Se perder uma chave, rotacione-a ou exclua-a e crie outra. No modo de produção, você pode revelar apenas chaves de API que a Stripe cria para você, como uma chave secreta padrão ou uma chave gerada por uma rotação programada. No modo de área restrita, você sempre pode ver todas as suas chaves de API, incluindo chaves restritas e secretas. As chaves de API publicáveis não são confidenciais, por isso as mostramos por padrão e você não precisa fazer nada para revelá-las.

> Armazene chaves sensíveis em um lugar onde você não as perderá, como um cofre de segredos fornecido pela sua plataforma. Não coloque chaves no código da sua aplicação.

**Revele uma RAK no modo de produção**

Você pode revelar apenas as RAKs em modo de produção que criamos para você. Se você criar uma RAK por conta própria, não poderá revelá-la depois de tê-la visto uma vez.

1. Na página [Chaves de API](https://dashboard.stripe.com/apikeys) em modo de produção, na lista **Chaves restritas**, clique em **Revelar chave de produção** para a chave que deseja revelar.
2. Clique no valor-chave para copiá-lo.
3. Guarde o valor da chave no [cofre de segredos](https://docs.stripe.com/keys-best-practices.md#use-a-secrets-vault) da sua plataforma. Se a sua plataforma não oferecer um cofre, utilize uma variável de ambiente.
4. Clique em **Ocultar chave de produção**.

**Revele uma chave de API secreta no modo de produção**

Você pode revelar apenas as chaves secretas em modo de produção que criamos para você. Se você criar uma chave secreta por conta própria, não poderá revelá-la depois de tê-la visto uma vez.

1. Na página [Chaves de API](https://dashboard.stripe.com/apikeys) em modo de produção, na lista **Chaves Standard**, clique em **Revelar chave de produção** para a chave que deseja revelar.
2. Clique no valor-chave para copiá-lo.
3. Guarde o valor da chave no [cofre de segredos](https://docs.stripe.com/keys-best-practices.md#use-a-secrets-vault) da sua plataforma. Se a sua plataforma não oferecer um cofre, utilize uma variável de ambiente.
4. Clique em **Ocultar chave de produção**.
5. Clique no menu de overflow (⋯), depois selecione **Editar chave** para a chave à qual você quer adicionar uma nota.
6. No campo **Notas**, insira o local onde você salvou a chave e clique em **Salvar**.

### Limite uma chave API a certos endereços IP

As [políticas de acesso](https://docs.stripe.com/keys.md#access-policies) substituíram as restrições de endereço IP. Use políticas, não restrições.

### Alterar o nome ou nota de uma chave API

1. Na página [Chaves de API](https://dashboard.stripe.com/test/apikeys), clique no menu flutuante (⋯) da chave que deseja alterar.
2. Selecione a **Editar chave**.
3. Faça o seguinte:
   - Para mudar o nome, insira um novo nome no campo **Nome da chave**.
   - Para alterar o texto da nota, insira o novo texto no campo **Nota**.
4. Clique em **Salvar**.

### Expirar uma chave de API

Se você expirar uma chave de API secreta ou uma chave de API restrita, você precisa criar uma nova e atualizar qualquer código que use a chave expirada. Um código que use a chave expirada não pode mais fazer chamada da API.

> Você não pode expirar uma chave publicável.

1. Na página de [Chaves de API](https://dashboard.stripe.com/test/apikeys), na lista **Chaves restritas** ou **Chaves padrão**, clique no menu adicional (⋯) da chave que deseja expirar.
2. Selecione **Expirar chave**.
3. No diálogo, clique em **Expirar chave**. Se você não quiser mais expirar a chave, clique em **Cancelar**.

### Girar uma chave de API

Girar uma chave API revoga e gera uma chave de substituição pronta para uso imediatamente. Você também pode programar uma chave API para girar após um certo tempo. A chave de substituição é nomeada da seguinte forma:

- O nome de chave publicável de substituição é sempre `Chave publicável`.
- O nome da chave secreta de substituição é sempre `Chave secreta`.
- O nome da chave restrita de substituição é o mesmo da chave rotacionada.

Renomear uma chave API secreta ou restrita editando-a.

Gire uma chave API em cenários como:

- Se você perder uma chave API secreta ou restrita no modo ativo e não conseguir recuperá-la no Dashboard.
- Se uma chave API secreta ou restrita for comprometida e você precisar revogá-la para bloquear quaisquer solicitações API potencialmente maliciosas que possam usar a chave.
- Se um membro da equipe com acesso à chave sair da sua organização ou mudar de função.
- Se a sua política exigir a rotação de chaves em determinados intervalos.

#### Alterne com segurança para evitar indisponibilidade

Para evitar indisponibilidade durante a alternância de chaves:

1. **Use o período de carência**: quando você alterna uma chave no Dashboard, tanto a chave antiga quanto a nova continuam funcionando por até 7 dias. Isso permite uma migração gradual sem indisponibilidade. Se precisar de mais de 7 dias, crie uma nova chave manualmente, migre para ela e expire a chave antiga quando concluir o processo.
2. **Implemente gradualmente**: se possível, utilize a nova chave primeiro em um pequeno subconjunto dos seus servidores ou serviços e monitore os logs do servidor em busca de erros antes de expandir a implementação.
3. **Monitore antes de revogar**: antes que a chave antiga expire, [consulte os logs de solicitações dela](https://docs.stripe.com/keys.md#view-request-logs) e expire-a somente depois que o volume de solicitações tiver permanecido em zero por algumas horas ou dias.

#### Rotacione uma chave de API no Dashboard

1. Na página [Chaves de API](https://dashboard.stripe.com/test/apikeys), clique no menu flutuante (⋯) da chave que deseja rotacionar.
2. Selecione **Girar chave**.
3. Selecione uma data de validade no menu suspenso **Expiração**. Se você escolher **Agora**, a chave antiga é excluída. Se você especificar um tempo, o tempo restante até a chave expirar aparece abaixo do nome da chave.
4. Clique em **Girar chave de API**.
5. Clique no valor-chave para copiá-lo.
6. Salve o valor da chave. Não é possível recuperá-lo mais tarde.
7. No campo **Adicionar uma nota**, insira a localização onde salvou a chave e clique em **Salvar** ou **Pronto**.

### Restaurar o acesso de uma chave de API

Uma chave de API pode ter seu acesso limitado se não for usada para criar transferências, repasses ou atualizações de destinos de repasse por mais de 180 dias. Você não pode usar uma chave de acesso limitado para criar repasses, transferências ou destinos de repasse. Você pode restaurar o acesso para usar a chave normalmente ou para realizar uma ação bloqueada.

#### Restaure o acesso a uma chave de API

1. Na página [Chaves de API](https://dashboard.stripe.com/test/apikeys), clique no menu flutuante (⋯) da chave que deseja restaurar.
2. Selecione **Restaurar acesso**.
3. Clique em **Restaurar**.

## Visualize logs de solicitações de API de uma chave

Para [abrir os logs de solicitação da API](https://docs.stripe.com/workbench/overview.md#request-logs), clique no menu flutuante (⋯) de qualquer chave e selecione **Visualizar logs de solicitação**. Abrir os logs redireciona você ao Workbench no Stripe Dashboard.

## Mudar para modo de produção

Quando estiver pronto para aceitar pagamentos reais, use chaves de API de modo ativo em vez de chaves de sandbox (teste). Na página [Chaves de API](https://dashboard.stripe.com/apikeys), alterne de **modo de área restrita** para **modo de produção**. A página agora mostra suas chaves de API do modo de produção.

> #### Conclua checklist de lançamento
> 
> Mudar chaves de API é só uma etapa. Revise o [checklist de lançamento](https://docs.stripe.com/get-started/checklist/go-live.md) completo para garantir que sua integração esteja pronta para produção.

### Chaves publicáveis (do lado do cliente)

Copie sua **chave publicável em modo de produção** (começa com `pk_live_`) e substitua a chave `pk_test_` no seu código do lado do cliente. É seguro incorporar essa chave no seu código ou aplicativos.

### Chaves de API restritas ou secretas (do lado do servidor)

As chaves de API do lado do servidor são sensíveis, por isso revise nossas [práticas recomendadas para gerenciar chaves de API secretas](https://docs.stripe.com/keys-best-practices.md). Recomendamos gerar [chaves de API restritas](https://docs.stripe.com/keys/restricted-api-keys.md) para o seu código do lado do servidor, a fim de limitar o dano à sua empresa caso suas chaves sejam expostas ou comprometidas.

1. Antes de começar a usar uma chave de modo de produção no aplicativo backend, remova qualquer chave de API escrita diretamente no código. Em vez disso, use um [cofre de segredos](https://docs.stripe.com/keys-best-practices.md#use-a-secrets-vault) para fornecer a chave da área restrita e confirme que o aplicativo continua funcionando. Se a sua plataforma não oferecer um cofre de segredos, você pode usar uma variável de ambiente.
2. [Revele](https://docs.stripe.com/keys.md#reveal-an-api-key) e copie suas **chaves do modo de produção** (que começam com `rk_live_` ou `sk_live_`). Armazene o valor da chave com segurança em seu ambiente de servidor.
3. Configure o ambiente do servidor para fornecer chaves do modo de produção em vez de chaves da área restrita à sua aplicação.

#### Chaves de assinatura de Webhook (lado do servidor)

Se você usar Webhooks, atualize o URL de cada endpoint de Webhook e copie o novo **segredo de assinatura** na seção [Webhooks](https://dashboard.stripe.com/webhooks) do Dashboard.

## Políticas de acesso

Você pode restringir o acesso a uma chave anexando uma política de acesso a ela. Se alguém tentar fazer uma solicitação usando uma chave que não pode acessar, a Stripe bloqueará a solicitação e notificará você.

A Stripe recomenda configurar políticas de acesso em todas as chaves no modo de produção. Isso notifica você sobre qualquer acesso não autorizado para que possa alternar as chaves adequadamente.

Você pode gerenciar o acesso atribuindo políticas diferentes a chaves diferentes. Por exemplo, você pode distinguir entre ambientes de staging e de produção atribuindo políticas diferentes às suas respectivas chaves.

### Tipos de política de acesso

A Stripe aceita os seguintes tipos de políticas de acesso:

- **Endereços IP**: restringe o acesso a um ou mais endereços IPv4 específicos ou intervalos CIDR. Use esta abordagem se seus servidores tiverem endereços IP fixos.
- **Avançado**: restringe o acesso por Autonomous System Number (ASN), país e categorias de ameaças comuns. Se você estiver dimensionando dinamicamente, poderá conceder acesso ao seu provedor de nuvem usando o ASN e o país.

Uma política de acesso avançado pode usar qualquer combinação das seguintes regras:

- **ASNs permitidos**: solicitações de ASNs especificados são permitidas; todas as outras são bloqueadas.
- **Países**: solicitações de países especificados são permitidas; todas as outras são bloqueadas.
- **Fontes**: solicitações de fontes selecionadas são bloqueadas. Você pode selecionar as seguintes fontes:
  - **VPNs anônimas**: serviços de VPN de terceiros vendidos para fins de privacidade e anonimato (não inclui VPNs corporativas). Considere bloqueá-las se você não usar VPNs para acessar a API da Stripe.
  - **Proxies públicos**: servidores de proxy abertos de listas públicas. Considere bloqueá-los se você não usar proxies públicos para acessar a API da Stripe.
  - **Proxies residenciais**: proxies associados a ISPs residenciais. Considere bloqueá-los se você não usar ISPs residenciais para acessar a API da Stripe.
  - **Nós de saída da rede Tor**: tráfego da rede Tor. Considere bloqueá-los se você não acessar a API da Stripe pela rede Tor.

A seleção de várias regras as combina usando a lógica AND. Por exemplo, se você permitir o ASN 16509 (Amazon), permitir os EUA e bloquear os nós de saída da rede Tor, a política permitirá apenas solicitações de IPs da AWS nos EUA que não sejam conhecidos como nós de saída da rede Tor. Ela bloqueia todas as outras solicitações.

### Criar uma política de acesso

Para criar uma política de acesso, acesse a página [Políticas de acesso](https://dashboard.stripe.com/api-access-policies) no seu Dashboard e siga estas etapas:

1. Clique em **+ Criar política**.
2. Insira um nome (por exemplo, “Servidores de produção”) e uma descrição opcional.
3. Selecione **Endereços IP** ou **Avançado**.
4. Dependendo do tipo selecionado, configure a política:
   - **Endereços IP:** insira um ou mais endereços IPv4 públicos válidos ou intervalos CIDR. Por exemplo, `192.0.2.0/24` abrange o intervalo 192.0.2.0 a 192.0.2.255.
   - **Avançado:** especifique qualquer combinação de ASNs para permitir, países para permitir e fontes para bloquear, conforme descrito em [Tipos de política de acesso](https://docs.stripe.com/keys.md#access-policy-types).
5. Clique em **Próximo**.
6. Revise os detalhes da política e clique em **Criar política**.
7. Se for solicitado que você se autentique, siga as instruções na tela.

Se a criação for bem-sucedida, a nova política aparecerá na lista.

### Aplicar ou remover uma política de acesso

Para aplicar uma política de acesso a uma chave de API, acesse a página [Chaves da API](https://dashboard.stripe.com/apikeys) no seu Dashboard e siga estas etapas:

1. Na lista de **Chaves padrão** ou **Chaves restritas**, encontre a chave que você deseja atualizar e abra seu menu de estouro (⋯).
2. Selecione **Gerenciar política de acesso**.
3. Na lista suspensa **Política de acesso**, selecione a política desejada.
4. Revise os detalhes da política selecionada e clique em **Salvar**.
5. Se for solicitado que você se autentique, siga as instruções na tela.

Para remover uma política de acesso de uma chave, acesse a página [Chaves da API](https://dashboard.stripe.com/apikeys) no seu Dashboard e siga estas etapas:

1. Na lista de **Chaves padrão** ou **Chaves restritas**, encontre a chave que você deseja atualizar e abra seu menu de estouro (⋯).
2. Selecione **Gerenciar política de acesso**.
3. Na lista suspensa **Política de acesso**, selecione **Nenhuma**.
4. Clique em **Salvar**.

### Atualizar uma política de acesso

Para fazer alterações em uma política de acesso, acesse a página [Políticas de acesso](https://dashboard.stripe.com/api-access-policies) no seu Dashboard e siga estas etapas:

1. Encontre a política que você deseja alterar e abra seu menu de opções (⋯).
2. Selecione **Editar política**.
3. Atualize as opções da política conforme descrito em [Criar uma política de acesso](https://docs.stripe.com/keys.md#create-an-access-policy) e clique em **Avançar**.
4. Revise os detalhes da política e clique em **Salvar**.
5. Se for solicitado que você se autentique, siga as instruções na tela.

Quando você atualiza uma política de acesso, as alterações são aplicadas imediatamente a todas as chaves de API às quais ela está atribuída.

### Excluir uma política de acesso

Para excluir uma política de acesso, acesse a página [Políticas de acesso](https://dashboard.stripe.com/api-access-policies) no seu Dashboard e siga estas etapas:

1. Encontre a política que você deseja excluir e abra seu menu de opções (⋯).
2. Selecione **Excluir política**.
3. Revise a caixa de diálogo de confirmação para entender o impacto e clique em **Excluir política**.

A exclusão de uma política de acesso a remove imediatamente de todas as chaves de API às quais ela foi aplicada. Essas chaves permitirão solicitações de qualquer fonte até que você aplique outra política a elas.

## See also

- [Práticas recomendadas para gerenciar chaves de API secretas](https://docs.stripe.com/keys-best-practices.md)
- [Proteção contra chaves de API comprometidas](https://support.stripe.com/questions/protecting-against-compromised-api-keys)
- [Por que minha chave de API tem acesso limitado?](https://support.stripe.com/questions/why-does-my-api-key-have-limited-access)
- [Teste sua integração](https://docs.stripe.com/testing.md)