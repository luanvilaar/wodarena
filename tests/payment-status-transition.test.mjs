import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PAID_AFTER_CANCELLATION_DETAIL,
  decidePaymentTransition,
  getNewPaymentBlockReason,
  getRefundKind,
  isCancelledByManager,
  isGatewayApprovedStatus
} from '../src/lib/paymentStatusTransition.ts';

// Story 1.137: regra única de mudança do status de pagamento da inscrição. Uma
// inscrição pode ter várias tentativas de pagamento; o aviso de uma tentativa
// antiga não desfaz o que a tentativa que valeu fez.

const PIX_OLD = '188547354042';
const CARD = '188600000001';
const PIX_NEW = '188700000002';

const mp = (id, status, extra = {}) => ({ gateway: 'mercadopago', id, status, ...extra });
const stripe = (id, status) => ({ gateway: 'stripe', id, status });

const approvedBy = (paymentId, extra = {}) => ({
  paymentStatus: 'payment_approved',
  paymentId,
  paymentMethod: 'master',
  cancelledBy: null,
  cancelledAt: null,
  ...extra
});

const cancelledByManager = (extra = {}) => ({
  paymentStatus: 'payment_cancelled',
  paymentId: PIX_OLD,
  paymentMethod: 'pix',
  cancelledBy: 'org-1',
  cancelledAt: '2026-11-10T12:00:00.000Z',
  ...extra
});

test('aprovada: o PIX antigo que expirou não derruba a inscrição paga com outro pagamento', () => {
  const decision = decidePaymentTransition({
    registration: approvedBy(CARD),
    payment: mp(PIX_OLD, 'cancelled'),
    nextStatus: 'payment_cancelled'
  });
  assert.deepEqual(decision, { action: 'ignore', reason: 'approved_by_other_payment' });
});

test('aprovada: recusa, análise ou pendência de outro pagamento também não mudam nada', () => {
  for (const [status, nextStatus] of [['rejected', 'payment_failed'], ['in_process', 'payment_in_review'], ['pending', 'payment_pending']]) {
    const decision = decidePaymentTransition({ registration: approvedBy(CARD), payment: mp(PIX_OLD, status), nextStatus });
    assert.deepEqual(decision, { action: 'ignore', reason: 'approved_by_other_payment' }, status);
  }
});

test('aprovada: outro pagamento aprovado é pagamento em dobro, registrado e sem mudar a inscrição', () => {
  const decision = decidePaymentTransition({ registration: approvedBy(CARD), payment: mp(PIX_NEW, 'approved'), nextStatus: 'payment_approved' });
  assert.deepEqual(decision, { action: 'ignore', reason: 'duplicate_payment' });
});

test('aprovada sem pagamento (gratuita ou bilheteria): nenhum aviso muda a inscrição', () => {
  const free = approvedBy(null, { paymentMethod: 'free' });
  assert.equal(decidePaymentTransition({ registration: free, payment: mp(PIX_OLD, 'cancelled'), nextStatus: 'payment_cancelled' }).action, 'ignore');
  assert.equal(decidePaymentTransition({ registration: free, payment: mp(PIX_OLD, 'approved'), nextStatus: 'payment_approved' }).action, 'ignore');
});

test('aprovada: o próprio pagamento reconfirmado segue aprovado; com a conferência segurando, vai para análise', () => {
  assert.deepEqual(
    decidePaymentTransition({ registration: approvedBy(CARD), payment: mp(CARD, 'approved'), nextStatus: 'payment_approved' }),
    { action: 'apply', status: 'payment_approved' }
  );
  assert.deepEqual(
    decidePaymentTransition({ registration: approvedBy(CARD), payment: mp(Number(CARD), 'approved'), nextStatus: 'payment_in_review' }),
    { action: 'apply', status: 'payment_in_review' }
  );
});

test('aprovada: estorno ou contestação do próprio pagamento cancela a inscrição com o motivo', () => {
  for (const status of ['refunded', 'charged_back']) {
    assert.deepEqual(
      decidePaymentTransition({ registration: approvedBy(CARD), payment: mp(CARD, status), nextStatus: 'payment_cancelled' }),
      { action: 'apply', status: 'payment_cancelled', statusDetail: status, cancelledNow: true }
    );
  }
});

test('aprovada: estorno de outro pagamento não mexe na inscrição', () => {
  assert.deepEqual(
    decidePaymentTransition({ registration: approvedBy(CARD), payment: mp(PIX_OLD, 'refunded'), nextStatus: 'payment_cancelled' }),
    { action: 'ignore', reason: 'approved_by_other_payment' }
  );
});

test('aprovada: o próprio pagamento em disputa aberta ou outro status estranho não rebaixa', () => {
  for (const status of ['in_mediation', 'cancelled', 'pending']) {
    assert.deepEqual(
      decidePaymentTransition({ registration: approvedBy(CARD), payment: mp(CARD, status), nextStatus: 'payment_pending' }),
      { action: 'ignore', reason: 'approved_payment_unchanged' },
      status
    );
  }
});

test('cancelada pelo gestor: pagamento aprovado depois do cancelamento fica marcado, sem reabrir', () => {
  assert.deepEqual(
    decidePaymentTransition({ registration: cancelledByManager(), payment: mp(CARD, 'approved'), nextStatus: 'payment_approved' }),
    { action: 'paid_after_cancellation' }
  );
  // O PIX que estava pendente quando o gestor cancelou e foi pago depois.
  assert.deepEqual(
    decidePaymentTransition({
      registration: cancelledByManager(),
      payment: mp(PIX_OLD, 'approved', { approvedAt: '2026-11-10T15:00:00.000-03:00' }),
      nextStatus: 'payment_approved'
    }),
    { action: 'paid_after_cancellation' }
  );
});

test('cancelada pelo gestor: o pagamento que já tinha aprovado a inscrição, reenviado, não é novidade', () => {
  for (const approvedAt of ['2026-11-09T10:00:00.000-03:00', undefined, 'data inválida']) {
    assert.deepEqual(
      decidePaymentTransition({ registration: cancelledByManager(), payment: mp(PIX_OLD, 'approved', { approvedAt }), nextStatus: 'payment_approved' }),
      { action: 'ignore', reason: 'cancelled_by_manager' },
      String(approvedAt)
    );
  }
});

test('cancelada pelo gestor: estorno do pagamento da inscrição só troca o detalhe; outros avisos não mudam nada', () => {
  assert.deepEqual(
    decidePaymentTransition({ registration: cancelledByManager(), payment: mp(PIX_OLD, 'refunded'), nextStatus: 'payment_cancelled' }),
    { action: 'refund_after_cancellation', statusDetail: 'refunded' }
  );
  for (const [payment, nextStatus] of [
    [mp(CARD, 'refunded'), 'payment_cancelled'],
    [mp(PIX_OLD, 'cancelled'), 'payment_cancelled'],
    [mp(CARD, 'rejected'), 'payment_failed'],
    [stripe('pi_1', 'succeeded'), 'payment_approved']
  ]) {
    const decision = decidePaymentTransition({ registration: cancelledByManager({ paymentId: 'pi_0' }), payment, nextStatus });
    if (payment.gateway === 'stripe') assert.deepEqual(decision, { action: 'paid_after_cancellation' });
    else assert.deepEqual(decision, { action: 'ignore', reason: 'cancelled_by_manager' });
  }
});

test('cancelada sem o gestor (PIX expirado): um pagamento aprovado depois vale, como hoje', () => {
  const expired = { paymentStatus: 'payment_cancelled', paymentId: PIX_OLD, paymentMethod: 'pix', cancelledBy: null };
  assert.deepEqual(
    decidePaymentTransition({ registration: expired, payment: mp(CARD, 'approved'), nextStatus: 'payment_approved' }),
    { action: 'apply', status: 'payment_approved' }
  );
});

test('pendente: aviso não aprovado de uma tentativa antiga não derruba a tentativa em andamento', () => {
  const pendingNewPix = { paymentStatus: 'payment_pending', paymentId: PIX_NEW, paymentMethod: 'pix' };
  assert.deepEqual(
    decidePaymentTransition({ registration: pendingNewPix, payment: mp(PIX_OLD, 'cancelled'), nextStatus: 'payment_cancelled' }),
    { action: 'ignore', reason: 'older_attempt' }
  );
  const inReview = { paymentStatus: 'payment_in_review', paymentId: CARD, paymentMethod: 'master' };
  assert.deepEqual(
    decidePaymentTransition({ registration: inReview, payment: mp(PIX_OLD, 'cancelled'), nextStatus: 'payment_cancelled' }),
    { action: 'ignore', reason: 'older_attempt' }
  );
});

test('pendente: o aviso da tentativa atual vale; aprovado de qualquer tentativa sempre vale', () => {
  const pending = { paymentStatus: 'payment_pending', paymentId: PIX_NEW, paymentMethod: 'pix' };
  assert.deepEqual(
    decidePaymentTransition({ registration: pending, payment: mp(PIX_NEW, 'cancelled'), nextStatus: 'payment_cancelled' }),
    { action: 'apply', status: 'payment_cancelled' }
  );
  assert.deepEqual(
    decidePaymentTransition({ registration: pending, payment: mp(PIX_OLD, 'approved'), nextStatus: 'payment_approved' }),
    { action: 'apply', status: 'payment_approved' }
  );
});

test('pendente pelo link do Mercado Pago (id da preferência) ou sem pagamento: avisos aplicam como hoje', () => {
  const preference = { paymentStatus: 'payment_pending', paymentId: '299411356-abc', paymentMethod: 'mercadopago_preference' };
  assert.deepEqual(
    decidePaymentTransition({ registration: preference, payment: mp(CARD, 'rejected'), nextStatus: 'payment_failed' }),
    { action: 'apply', status: 'payment_failed' }
  );
  const stripePending = { paymentStatus: 'payment_pending', paymentId: null, paymentMethod: 'stripe_checkout' };
  assert.deepEqual(
    decidePaymentTransition({ registration: stripePending, payment: stripe('pi_1', 'requires_payment_method'), nextStatus: 'payment_failed' }),
    { action: 'apply', status: 'payment_failed' }
  );
});

test('cobrança nova (PIX ou cartão) substitui a tentativa em andamento, mas não a aprovada', () => {
  const pending = { paymentStatus: 'payment_pending', paymentId: PIX_OLD, paymentMethod: 'pix' };
  assert.deepEqual(
    decidePaymentTransition({ registration: pending, payment: mp(CARD, 'rejected'), nextStatus: 'payment_failed', isNewAttempt: true }),
    { action: 'apply', status: 'payment_failed' }
  );
  assert.deepEqual(
    decidePaymentTransition({ registration: approvedBy(PIX_OLD), payment: mp(CARD, 'rejected'), nextStatus: 'payment_failed', isNewAttempt: true }),
    { action: 'ignore', reason: 'approved_by_other_payment' }
  );
});

test('recusada: estorno de outra tentativa não muda nada; o da própria cancela', () => {
  const failed = { paymentStatus: 'payment_failed', paymentId: CARD, paymentMethod: 'master' };
  assert.deepEqual(
    decidePaymentTransition({ registration: failed, payment: mp(PIX_OLD, 'refunded'), nextStatus: 'payment_cancelled' }),
    { action: 'ignore', reason: 'older_attempt' }
  );
  const inReview = { paymentStatus: 'payment_in_review', paymentId: CARD, paymentMethod: 'master' };
  assert.deepEqual(
    decidePaymentTransition({ registration: inReview, payment: mp(CARD, 'charged_back'), nextStatus: 'payment_cancelled' }),
    { action: 'apply', status: 'payment_cancelled', statusDetail: 'charged_back', cancelledNow: true }
  );
});

test('status e auxiliares', () => {
  assert.equal(isGatewayApprovedStatus('mercadopago', 'approved'), true);
  assert.equal(isGatewayApprovedStatus('stripe', 'succeeded'), true);
  assert.equal(isGatewayApprovedStatus('stripe', 'approved'), false);
  assert.equal(getRefundKind('mercadopago', 'refunded'), 'refunded');
  assert.equal(getRefundKind('mercadopago', 'charged_back'), 'charged_back');
  assert.equal(getRefundKind('stripe', 'refunded'), null);
  assert.equal(isCancelledByManager({ paymentStatus: 'payment_cancelled', cancelledBy: '  ' }), false);
  assert.equal(PAID_AFTER_CANCELLATION_DETAIL, 'paid_after_cancellation');
});

test('nova cobrança: inscrição aprovada já está paga; cancelada pelo gestor não volta; o resto aceita', () => {
  assert.equal(getNewPaymentBlockReason({ paymentStatus: 'payment_approved' }), 'already_paid');
  assert.equal(getNewPaymentBlockReason({ paymentStatus: 'payment_cancelled', cancelledBy: 'org-1' }), 'cancelled_by_manager');
  for (const paymentStatus of ['payment_pending', 'payment_failed', 'payment_in_review', 'payment_cancelled', null]) {
    assert.equal(getNewPaymentBlockReason({ paymentStatus, cancelledBy: null }), null, String(paymentStatus));
  }
});

test('pendente pelo link: PIX ou cartão criados direto antes do link não derrubam o link; pagamentos do link e sem marca aplicam', () => {
  const preference = { paymentStatus: 'payment_pending', paymentId: '299411356-abc', paymentMethod: 'mercadopago_preference' };
  for (const checkoutKind of ['pix', 'card']) {
    assert.deepEqual(
      decidePaymentTransition({ registration: preference, payment: mp(PIX_OLD, 'cancelled', { checkoutKind }), nextStatus: 'payment_cancelled' }),
      { action: 'ignore', reason: 'older_attempt' },
      checkoutKind
    );
  }
  assert.deepEqual(
    decidePaymentTransition({ registration: preference, payment: mp(CARD, 'rejected', { checkoutKind: 'preference' }), nextStatus: 'payment_failed' }),
    { action: 'apply', status: 'payment_failed' }
  );
  // PIX direto aprovado depois do link: o dinheiro entrou, vale.
  assert.deepEqual(
    decidePaymentTransition({ registration: preference, payment: mp(PIX_OLD, 'approved', { checkoutKind: 'pix' }), nextStatus: 'payment_approved' }),
    { action: 'apply', status: 'payment_approved' }
  );
});

test('estornada: a leitura atrasada do mesmo pagamento como aprovado não reabre; outro pagamento aprovado vale', () => {
  for (const detail of ['refunded', 'charged_back']) {
    const refunded = { paymentStatus: 'payment_cancelled', paymentId: CARD, paymentMethod: 'master', paymentStatusDetail: detail, cancelledBy: null };
    assert.deepEqual(
      decidePaymentTransition({ registration: refunded, payment: mp(CARD, 'approved'), nextStatus: 'payment_approved' }),
      { action: 'ignore', reason: 'refunded_payment' },
      detail
    );
    assert.deepEqual(
      decidePaymentTransition({ registration: refunded, payment: mp(PIX_NEW, 'approved'), nextStatus: 'payment_approved' }),
      { action: 'apply', status: 'payment_approved' },
      detail
    );
  }
});
