# Plano — Correcao da Sincronizacao Manual de Pagamentos do Gestor

**Status:** Implementado e validado localmente
**Escopo:** Painel `/admin` e `GET /api/checkout/status`
**Sem migration:** sim

---

## 1. Resumo executivo

Um gestor reportou um falso negativo na conciliacao manual de pagamento: a inscricao permanecia `PENDENTE` no painel, enquanto o comprovante do Mercado Pago mostrava a venda como `APROVADA`.

O problema estava na divergencia entre dois fluxos do produto:

1. A area do atleta ja priorizava consulta por `payment_id` quando ele existia.
2. O botao manual do gestor consultava sempre por `registration_id`, caindo numa conciliacao indireta e fragil.

Esta correcao alinha o fluxo do gestor ao caminho mais confiavel e endurece o backend para reutilizar o `payment_id` persistido na inscricao sempre que isso for seguro.

---

## 2. Evidencias encontradas

### 2.1 Painel do gestor

O handler do botao `Sincronizar pagamento` consultava sempre:

- `src/app/admin/page.tsx`
- `GET /api/checkout/status?registration_id=...&event_id=...`

Isso ignorava `registration.paymentId`, mesmo quando o checkout Pix/cartao ja havia persistido o identificador real do pagamento.

### 2.2 Fluxo do atleta

A area do atleta ja tratava corretamente:

- usa `payment_id` quando ele existe;
- cai para `registration_id` apenas como fallback.

Isso explicava por que o problema aparecia na operacao do gestor, mas nao necessariamente no painel do atleta.

### 2.3 Backend de conciliacao

Quando recebia `registration_id`, a rota:

1. buscava a inscricao no banco;
2. listava apenas os 50 pagamentos mais recentes do Mercado Pago;
3. tentava casar por `metadata.registration_id`;
4. se falhasse, tentava fallback por `payer.email + transaction_amount`.

Esse fallback falha quando:

- o pagador usa outro e-mail;
- o pagamento foi feito por terceiro;
- o registro saiu da janela das 50 transacoes recentes;
- o fluxo e de equipe e o e-mail operacional nao coincide com o pagador.

---

## 3. Causa raiz

A causa raiz foi a combinacao de:

- uso inconsistente de `payment_id` entre area do atleta e painel do gestor;
- reconciliacao server-side baseada em busca indireta, limitada e dependente de e-mail do pagador.

Em resumo: o sistema ja tinha o identificador forte (`payment_id`) em parte dos fluxos, mas o painel do gestor nao o aproveitava.

---

## 4. Abordagem escolhida

### 4.1 Frontend do gestor

No painel `/admin`, o botao manual de sincronizacao agora:

- usa `payment_id` quando `registration.paymentId` existir;
- so evita esse caminho para `paymentMethod === 'mercadopago_preference'`;
- mantem `registration_id` como fallback para legados e Checkout Pro.

### 4.2 Backend de status

Ao receber `registration_id`, a rota `GET /api/checkout/status` agora:

- continua carregando a inscricao;
- verifica se a propria inscricao ja tem `payment_id` persistido;
- se houver `payment_id` real e o metodo nao for `mercadopago_preference`, consulta diretamente `/v1/payments/{payment_id}`;
- usa a busca por lista apenas quando nao houver `payment_id` utilizavel ou quando o fluxo exigir fallback.

### 4.3 Preservacao de compatibilidade

Nao houve:

- mudanca de contrato de API;
- novo endpoint;
- novo parametro;
- mudanca de schema.

O ajuste foi apenas na ordem de lookup e na estrategia de conciliacao.

---

## 5. Alternativas consideradas

### Alternativa A — Ajustar apenas o botao do gestor

**Vantagem:** menor mudanca possivel.  
**Problema:** outros chamadores ainda dependeriam da reconciliacao fragil por `registration_id`.

### Alternativa B — Reconciliacao totalmente nova

**Vantagem:** resolveria legados, Checkout Pro e historicos com estrategia unica.  
**Problema:** escopo maior, mais risco e mais superficie de regressao para um incidente que hoje tem hot path claro em Pix/cartao.

### Alternativa escolhida — Hotfix + hardening pontual

Entrega o ganho imediato no painel e reduz a fragilidade no backend sem ampliar escopo para schema, webhooks ou migracoes.

---

## 6. Riscos conhecidos

### `mercadopago_preference`

Nesse fluxo, o `payment_id` salvo na inscricao pode ser o ID da preference, nao o ID final do pagamento. Por isso, a consulta direta foi explicitamente bloqueada para esse metodo, mantendo o fallback por `registration_id`.

### Historicos sem `payment_id`

Registros legados ou incompletos continuam dependendo da busca indireta. Esta correcao melhora o caminho principal, mas nao substitui uma futura rotina de reconciliacao mais ampla.

### Busca limitada do fallback

A busca de fallback continua limitada a 50 transacoes recentes. Isso permanece como limitacao conhecida fora do escopo deste hotfix.

---

## 7. Validacao prevista

- Cobrir em teste o clique manual do gestor priorizando `payment_id`.
- Cobrir em teste que `GET /api/checkout/status` prioriza `registration.payment_id`.
- Cobrir em teste que `mercadopago_preference` continua fora da consulta direta.
- Validar localmente com `npm run lint`, `npm run typecheck`, `npm test` e `npm run build`.
