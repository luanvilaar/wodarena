// Regra única de mudança do status de pagamento de uma inscrição a partir de um
// pagamento: aviso do gateway (webhook), consulta de status ou resposta da
// criação da cobrança (Story 1.137). Uma inscrição pode ter várias tentativas de
// pagamento (um PIX abandonado e depois o cartão, por exemplo); o aviso de uma
// tentativa antiga não pode desfazer o que a tentativa que valeu fez.
// Módulo puro, sem imports e só com sintaxe de tipos apagável, para ser
// importado direto pelo node --test.

export type RegistrationPaymentStatusValue =
  | 'payment_pending'
  | 'payment_approved'
  | 'payment_failed'
  | 'payment_in_review'
  | 'payment_cancelled';

export type PaymentTransitionGateway = 'mercadopago' | 'stripe';

// Estado atual da inscrição, como está no banco.
export type PaymentTransitionRegistration = {
  paymentStatus?: unknown;
  paymentId?: unknown;
  paymentMethod?: unknown;
  cancelledBy?: unknown;
  cancelledAt?: unknown;
};

export type PaymentTransitionPayment = {
  gateway: PaymentTransitionGateway;
  id?: unknown;
  // Status bruto do gateway (Mercado Pago: approved, rejected, cancelled,
  // refunded, charged_back...; Stripe: succeeded, canceled...).
  status?: unknown;
  // Quando o gateway aprovou o pagamento (ISO), se a resposta trouxer.
  approvedAt?: unknown;
};

export type PaymentTransitionIgnoreReason =
  // Aviso de outro pagamento numa inscrição já aprovada.
  | 'approved_by_other_payment'
  // Outro pagamento aprovado numa inscrição já aprovada: o atleta pagou duas vezes.
  | 'duplicate_payment'
  // O pagamento que aprovou a inscrição mudou para um status que não a rebaixa.
  | 'approved_payment_unchanged'
  // Inscrição cancelada pelo gestor: aviso de pagamento não muda o status.
  | 'cancelled_by_manager'
  // Tentativa antiga não derruba a tentativa atual.
  | 'older_attempt';

export type PaymentRefundKind = 'refunded' | 'charged_back';

export type PaymentTransitionDecision =
  | {
    action: 'apply';
    status: RegistrationPaymentStatusValue;
    // Detalhe que substitui o do gateway (estorno e contestação).
    statusDetail?: PaymentRefundKind;
    // A inscrição sai de aprovada agora: registrar a data do cancelamento.
    cancelledNow?: boolean;
  }
  // Pagamento aprovado numa inscrição que o gestor já tinha cancelado: ela
  // continua cancelada e fica marcada para o gestor decidir.
  | { action: 'paid_after_cancellation' }
  // Estorno ou contestação do pagamento de uma inscrição cancelada pelo gestor:
  // só o detalhe muda.
  | { action: 'refund_after_cancellation'; statusDetail: PaymentRefundKind }
  | { action: 'ignore'; reason: PaymentTransitionIgnoreReason };

export type PaymentTransitionInput = {
  registration: PaymentTransitionRegistration;
  payment: PaymentTransitionPayment;
  // Status que a rota gravaria hoje para esse pagamento (já com a conferência
  // de valores aplicada: 'payment_in_review' quando ela segura a aprovação).
  nextStatus: RegistrationPaymentStatusValue;
  // A chamada vem da criação da cobrança (rotas de PIX e cartão): a tentativa
  // nova passa a ser a atual, mesmo que outra estivesse em andamento.
  isNewAttempt?: boolean;
};

export const PAID_AFTER_CANCELLATION_DETAIL = 'paid_after_cancellation';

export const PAYMENT_TRANSITION_LOG_PREFIX = '[Payment Transition]';

// payment_id gravado pela rota de link guarda o id da preferência, não de um pagamento.
const PREFERENCE_PAYMENT_METHOD = 'mercadopago_preference';

const asText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
};

export const isGatewayApprovedStatus = (gateway: unknown, status: unknown): boolean => (
  (gateway === 'mercadopago' && status === 'approved')
  || (gateway === 'stripe' && status === 'succeeded')
);

export const getRefundKind = (gateway: unknown, status: unknown): PaymentRefundKind | null => {
  if (gateway !== 'mercadopago') return null;
  if (status === 'refunded') return 'refunded';
  if (status === 'charged_back') return 'charged_back';
  return null;
};

const toTime = (value: unknown): number | null => {
  const text = asText(value);
  if (!text) return null;
  const time = new Date(text).getTime();
  return Number.isFinite(time) ? time : null;
};

// Aprovado depois do cancelamento? Sem as duas datas, não dá para afirmar.
const approvedAfterCancellation = (approvedAt: unknown, cancelledAt: unknown) => {
  const approved = toTime(approvedAt);
  const cancelled = toTime(cancelledAt);
  return approved !== null && cancelled !== null && approved > cancelled;
};

export const isCancelledByManager = (registration: PaymentTransitionRegistration) => (
  asText(registration.paymentStatus) === 'payment_cancelled' && Boolean(asText(registration.cancelledBy))
);

const ignore = (reason: PaymentTransitionIgnoreReason): PaymentTransitionDecision => ({ action: 'ignore', reason });

export const decidePaymentTransition = ({
  registration,
  payment,
  nextStatus,
  isNewAttempt = false
}: PaymentTransitionInput): PaymentTransitionDecision => {
  const current = asText(registration.paymentStatus) || 'payment_pending';
  const currentId = asText(registration.paymentId);
  const incomingId = asText(payment.id);
  const samePayment = Boolean(currentId) && currentId === incomingId;
  const approved = isGatewayApprovedStatus(payment.gateway, payment.status);
  const refund = getRefundKind(payment.gateway, payment.status);

  // 1. Cancelada pelo gestor: nenhum aviso desfaz a decisão dele.
  if (isCancelledByManager(registration)) {
    if (approved) {
      // O mesmo pagamento reenviado (aprovado antes do cancelamento) não é novidade.
      if (samePayment && !approvedAfterCancellation(payment.approvedAt, registration.cancelledAt)) {
        return ignore('cancelled_by_manager');
      }
      return { action: 'paid_after_cancellation' };
    }
    if (refund && samePayment) return { action: 'refund_after_cancellation', statusDetail: refund };
    return ignore('cancelled_by_manager');
  }

  // 2. Aprovada: só o próprio pagamento que a aprovou muda o status, e só para
  //    estorno, contestação ou a análise da conferência de valores.
  if (current === 'payment_approved') {
    if (!samePayment) return ignore(approved ? 'duplicate_payment' : 'approved_by_other_payment');
    if (refund) return { action: 'apply', status: 'payment_cancelled', statusDetail: refund, cancelledNow: true };
    if (approved && (nextStatus === 'payment_approved' || nextStatus === 'payment_in_review')) {
      return { action: 'apply', status: nextStatus };
    }
    return ignore('approved_payment_unchanged');
  }

  // 3. Pendente, em análise, recusada ou cancelada sem o gestor (PIX expirado).
  //    Pagamento aprovado sempre vale: o dinheiro entrou.
  if (approved) return { action: 'apply', status: nextStatus };

  if (refund) {
    return samePayment
      ? { action: 'apply', status: 'payment_cancelled', statusDetail: refund, cancelledNow: true }
      : ignore('older_attempt');
  }

  // Aviso não aprovado de outra tentativa não derruba a tentativa em andamento.
  const attemptInProgress = current === 'payment_pending' || current === 'payment_in_review';
  if (
    !isNewAttempt
    && attemptInProgress
    && Boolean(currentId)
    && !samePayment
    && asText(registration.paymentMethod) !== PREFERENCE_PAYMENT_METHOD
  ) {
    return ignore('older_attempt');
  }

  return { action: 'apply', status: nextStatus };
};

export type NewPaymentBlockReason = 'already_paid' | 'cancelled_by_manager';

// Nova cobrança (PIX, cartão ou link) para esta inscrição? Aprovada já está paga;
// cancelada pelo gestor não volta por pagamento do atleta.
export const getNewPaymentBlockReason = (registration: PaymentTransitionRegistration): NewPaymentBlockReason | null => {
  if (asText(registration.paymentStatus) === 'payment_approved') return 'already_paid';
  if (isCancelledByManager(registration)) return 'cancelled_by_manager';
  return null;
};

export const NEW_PAYMENT_BLOCK_MESSAGES: Record<NewPaymentBlockReason, string> = {
  already_paid: 'Esta inscrição já está paga. O comprovante está na Área do Atleta.',
  cancelled_by_manager: 'Esta inscrição foi cancelada pela organização do evento. Fale com o organizador.'
};
