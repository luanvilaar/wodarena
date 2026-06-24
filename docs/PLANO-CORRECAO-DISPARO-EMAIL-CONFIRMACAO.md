# Plano de Análise e Correção — Falha no Disparo de E-mails de Confirmação

Este documento apresenta o diagnóstico técnico sobre a falha no envio de e-mails de confirmação de inscrição e pagamento no **WODArena**, propõe soluções e detalha os impactos e a recomendação da melhor abordagem.

---

## 1. Descrição Detalhada do Erro e Diagnóstico Técnico (Causa Raiz)

Durante testes reais de inscrições pagas na plataforma, constatou-se que o e-mail de confirmação de inscrição e pagamento (comprovante/voucher) não é entregue ao atleta. A integração com o serviço **Resend** foi testada e está plenamente operacional (com credenciais válidas e domínio `wodarena.com.br` devidamente verificado), o que restringe a falha à lógica do fluxo de negócio do WODArena.

### A Causa Raiz: Corrida de Status (Race Condition) e Silenciamento
A lógica de envio do e-mail de confirmação do WODArena está concentrada exclusivamente no Webhook do Mercado Pago (`/api/webhooks/mercadopago/route.ts`), sob a seguinte condicional de segurança:
```typescript
const wasApproved = existingRegistration.payment_status === 'payment_approved';

if (nextPaymentStatus === 'payment_approved' && !wasApproved) {
  sendApprovedRegistrationEmail(updatedRegistration, paymentData)
    .catch(err => console.error('[MercadoPago Webhook] Erro ao disparar e-mail:', err));
}
```

O problema ocorre devido à aprovação síncrona ou reconciliação antecipada em outras rotas da aplicação:

1. **No Cartão de Crédito:**
   * O atleta paga via Cartão. A rota `/api/checkout/card/route.ts` envia a transação ao Mercado Pago e recebe uma aprovação síncrona imediata (`approved`).
   * A rota de cartão atualiza o banco de dados definindo a inscrição como `payment_approved`.
   * Logo em seguida, o Webhook do Mercado Pago é acionado por conta do pagamento. Ao consultar o banco de dados para a inscrição, ele descobre que ela **já está com status `payment_approved`** (porque a rota de cartão já atualizou o banco).
   * Consequentemente, `wasApproved` é avaliado como `true`, a condição `!wasApproved` falha, e o Webhook **cancela silenciosamente o envio do e-mail**.
   * Como a rota de checkout de cartão não possui código para disparar e-mails, o atleta **não recebe nenhum e-mail**.

2. **No Pix (Reconciliação por Polling):**
   * O atleta paga o Pix. O frontend do WODArena, que faz consultas recorrentes (polling) ao endpoint `/api/checkout/status`, detecta a aprovação no Mercado Pago e atualiza a inscrição no banco para `payment_approved`.
   * Quando o Webhook assíncrono do Mercado Pago é processado pelo servidor, o status da inscrição no banco já foi modificado para aprovado pelo polling.
   * O Webhook vê `wasApproved = true` e **cancela silenciosamente o envio do e-mail**.
   * Como o endpoint `/api/checkout/status` não dispara e-mails, o e-mail de confirmação **também nunca é enviado**.

---

## 2. Possíveis Soluções para Correção

### Solução A: Centralização do Disparo via Helper de E-mail (Recomendada)
* **Descrição:** Criar uma função helper compartilhada `triggerRegistrationApprovedEmail(supabase, registrationId)` em `src/lib/serverCheckout.ts`. Essa função carrega os dados consolidados da inscrição, atleta e evento, e faz a chamada à API do Resend.
* **Ajuste:**
  1. Invocar o helper na rota de checkout de cartão (`/api/checkout/card/route.ts`) se o status retornado for `payment_approved`.
  2. Invocar o helper na rota de status (`/api/checkout/status/route.ts`) se a inscrição for transicionada de "não aprovada" para `payment_approved`.
  3. Invocar o helper na rota de webhook (`/api/webhooks/mercadopago/route.ts`) sob a mesma regra transicional.
* **Prós:** 
  * Resiliência total: qualquer rota que transicionar com sucesso o status da inscrição para aprovado enviará o e-mail instantaneamente.
  * O atleta recebe o e-mail em segundos (especialmente no cartão), sem depender de filas de webhooks.
* **Contras:** Requer alteração em três arquivos de rota de API para integrar a chamada.

### Solução B: Database Webhook do Supabase (Arquitetura orientada a eventos)
* **Descrição:** Desacoplar o envio de e-mails das rotas de código Next.js. Adicionar uma Trigger no banco de dados Supabase que escuta alterações no campo `payment_status` da tabela `registrations`. Quando transicionar para `payment_approved`, o Supabase dispara um Webhook interno para um endpoint de disparo de e-mail do Next.js.
* **Prós:** 
  * Garantia de execução única no nível do banco de dados, independente de qual rota fez a atualização.
* **Contras:** 
  * Dificulta a depuração e testes locais offline (o Supabase precisa de túneis HTTP para alcançar o localhost).
  * Aumenta a complexidade infraestrutural e adiciona dependências operacionais externas à aplicação Next.js.

### Solução C: Remover a validação de `!wasApproved` no Webhook
* **Descrição:** Permitir que o webhook envie o e-mail de confirmação sempre que receber o status `approved` do Mercado Pago, mesmo que a inscrição já estivesse registrada como aprovada no banco.
* **Prós:** Alteração de apenas uma linha no webhook.
* **Contras:** **Alto risco de Spam.** O Mercado Pago envia múltiplas notificações redundantes para a mesma transação aprovada (atualização de conciliação de saldo, liberação de fundos, etc). O atleta receberia vários e-mails idênticos de confirmação.

---

## 3. Análise de Riscos e Impactos

| Solução | Risco de E-mails Duplicados | UX (Rapidez no Envio) | Complexidade Operacional | Risco de Regressão |
| :--- | :--- | :--- | :--- | :--- |
| **Solução A** (Helper - Recomendada) | **Muito Baixo** (O controle transicional no banco garante que apenas a primeira rota que realiza o update dispare o e-mail) | **Excelente** (Envio instantâneo pós-pagamento no cartão de crédito) | **Muito Baixo** (Centralizado em função Next.js nativa) | **Baixo** (Código isolado e seguro) |
| **Solução B** (Supabase Webhook) | **Muito Baixo** (Garantido pela trigger de banco) | **Médio** (Adiciona o delay de envio do webhook do banco) | **Alto** (Exige configuração de triggers adicionais e RLS de webhooks) | **Médio** (Depende de infraestrutura do Supabase rodar) |
| **Solução C** (Trava desativada) | **Muito Alto** (Spam garantido com múltiplos e-mails repetidos no fluxo de pagamento) | **Excelente** | **Muito Baixo** | **Muito Baixo** |

---

## 4. Recomendação da Melhor Abordagem

Recomendamos fortemente a **Solução A**. Ela resolve estruturalmente o problema de corrida (race condition) do status, garante a entrega imediata do e-mail de confirmação no momento da aprovação do cartão de crédito (sem forçar o atleta a aguardar o processamento em segundo plano do webhook), previne duplicidade por meio de validações estritas de estado e mantém o gerenciamento de e-mails dentro do código da aplicação (Next.js), facilitando testes e manutenção futura.
