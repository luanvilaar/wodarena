# Plano de Implementação — Correção da Conciliação Automática de Pagamentos (Webhooks)

Este documento apresenta o diagnóstico detalhado e as soluções propostas para resolver o problema de pagamentos que permanecem indefinidamente com o status de `PENDENTE` no banco de dados, exigindo sincronização manual por parte dos gestores.

---

## 1. Descrição Detalhada do Erro Encontrado

Ao realizar um pagamento de inscrição (via Pix ou Cartão de Crédito), a transação é criada e aprovada no Mercado Pago com sucesso, mas o status da inscrição correspondente no WODArena não muda automaticamente de `payment_pending` para `payment_approved`. 
Como consequência, as vagas não são garantidas de imediato e os e-mails automáticos de confirmação de inscrição não são disparados. Os gestores ou atletas são obrigados a disparar manualmente a conciliação:
1. Os gestores clicando em **"Sincronizar pagamento"** no painel `/admin`.
2. O próprio sistema fazendo polling na rota `/api/checkout/status` quando a tela do atleta é aberta/focada.

---

## 2. Explicação Técnica da Causa Raiz

O processamento automático de confirmação de pagamentos deveria ocorrer de forma assíncrona por meio do endpoint de webhook localizado em `src/app/api/webhooks/mercadopago/route.ts`. 

Investigando o comportamento do arquivo [route.ts](file:///Users/luanvilaar/Desktop/Projetos/wodarena/src/app/api/webhooks/mercadopago/route.ts#L30-L50), identificamos que o problema reside na função de validação de assinatura `isValidMercadoPagoSignature`:

```typescript
const isValidMercadoPagoSignature = (
  request: Request,
  paymentId: string,
  bodyPaymentId?: string
) => {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!secret) return process.env.NODE_ENV !== 'production';

  const requestId = request.headers.get('x-request-id');
  const signatureParts = parseSignature(request.headers.get('x-signature'));
  const ts = signatureParts.ts;
  const v1 = signatureParts.v1;
  const id = bodyPaymentId || paymentId;
  if (!requestId || !ts || !v1 || !id) return false;

  const manifest = `id:${id};request-id:${requestId};ts:${ts};`;
  const expected = createHmac('sha256', secret).update(manifest).digest('hex');
  const actualBuffer = Buffer.from(v1);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
};
```

### Por que a assinatura falha em Produção?

1. **Ausência da Variável de Ambiente (`MERCADOPAGO_WEBHOOK_SECRET`):**
   Se o segredo do webhook não estiver configurado nas variáveis de ambiente da plataforma de hospedagem (Vercel/Railway) em produção, a validação retorna `process.env.NODE_ENV !== 'production'` (o que é avaliado como `false` em produção). O webhook rejeita todas as requisições com o status **401 Unauthorized**.

2. **Sobrescrita do Cabeçalho `x-request-id` por Proxies de Rede (Vercel / Cloudflare):**
   Mesmo se o `MERCADOPAGO_WEBHOOK_SECRET` estiver configurado, as plataformas modernas de hospedagem serverless (como a Vercel) costumam **sobrescrever ou alterar** o cabeçalho `X-Request-Id` com um identificador de requisição próprio gerado pelo seu load balancer. 
   Como a validação de assinatura do Mercado Pago utiliza o `request-id` original gerado e assinado em seus servidores, qualquer modificação nesse cabeçalho invalida a validação HMAC no código local. A validação falha e retorna `false`, abortando o fluxo automático.

---

## 3. Impacto do Erro para Usuários e Gestores

* **Para os Atletas (Usuários):** 
  * Experiência de compra negativa e ansiedade. Após efetuar o pagamento do Pix ou Cartão, a tela não confirma o status imediatamente a menos que o atleta mantenha o navegador aberto por um período para o polling sob demanda terminar.
  * O e-mail com o comprovante de inscrição e o QR Code (Voucher) do evento não é enviado instantaneamente.
* **Para os Gestores (Organizadores):**
  * Grande sobrecarga operacional. Em eventos com centenas de atletas, os gestores precisam acompanhar os comprovantes de pagamento e clicar repetidamente no botão "Sincronizar" no painel administrativo.
  * Risco de falha de conciliação para eventos populares onde as vagas se esgotam rapidamente (um atleta pode pagar, mas a vaga não ser reservada a tempo porque o status permaneceu pendente no sistema, gerando overbooking).

---

## 4. Soluções Consideradas

### Solução A: Configuração de Variável de Ambiente Estrita (Não Recomendada)
* **Descrição:** Configurar o `MERCADOPAGO_WEBHOOK_SECRET` em produção e tentar contornar a sobrescrita do `x-request-id` no proxy.
* **Riscos & Impacto:**
  * **Alto risco de falha contínua:** Não há garantia de que conseguiremos extrair o `x-request-id` original em ambientes como Vercel sem controle total do roteador de borda.
  * **Complexidade:** Exige configuração manual em cada novo deploy/ambiente de staging.

### Solução B: Validação por Canal Seguro API (Recomendada)
* **Descrição:** Ajustar a validação do webhook. Se a assinatura HMAC falhar ou o secret estiver ausente, o sistema realiza um fallback de validação consultando diretamente a API oficial do Mercado Pago (`https://api.mercadopago.com/v1/payments/${paymentId}`) usando o token OAuth privado do organizador do evento (que é recuperado de forma segura no banco de dados). 
* **Riscos & Impacto:**
  * **Segurança Total:** É impossível forjar uma transação aprovada, pois o sistema WODArena valida a resposta vinda diretamente do servidor oficial do Mercado Pago através do canal autenticado privado.
  * **Resiliência:** Funciona independentemente de alterações nos cabeçalhos feitas pela Vercel e dispensa a necessidade de manter a variável `MERCADOPAGO_WEBHOOK_SECRET` configurada.
  * **Latência:** Adiciona uma requisição de rede extra ao processar o webhook (assíncrono), o que é imperceptível para o usuário final.

### Solução C: Criação de Job de Conciliação em Background (Médio Prazo)
* **Descrição:** Desenvolver um script agendado (Cron Job) que periodicamente busca todas as inscrições pendentes com mais de X minutos e consulta o Mercado Pago para atualizar os status.
* **Riscos & Impacto:**
  * **Atraso:** A conciliação não seria em tempo real (dependeria do intervalo do job, ex. 5 em 5 minutos).
  * **Infraestrutura:** Exige configuração de schedulers externos e consome mais recursos do banco de dados pesquisando registros em lote.

---

## 5. Recomendação da Melhor Abordagem

Recomendamos a **Solução B (Validação por Canal Seguro API)**. 
Como o webhook de produção já faz uma chamada `fetch` para a API oficial do Mercado Pago para obter o status detalhado do pagamento (`mpResponse.json()`), nós já temos o canal seguro ativado. 

A proposta de implementação ajusta `isValidMercadoPagoSignature` para atuar como um filtro de melhor esforço (evitando chamadas desnecessárias se a assinatura estiver correta) ou, em caso de falha da assinatura, validar a requisição comparando estritamente os metadados do pagamento oficial retornado (`metadata.registration_id`) com a inscrição do banco de dados correspondente àquele evento.

---

## 6. Proposta de Alterações Código

### [Componente: API Webhook]

#### [MODIFY] [route.ts](file:///Users/luanvilaar/Desktop/Projetos/wodarena/src/app/api/webhooks/mercadopago/route.ts)

Ajustar a verificação para registrar um aviso caso a assinatura HMAC falhe, mas permitir o processamento caso a validação via API direta confirme a transação:

* Se a assinatura falhar, não retornamos `401` imediatamente.
* Prosseguimos para o fetch da transação na API do Mercado Pago usando as credenciais do organizador.
* Se a API do Mercado Pago retornar sucesso, e o `metadata.registration_id` retornado corresponder exatamente ao registro associado ao `eventId`, a requisição é considerada autêntica e processada.
* Caso contrário (se o fetch falhar ou os metadados não baterem), rejeitamos com `401`.

---

## 7. Plano de Verificação

### Testes Automatizados
* Executar os testes atuais da suite (`npm test`) para garantir que as alterações não quebram regras de negócio e de conciliação.
* Criar um teste mockando a falha da assinatura HMAC e validando que o processamento continua bem-sucedido quando a chamada à API do Mercado Pago retorna o pagamento correspondente.

### Verificação Manual
* O gestor pode testar no ambiente de produção simulando um pagamento de teste (ou usando Sandbox do Mercado Pago) e verificando se a inscrição é atualizada de forma instantânea sem necessidade de sincronização manual.
