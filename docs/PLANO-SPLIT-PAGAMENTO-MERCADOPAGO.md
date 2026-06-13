# Plano Técnico — Split de Pagamento Mercado Pago (Taxa de Serviço WODArena)

> **Status:** Documentação técnica para leitura, análise e validação manual.
> **NÃO implementar** nada com base neste documento até aprovação explícita.
>
> **Data:** 2026-06-11
> **Autor:** Plano técnico (engenharia)
> **Escopo:** Cobrar do atleta uma taxa de serviço da plataforma equivalente a **10% sobre o valor da inscrição**, adicionada ao valor pago no checkout, sem descontar nada do gestor, com ativação/desativação controlada pelo proprietário do site por gestor e/ou por evento.
>
> **Decisão arquitetural (2026-06-11):** a conexão do gestor com o Mercado Pago passa a ser **exclusivamente via OAuth**. A integração **manual** (gestor cola Public Key + Access Token) será **descontinuada e removida**, pois é incompatível com o split de taxa (ver Seção 4). Gestores hoje conectados manualmente precisarão **reconectar via OAuth**.

---

## 1. Sumário executivo

Hoje cada gestor recebe o pagamento das inscrições **diretamente** na própria conta Mercado Pago (via OAuth ou via Public Key + Access Token informados manualmente). A WODArena **não retém valor algum** no fluxo de pagamento — a "comissão" exibida no painel do proprietário é apenas uma **projeção visual** (R$ 10 fixos por inscrição), nunca cobrada de fato.

O objetivo é introduzir uma **taxa de serviço de 10%** que:

1. É **somada** ao valor da inscrição (paga pelo **atleta**, não descontada do gestor);
2. Vai **automaticamente** para a conta da WODArena via mecanismo de *split* nativo do Mercado Pago (`application_fee` / `marketplace_fee`);
3. Pode ser **ativada ou desativada individualmente** por gestor e/ou por evento, controlada apenas pelo proprietário (`role = owner`).

O mecanismo técnico central é o **`application_fee`** (em `/v1/payments`, usado por PIX e cartão) e o **`marketplace_fee`** (em `/checkout/preferences`, usado pelo Checkout Pro). Esse campo retém um valor para a **conta da aplicação** (WODArena, dona do `client_id`/`client_secret`) e repassa o restante ao vendedor (gestor) — sem transferências manuais.

> ⚠️ **Restrição arquitetural crítica (ver Seção 4):** o split só direciona a taxa para a WODArena quando o gestor está conectado via **OAuth** (modo marketplace). Credenciais **manuais** (Access Token colado à mão) **não** roteiam a taxa para a plataforma. **Por isso a integração manual será removida e o projeto adotará OAuth como único método de conexão.**

---

## 2. Objetivo e requisitos

| # | Requisito | Origem |
|---|-----------|--------|
| R1 | Cobrar taxa de serviço = 10% sobre o valor da inscrição | Pedido |
| R2 | Taxa paga pelo **atleta** (somada), não descontada do gestor | Pedido |
| R3 | Gestor recebe o valor **cheio** da inscrição | Pedido |
| R4 | WODArena recebe a taxa de serviço | Pedido |
| R5 | Ativar/desativar a cobrança **por gestor e por evento** | Pedido |
| R6 | Controle exclusivo do proprietário do site (`role = owner`) | Pedido |
| R7 | Conexão do gestor **exclusivamente via OAuth**; remover integração manual | Decisão 2026-06-11 |

---

## 3. Estado atual do sistema (mapeamento fiel)

### 3.1 Conexão de credenciais do gestor

Há **duas** formas de o gestor conectar o Mercado Pago hoje, ambas terminam gravando nas mesmas tabelas:

- **OAuth** — `src/app/api/mercadopago/oauth/callback/route.ts` — ✅ **método que será mantido (único).**
  Troca `code` por `access_token` + `refresh_token` reais e grava:
  - `mercadopago_accounts` (público): `mercadopago_user_id`, `public_key`, `expires_at`, `status`
  - `mercadopago_secrets` (privado): `access_token`, `refresh_token`

- **Manual** — `POST /api/admin/mercadopago` (`src/app/api/admin/mercadopago/route.ts`) — ❌ **será descontinuado e removido (Seção 4 / 13).**
  Gestor cola Public Key + Access Token. Grava as mesmas tabelas, **mas** com `refresh_token = 'manual'` e `expires_at` fixo em 2099. → Durante a transição, `refresh_token = 'manual'` é o discriminador que identifica gestores a migrar.

> **Fallback legado adicional a remover:** `resolveMercadoPagoCheckoutConfig`/`resolveMercadoPagoPublicConfig` ainda aceitam `events.mp_access_token` / `events.mp_public_key` (credenciais por evento — `source: event_legacy`). Esse caminho também **não** é compatível com split via `application_fee` e deve ser desativado junto com a remoção do manual.

### 3.2 Resolução de credenciais no checkout

`src/lib/mercadopagoServer.ts`:

- `resolveMercadoPagoCheckoutConfig(eventId)` → busca `mercadopago_secrets.access_token` do organizador; fallback para `events.mp_access_token` (legado). **Retorna sempre `marketplaceFee: 0` (hardcoded, linha 82/91).**
- `resolveMercadoPagoPublicConfig(eventId)` → busca `mercadopago_accounts.public_key` (status `connected`); fallback `events.mp_public_key`.
- `getMercadoPagoApplicationFee(totalPaid, marketplaceFee)` → **função existe mas está órfã** (nunca é chamada em nenhum fluxo de pagamento).

### 3.3 Cálculo de valor (server-side)

`src/lib/serverCheckout.ts`:

- `calculateSecureRegistrationSnapshot` e `loadRegistrationCheckoutSnapshot` calculam `transactionAmount`:
  `transactionAmount = max(0, ticketPrice * quantity − desconto_cupom)`, com **piso de R$ 1,00** quando `0 < total < 1`.
- `loadRegistrationCheckoutSnapshot` recarrega o valor de `registrations.total_paid` no banco — **fonte de verdade do valor cobrado.**

### 3.4 Fluxos de pagamento (3 caminhos)

Todos enviam `transaction_amount = transactionAmount` e **nenhum** envia `application_fee` / `marketplace_fee`:

| Fluxo | Arquivo | Endpoint MP | Campo de split hoje |
|-------|---------|-------------|---------------------|
| Checkout Pro (redirect) | `src/app/api/checkout/preference/route.ts` | `POST /checkout/preferences` | ❌ ausente (`marketplace_fee`) |
| PIX | `src/app/api/checkout/pix/route.ts` | `POST /v1/payments` | ❌ ausente (`application_fee`) |
| Cartão | `src/app/api/checkout/card/route.ts` | `POST /v1/payments` | ❌ ausente (`application_fee`) |

Após criar o pagamento, cada fluxo atualiza `registrations` (`payment_status`, `payment_id`, `total_paid`, etc.).

### 3.5 Webhook e conciliação

- **Webhook** — `src/app/api/webhooks/mercadopago/route.ts`
  Recebe `?event_id=`, valida assinatura HMAC (`MERCADOPAGO_WEBHOOK_SECRET`), busca o pagamento com o token do gestor, atualiza `registrations` por `metadata.registration_id`, dispara e-mail e contabiliza cupom.
- **Status / polling** — `src/app/api/checkout/status/route.ts`
  Consulta por `payment_id` ou concilia por `registration_id`. ⚠️ **O matcher de fallback compara `transaction_amount ≈ registration.total_paid`** (linha ~123) — isto quebra se o valor cobrado passar a incluir a taxa e `total_paid` continuar sendo só a inscrição (ver Seção 9).

### 3.6 Painéis

- **Proprietário** — `src/app/owner/page.tsx`
  Calcula `platformRevenue` somando **R$ 10 fixos por inscrição aprovada** (`event.marketplace_fee ?? 10`). É **projeção visual**, não receita real. Abas: `dashboard | managers | events | leaderboards`. Não há aba de configuração de taxa.
- **Gestor** — `src/app/admin/page.tsx`
  Aba `payments` para conectar/desconectar Mercado Pago (OAuth ou manual).

### 3.7 Banco de dados (relevante)

- `events.marketplace_fee NUMERIC DEFAULT NULL` (migration `20260604130000`) — hoje interpretado como **R$ fixo** e usado só para exibição.
- `mercadopago_accounts` (público, RLS com SELECT público) e `mercadopago_secrets` (privado, sem políticas → inacessível ao frontend).
- `users.role` ∈ `{owner, manager}` (+ `athlete` em sessão). `owner` pode agir sobre qualquer gestor (`canActOnUser`).
- **Não existe** tabela de configurações globais da plataforma (`platform_settings`).

### 3.8 Tipos e variáveis de ambiente

- `src/types/index.ts`: `Event.marketplace_fee?: number`.
- Env já usadas: `MERCADOPAGO_CLIENT_ID`, `MERCADOPAGO_CLIENT_SECRET`, `MERCADOPAGO_REDIRECT_URI`, `MERCADOPAGO_WEBHOOK_SECRET`.
- `WODARENA_MARKETPLACE_FEE_DEFAULT` é citada em `gestaodepagamento.md` mas **não é lida em lugar nenhum** do código atual.

---

## 4. Conceito de split do Mercado Pago e decisão arquitetural crítica

### 4.1 Como o split nativo funciona

No modelo *marketplace* do Mercado Pago, ao criar um pagamento **com o token do vendedor (gestor)**, a aplicação (WODArena) pode informar:

- `application_fee` em `POST /v1/payments` (PIX, cartão);
- `marketplace_fee` em `POST /checkout/preferences` (Checkout Pro).

Efeito: do valor total pago pelo atleta, o Mercado Pago **retém esse montante para a conta da aplicação WODArena** e credita o restante ao gestor. **Não há transferência manual** — o repasse é automático e atômico na liquidação.

### 4.2 A regra que satisfaz o requisito

```
valorInscricao   = transactionAmount atual (após cupom/desconto)
taxaServico      = arredonda2(valorInscricao * 10%)
valorTotalCobrado = valorInscricao + taxaServico     ← o atleta paga isto
application_fee  = taxaServico                        ← retido para a WODArena
gestor recebe    = valorTotalCobrado − taxaServico = valorInscricao   ✓ (R3)
WODArena recebe  = taxaServico                                         ✓ (R4)
atleta paga      = inscrição + taxa                                    ✓ (R1, R2)
```

### 4.3 ⚠️ Restrição: OAuth vs Manual

O `application_fee`/`marketplace_fee` só credita a **conta da aplicação WODArena** quando o token do gestor foi emitido **via OAuth autorizando a aplicação WODArena** (`client_id`/`client_secret` da WODArena). 

Para credenciais **manuais** (gestor colou o próprio Access Token, `refresh_token = 'manual'`), a "aplicação" associada ao token é a do **próprio gestor** — o `application_fee` iria para a aplicação dele, **não** para a WODArena. **O split não funciona para tokens manuais.**

### 4.4 Decisão tomada: OAuth como único método (remover manual)

Para garantir o split correto e simplificar a arquitetura, **a integração manual é removida** e o OAuth passa a ser o **único** caminho de conexão. Benefícios:

- **Split garantido:** todo token usado em pagamento pertence à relação marketplace WODArena ⇄ gestor, então o `application_fee` sempre credita a plataforma.
- **Menos superfície de risco:** o gestor nunca manuseia/cola o próprio Access Token; menos chance de vazamento ou erro de credencial.
- **Refresh automático possível:** OAuth fornece `refresh_token` real, permitindo renovar o token expirado (ver S12) — algo impossível no modelo manual.
- **UX e código mais limpos:** uma única jornada de conexão ("Conectar Mercado Pago").

**O que remover/desativar:**

1. Endpoint `POST /api/admin/mercadopago` (criação manual) — `src/app/api/admin/mercadopago/route.ts`. Manter apenas `GET` (status da conta) e `DELETE` (desconectar).
2. UI de inserção manual de Public Key + Access Token no painel do gestor (`src/app/admin/page.tsx`, aba `payments`).
3. Fallback legado `events.mp_access_token` / `events.mp_public_key` (`source: event_legacy`) em `src/lib/mercadopagoServer.ts`.

**Plano de migração dos gestores manuais existentes (ver Seção 13.1):**

- Identificar gestores com `mercadopago_secrets.refresh_token = 'manual'`.
- No painel do gestor, sinalizar a conexão como "legada/incompatível" e exibir CTA obrigatório **"Reconectar via Mercado Pago (OAuth)"**.
- Enquanto não reconectar, a **taxa de serviço fica indisponível** para os eventos desse gestor (o pagamento segue funcionando sem taxa, como hoje) — evita interromper vendas durante a transição.
- Após o período de transição, decidir no go-live se contas ainda manuais ficam bloqueadas para novos pagamentos.

> Discriminador durante a transição: `mercadopago_secrets.refresh_token === 'manual'` ⇒ conta legada a migrar; valor real ⇒ OAuth válido.

---

## 5. Item 1 — Adaptar o fluxo atual de pagamento

**Princípio:** todo o cálculo da taxa e do valor cobrado deve ser **server-side**, nunca confiar em valor vindo do cliente.

### 5.1 Mudanças em `src/lib/mercadopagoServer.ts`

- `resolveMercadoPagoCheckoutConfig` passa a retornar também:
  - `serviceFeeEnabled: boolean` (resultado da hierarquia de resolução — Seção 15);
  - `serviceFeePercent: number` (ex.: `10`);
  - `connectionType: 'oauth' | 'manual'` (derivado de `mercadopago_secrets.refresh_token`). Como o manual será descontinuado (Seção 4.4), este campo serve para a transição: se `'manual'`, a taxa é **forçada a desativada** independentemente da config, e o pagamento segue sem `application_fee`.
- Adicionar `resolveServiceFee(valorInscricao, config)` que retorna `{ taxaServico, valorTotalCobrado }` aplicando arredondamento de 2 casas e o piso de R$ 1,00. Reaproveitar/renomear a função órfã `getMercadoPagoApplicationFee`.

### 5.2 Mudanças nos 3 fluxos de pagamento

Em `serverCheckout.ts`, ampliar o snapshot para expor:
- `serviceFeeAmount` (taxa), `serviceFeePercent`, `amountCollected` (= inscrição + taxa).

Nos 3 endpoints:
- **`preference/route.ts`** — `unit_price = amountCollected` **ou** manter o item da inscrição e adicionar `marketplace_fee: serviceFeeAmount` no corpo da preference (forma recomendada: incluir `marketplace_fee` e exibir a taxa como item/linha separada no resumo). Persistir `total_paid`, `service_fee_amount`, `amount_collected`.
- **`pix/route.ts`** e **`card/route.ts`** — `transaction_amount = amountCollected`, adicionar `application_fee: serviceFeeAmount` no payload. Persistir os mesmos campos.

> Quando `serviceFeeEnabled === false`, o comportamento é **idêntico ao atual** (sem taxa, sem `application_fee`) — garantindo retrocompatibilidade total.

### 5.3 Fluxo (com taxa ativa)

```
Atleta escolhe categoria
   └─ server calcula valorInscricao (cupom aplicado)
        └─ resolve config: serviceFeeEnabled? percent? oauth?
             ├─ NÃO → cobra valorInscricao (fluxo atual, sem application_fee)
             └─ SIM → taxaServico = round2(valorInscricao * percent)
                      amountCollected = valorInscricao + taxaServico
                      cria pagamento com transaction_amount=amountCollected
                                          + application_fee/marketplace_fee=taxaServico
```

---

## 6. Item 2 — Cálculo da taxa de serviço de 10%

- **Base de cálculo:** `valorInscricao` **após** desconto de cupom (o `transactionAmount` que o sistema já calcula). *Decisão a validar:* aplicar 10% sobre o valor com desconto (recomendado) ou sobre o preço cheio.
- **Percentual:** resolvido pela hierarquia (Seção 16); default global **10%**.
- **Arredondamento:** `taxaServico = Math.round(valorInscricao * percent) / 100`-equivalente, com **2 casas decimais**. Definir regra única (recomendado: arredondamento padrão *half-up* para 2 casas) para evitar divergência de centavos com o Mercado Pago.
- **Piso:** preservar a regra atual de `transaction_amount` mínimo de R$ 1,00 — aplicar ao `amountCollected`, nunca permitindo `application_fee >= valor total`.
- **Inscrição gratuita:** se `valorInscricao == 0`, **não** há taxa (não há checkout — `RegisterModal` aprova na hora). Confirmar como regra.

Exemplo:

| Inscrição | Taxa (10%) | Atleta paga | Gestor recebe | WODArena recebe |
|-----------|-----------|-------------|---------------|-----------------|
| R$ 150,00 | R$ 15,00 | **R$ 165,00** | R$ 150,00 | R$ 15,00 |
| R$ 99,90 | R$ 9,99 | **R$ 109,89** | R$ 99,90 | R$ 9,99 |
| R$ 150,00 (cupom −R$ 30) = R$ 120,00 | R$ 12,00 | **R$ 132,00** | R$ 120,00 | R$ 12,00 |

---

## 7. Item 3 — Apresentação do valor final ao atleta

O atleta deve ver a taxa de forma **transparente e discriminada** (boa prática e exigência de clareza ao consumidor).

- **`RegisterModal.tsx`** (resumo do pedido, ~linha 1170): adicionar linha **"Taxa de serviço (10%)"** entre o subtotal/desconto e o **Total**:
  ```
  Inscrição (Categoria)        R$ 150,00
  Desconto (CUPOM)            − R$ 30,00
  Taxa de serviço (10%)        R$ 12,00
  ─────────────────────────────────────
  Total                        R$ 132,00
  ```
- **`PixPaymentModal.tsx`** e **`CardPaymentModal.tsx`**: o "Total a pagar" passa a refletir `amountCollected`; idealmente mostrar a quebra (inscrição + taxa) também.
- O valor da taxa exibido deve vir **do servidor** (config do checkout), não ser recalculado isolado no cliente, para garantir consistência com o que será cobrado.
- Quando a taxa estiver **desativada** para o evento/gestor, **nenhuma** linha de taxa aparece (idêntico ao layout atual).
- Texto curto de tooltip/legenda recomendado: *"Taxa de serviço da plataforma WODArena."*

---

## 8. Item 4 — Garantir que o gestor receba o valor da inscrição

- Com `application_fee = taxaServico`, o Mercado Pago credita ao gestor exatamente `amountCollected − taxaServico = valorInscricao`. O gestor recebe o **valor cheio da inscrição**, sem desconto.
- O `total_paid` da inscrição **deve continuar representando o valor da inscrição** (o que o gestor recebe), e o total efetivamente cobrado do atleta vai em coluna nova `amount_collected`. Isso preserva relatórios do gestor e o matcher de conciliação coerente (ver Seção 9).
- Confirmar com testes em **sandbox** que, na conta do gestor, o valor líquido aparece como a inscrição (descontadas apenas as tarifas normais do Mercado Pago — que já incidiriam hoje), e a `application_fee` aparece como retida pela aplicação.

---

## 9. Item 9 — Webhooks, status de pagamento e conciliação

> (Itens 5, 6, 7 e 8 do pedido estão nas Seções 10–13; mantém-se aqui o item 9 junto da adaptação de fluxo por afinidade técnica.)

### 9.1 Webhook (`webhooks/mercadopago/route.ts`)

- A validação de assinatura e a busca do pagamento **não mudam**.
- Ao atualizar `registrations`, **persistir também** o valor da `application_fee` retornado pelo Mercado Pago (campo `fee_details` / `application_fee` no objeto do pagamento) em coluna nova — fonte de verdade da taxa **efetivamente** retida, para conciliação financeira da plataforma (em vez de confiar só no valor calculado na criação).
- Registrar `amount_collected` a partir de `paymentData.transaction_amount`.

### 9.2 Status / polling (`checkout/status/route.ts`)

- ⚠️ **Corrigir o matcher de fallback** (linha ~123): hoje compara `transaction_amount ≈ registration.total_paid`. Com a taxa ativa, o `transaction_amount` no Mercado Pago será `amount_collected` (inscrição + taxa). O matcher deve comparar com **`amount_collected`**, não com `total_paid`. Sem isso, a conciliação por valor falha para eventos com taxa.
- O caminho por `metadata.registration_id` e por `payment_id` continua válido.

### 9.3 Conciliação financeira da plataforma

- Nova fonte de receita **real** da WODArena = soma de `application_fee` efetivamente retida por pagamento aprovado (não mais R$ 10 de projeção).
- O painel do proprietário (Seção 12) passa a somar `service_fee_amount` / `application_fee` real das inscrições aprovadas.
- Recomendado: rotina/relatório de reconciliação que cruze (a) taxa calculada na criação, (b) taxa retornada pelo Mercado Pago no webhook, e (c) extrato/liquidação da conta WODArena.

---

## 10. Item 5 — Como a WODArena recebe a taxa de serviço

- **Mecanismo:** retenção automática via `application_fee`/`marketplace_fee` na conta da aplicação WODArena (dona do `client_id`/`client_secret` OAuth). Sem transferência manual, sem job de repasse.
- **Pré-condição:** gestor conectado via **OAuth** (único método após a remoção do manual — Seção 4.4). Contas legadas-manuais permanecem **sem taxa** até reconectarem por OAuth.
- **Liquidação:** o valor da taxa fica disponível no saldo Mercado Pago da WODArena conforme as regras de liberação do meio de pagamento (PIX imediato; cartão conforme prazo). Documentar que o saldo de taxa segue o calendário de liberação do Mercado Pago.
- **Estornos/Chargebacks:** definir política — em estorno total, o Mercado Pago normalmente estorna proporcionalmente a `application_fee`. Mapear o comportamento e refletir no relatório de receita (a taxa de uma inscrição estornada não é receita).

---

## 11. Item 6 — Alterações necessárias no banco de dados

> Migrations novas, aditivas e retrocompatíveis. Nada destrutivo nesta fase.

### 11.1 Nova tabela `platform_settings` (singleton global)

```sql
CREATE TABLE IF NOT EXISTS platform_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE,             -- linha única
  service_fee_percent NUMERIC NOT NULL DEFAULT 10, -- % global
  service_fee_enabled BOOLEAN NOT NULL DEFAULT FALSE, -- master switch global
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT platform_settings_singleton CHECK (id = TRUE)
);
```

### 11.2 Override por gestor — `users`

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS service_fee_enabled BOOLEAN DEFAULT NULL;
-- NULL = herda do global; TRUE/FALSE = override explícito do proprietário
```

### 11.3 Override por evento — `events`

```sql
ALTER TABLE events ADD COLUMN IF NOT EXISTS service_fee_enabled BOOLEAN DEFAULT NULL; -- NULL = herda gestor/global
ALTER TABLE events ADD COLUMN IF NOT EXISTS service_fee_percent NUMERIC DEFAULT NULL; -- NULL = herda global; override opcional de %
```

> O campo legado `events.marketplace_fee` (R$ fixo, só exibição) deve ser **descontinuado** após migração do painel owner para a receita real, ou mantido apenas por compatibilidade. **Não reutilizar** seu significado para evitar ambiguidade (R$ fixo × %).

### 11.4 Rastreamento por inscrição — `registrations`

```sql
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS service_fee_percent NUMERIC DEFAULT NULL;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS service_fee_amount  NUMERIC DEFAULT NULL; -- taxa calculada
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS amount_collected    NUMERIC DEFAULT NULL; -- total cobrado (inscrição + taxa)
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS application_fee_charged NUMERIC DEFAULT NULL; -- taxa confirmada pelo MP (webhook)
```

- `total_paid` mantém a semântica atual = **valor da inscrição** (o que o gestor recebe).
- RLS: as novas colunas seguem as policies já existentes das tabelas. `platform_settings` deve ter **leitura/escrita apenas via service-role** (sem policy pública); sua leitura no checkout é server-side.

---

## 12. Item 7 — Mudanças no painel do proprietário do site

Arquivo: `src/app/owner/page.tsx`.

### 12.1 Nova aba "Taxa de serviço" (ou seção em Configurações)

- **Global:** liga/desliga master switch e define o percentual padrão (default 10%) → grava `platform_settings`.
- **Por gestor:** lista de gestores com toggle de `users.service_fee_enabled` (3 estados: herdar / forçar ON / forçar OFF). Indicar visualmente o **estado da conexão**: OAuth ✓ (taxa habilitável) / legado-manual ⚠ (taxa indisponível até o gestor reconectar via OAuth — Seção 4.4) / sem conexão.
- **Por evento:** dentro da aba de eventos, toggle de `events.service_fee_enabled` e override opcional de `service_fee_percent`.

### 12.2 Receita real (substituir projeção)

- Trocar o cálculo de `platformRevenue` (hoje R$ 10 fixos) por **soma de `service_fee_amount` (ou `application_fee_charged`) das inscrições aprovadas** — receita efetiva da plataforma.
- Ajustar as tabelas financeiras (`feeUnit`, `totalFeeToCollect`) para refletir taxa percentual real por evento.

### 12.3 Endpoints de suporte (novos, restritos a `owner`)

- `GET/PUT /api/owner/service-fee/global` — lê/grava `platform_settings`.
- `PUT /api/owner/service-fee/manager` — grava `users.service_fee_enabled` (valida `role = owner`).
- `PUT /api/owner/service-fee/event` — grava flags por evento.
- Todos protegidos por `requireSession(request, ['owner'])`.

---

## 13. Item 8 — Mudanças no painel do gestor

Arquivo: `src/app/admin/page.tsx` (aba `payments`).

### 13.1 Conexão exclusivamente via OAuth

- **Remover** da UI o formulário de inserção manual (Public Key + Access Token). A aba `payments` passa a ter **apenas** o botão **"Conectar Mercado Pago"** (OAuth), o status da conexão (conectado / ID da conta) e o botão **Desconectar** — já suportados por `GET`/`DELETE` em `src/app/api/admin/mercadopago/route.ts`.
- **Migração de gestores manuais existentes:** se a conta atual é legada (`refresh_token = 'manual'`), exibir banner de atenção: *"Sua conexão precisa ser atualizada. Reconecte via Mercado Pago para continuar recebendo pagamentos e habilitar a taxa de serviço."* com CTA único de OAuth.
- **Token OAuth expirado:** quando `expires_at` estiver vencido e o refresh falhar, exibir CTA **"Reconectar"** (o fluxo OAuth já redireciona para `?tab=payments`).

### 13.2 Informações sobre a taxa (somente leitura)

- O gestor **não** pode ativar/desativar nem alterar o percentual (controle exclusivo do proprietário — R6). Exibir, de forma informativa:
  - Se a taxa de serviço está ativa para os eventos dele e qual o percentual;
  - Que a taxa é **paga pelo atleta** e que ele (gestor) recebe o **valor cheio** da inscrição.
- Nenhuma credencial sensível é exposta no frontend (mantém o padrão atual: `mercadopago_secrets` nunca trafega para o cliente).

---

## 14. Item 10 — Cuidados de segurança

| # | Cuidado | Detalhe |
|---|---------|---------|
| S1 | **Cálculo server-side** | Taxa e `amount_collected` calculados **somente** no servidor; nunca aceitar `application_fee`/valor da taxa vindos do cliente. |
| S2 | **Autorização do controle** | Endpoints de configuração de taxa restritos a `role = owner` (`requireSession([... 'owner'])`). Gestor não altera a própria taxa. |
| S3 | **Integridade do `application_fee`** | `0 <= application_fee < amount_collected`; jamais permitir taxa ≥ total (rejeição do Mercado Pago) nem negativa. |
| S4 | **Arredondamento determinístico** | Regra única de 2 casas para evitar divergência de centavos entre cálculo, cobrança e liquidação. |
| S5 | **OAuth como único método** | Manual removido (Seção 4.4). No servidor, validar `refresh_token != 'manual'` antes de aplicar `application_fee`; contas legadas-manuais cobram sem taxa até reconectar. Remover endpoint `POST /api/admin/mercadopago` e o fallback `event_legacy`. |
| S6 | **Token do gestor protegido** | Manter `mercadopago_secrets` sem RLS pública; nunca logar tokens. Os logs atuais já evitam imprimir o token — preservar. |
| S7 | **Webhook autêntico** | Manter validação HMAC (`MERCADOPAGO_WEBHOOK_SECRET`); confirmar `secret` configurado em produção (hoje, sem secret, valida apenas fora de produção). |
| S8 | **Idempotência** | Preservar `X-Idempotency-Key` (PIX/cartão) e a idempotência do webhook (`wasApproved`) ao introduzir os novos campos. |
| S9 | **Conciliação confiável** | Persistir a taxa **confirmada pelo Mercado Pago** (webhook) além da calculada; receita do owner baseada na taxa real, não na projeção. |
| S10 | **RLS das novas colunas/tabela** | `platform_settings` sem acesso público; novas colunas herdam policies existentes; revisar `20260608120000_reenable_rls_security_baseline.sql`. |
| S11 | **Estorno/cancelamento** | Não contar como receita taxa de inscrição estornada/cancelada; refletir no relatório. |
| S12 | **Token OAuth expirado** | Tratar refresh do `access_token` (campo `expires_at`) antes de cobrar; OAuth manual fixa 2099, mas OAuth real expira (~180 dias). Hoje **não há rotina de refresh** — risco a endereçar. |

---

## 15. Resolução de configuração — hierarquia

A "ativação" efetiva da taxa para um pagamento resolve-se nesta ordem (primeiro valor não-nulo vence):

```
1. events.service_fee_enabled        (override por evento)      ┐
2. users.service_fee_enabled         (override por gestor)      ├─ primeiro não-nulo decide
3. platform_settings.service_fee_enabled (master global)        ┘

E, adicionalmente:  taxa só é aplicada se connectionType == 'oauth'.
```

Percentual efetivo:

```
events.service_fee_percent  ??  platform_settings.service_fee_percent  (default 10)
```

Implementar em `resolveMercadoPagoCheckoutConfig` (uma única consulta/junção), retornando `serviceFeeEnabled` e `serviceFeePercent` já resolvidos. Isso centraliza a regra e mantém os 3 fluxos de pagamento consistentes.

---

## 16. Plano de implementação por fases (referência — NÃO executar agora)

| Fase | Entrega | Arquivos principais |
|------|---------|---------------------|
| F0 | Validação deste documento | — |
| F1 | Migrations aditivas (Seção 11) | `supabase/migrations/*` |
| F2 | Resolução de config + cálculo de taxa server-side | `src/lib/mercadopagoServer.ts`, `src/lib/serverCheckout.ts` |
| F3 | `application_fee`/`marketplace_fee` nos 3 fluxos | `checkout/{preference,pix,card}/route.ts` |
| F4 | Webhook + status (persistir taxa real, corrigir matcher) | `webhooks/mercadopago/route.ts`, `checkout/status/route.ts` |
| F5 | **Remover integração manual** (endpoint `POST`, UI manual, fallback `event_legacy`) + refresh de token OAuth | `src/app/api/admin/mercadopago/route.ts`, `src/app/admin/page.tsx`, `src/lib/mercadopagoServer.ts` |
| F6 | Painel do proprietário (config + receita real) + endpoints | `src/app/owner/page.tsx`, `src/app/api/owner/*` |
| F7 | Painel do gestor (OAuth-only + migração) + UI do atleta (resumo) | `src/app/admin/page.tsx`, `RegisterModal.tsx`, `PixPaymentModal.tsx`, `CardPaymentModal.tsx` |
| F8 | Testes em **sandbox** (PIX, cartão, Checkout Pro), conciliação, migração de gestor manual→OAuth | `tests/*` |

---

## 17. Riscos e pontos de validação manual

1. **Migração de gestores manuais → OAuth** (decidido em 2026-06-11): com o manual removido, contas legadas (`refresh_token = 'manual'`) precisam reconectar. Planejar comunicação e janela de transição para não interromper vendas (Seção 4.4 / 13.1).
2. **Refresh de token OAuth** não existe hoje — como o OAuth passa a ser o único método, eventos com token expirado (~180 dias) ficariam sem cobrar; **rotina de refresh é obrigatória** antes do go-live (S12).
3. **Matcher de conciliação por valor** quebra se não atualizado para `amount_collected` (Seção 9.2).
4. **Base de cálculo** (com ou sem cupom) e **regra de arredondamento** precisam de decisão única.
5. **Inscrição gratuita** não gera taxa — confirmar.
6. **Campo legado `marketplace_fee`** (R$ fixo) deve ser descontinuado/migrado sem quebrar `owner/page.tsx` e o `bootstrap`.
7. **Webhook sem `MERCADOPAGO_WEBHOOK_SECRET` em produção** — garantir secret configurado (S7).
8. **Política de estorno/chargeback** da taxa — definir antes do go-live.

---

## 18. Checklist de validação manual (antes de implementar)

- [x] **Decisão OAuth-only aprovada (2026-06-11): remover integração manual** (Seção 4.4).
- [ ] Plano de migração e comunicação para gestores hoje conectados via manual definido (Seção 13.1).
- [ ] Rotina de refresh de token OAuth especificada (pré-requisito do OAuth-only — S12).
- [ ] Base de cálculo definida (com desconto de cupom: sim/não).
- [ ] Regra de arredondamento definida (half-up 2 casas).
- [ ] Hierarquia de ativação (evento > gestor > global) aprovada.
- [ ] Modelagem de banco aprovada (Seção 11), incluindo destino do `marketplace_fee` legado.
- [ ] Layout da taxa no checkout aprovado (Seção 7).
- [ ] Escopo do painel do proprietário aprovado (Seção 12).
- [ ] Estratégia de conciliação/relatório de receita real aprovada (Seções 9 e 10).
- [ ] Plano de testes em sandbox definido (PIX, cartão, Checkout Pro, estorno, migração manual→OAuth).

---

> **Lembrete:** este documento é apenas técnico/descritivo. Nenhuma migration, endpoint ou alteração de UI deve ser criada antes da validação dos itens da Seção 18.
