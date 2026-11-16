import type { SupabaseClient } from '@supabase/supabase-js';
import {
  decidePaymentTransition,
  PAID_AFTER_CANCELLATION_DETAIL,
  PAYMENT_TRANSITION_LOG_PREFIX,
  type PaymentTransitionDecision,
  type PaymentTransitionPayment,
  type RegistrationPaymentStatusValue
} from '@/lib/paymentStatusTransition';

// Gravação do status de pagamento de uma inscrição pela regra única de
// paymentStatusTransition.ts (Story 1.137). Toda rota que grava o status a
// partir de um pagamento passa por aqui: webhooks do Mercado Pago e do Stripe,
// consulta de status e criação de cobrança por PIX e cartão.

export type PaymentTransitionSource = 'mp-webhook' | 'mp-status' | 'mp-pix' | 'mp-card' | 'stripe-webhook';

// Colunas da inscrição que a regra lê.
export type PaymentTransitionRow = {
  payment_status?: string | null;
  payment_id?: string | null;
  payment_method?: string | null;
  payment_status_detail?: string | null;
  cancelled_by?: string | null;
  cancelled_at?: string | null;
};

export type PaymentTransitionOutcome =
  | 'applied'
  | 'ignored'
  | 'paid_after_cancellation'
  | 'refund_after_cancellation';

export type PaymentTransitionWriteResult = {
  outcome: PaymentTransitionOutcome;
  decision: PaymentTransitionDecision;
  // Status da inscrição depois da chamada (gravado ou mantido).
  status: string | null;
  // A inscrição passou a aprovada nesta gravação (dispara cupom e e-mail).
  becameApproved: boolean;
  error: unknown | null;
};

type WriteInput = {
  source: PaymentTransitionSource;
  registrationId: string;
  eventId?: string | null;
  registration: PaymentTransitionRow | null | undefined;
  payment: PaymentTransitionPayment;
  nextStatus: RegistrationPaymentStatusValue;
  isNewAttempt?: boolean;
  // Demais colunas que a rota grava junto com o status (payment_id,
  // payment_method, valores...). Sem payment_status nem updated_at.
  fields: Record<string, unknown>;
};

// Colunas do pagamento que valem guardar quando ele chega depois do cancelamento:
// é o dinheiro que o gestor precisa devolver.
const LATE_PAYMENT_COLUMNS = ['payment_id', 'payment_method', 'amount_collected', 'application_fee_charged'];

const logTransition = (input: WriteInput, details: Record<string, unknown>) => {
  // Sem dados pessoais: só ids e status.
  console.warn(`${PAYMENT_TRANSITION_LOG_PREFIX} ${JSON.stringify({
    source: input.source,
    registrationId: input.registrationId,
    eventId: input.eventId ?? null,
    paymentId: input.payment.id === undefined || input.payment.id === null ? null : String(input.payment.id),
    paymentStatus: typeof input.payment.status === 'string' ? input.payment.status : null,
    currentStatus: input.registration?.payment_status ?? null,
    currentPaymentId: input.registration?.payment_id ?? null,
    ...details
  })}`);
};

const loadTransitionRow = async (
  supabaseAdmin: SupabaseClient,
  registrationId: string,
  eventId?: string | null
): Promise<{ row: PaymentTransitionRow | null; error: unknown | null }> => {
  let query = supabaseAdmin
    .from('registrations')
    .select('payment_status, payment_id, payment_method, payment_status_detail, cancelled_by, cancelled_at')
    .eq('id', registrationId);
  if (eventId) query = query.eq('event_id', eventId);
  const { data, error } = await query.maybeSingle();
  return { row: (data as PaymentTransitionRow | null) ?? null, error: error ?? null };
};

const buildPatch = (
  decision: PaymentTransitionDecision,
  input: WriteInput,
  now: string
): Record<string, unknown> | null => {
  if (decision.action === 'ignore') return null;

  if (decision.action === 'paid_after_cancellation') {
    const patch: Record<string, unknown> = {
      payment_status_detail: PAID_AFTER_CANCELLATION_DETAIL,
      updated_at: now
    };
    for (const column of LATE_PAYMENT_COLUMNS) {
      const value = input.fields[column];
      if (value === undefined || value === null) continue;
      if (typeof value === 'number' && !(value > 0)) continue;
      patch[column] = value;
    }
    return patch;
  }

  if (decision.action === 'refund_after_cancellation') {
    return { payment_status_detail: decision.statusDetail, updated_at: now };
  }

  return {
    ...input.fields,
    payment_status: decision.status,
    ...(decision.statusDetail ? { payment_status_detail: decision.statusDetail, payment_error_message: null } : {}),
    ...(decision.cancelledNow && !input.registration?.cancelled_at ? { cancelled_at: now } : {}),
    updated_at: now
  };
};

const OUTCOME_BY_ACTION: Record<PaymentTransitionDecision['action'], PaymentTransitionOutcome> = {
  apply: 'applied',
  ignore: 'ignored',
  paid_after_cancellation: 'paid_after_cancellation',
  refund_after_cancellation: 'refund_after_cancellation'
};

/**
 * Decide pela regra única e grava. A gravação só acontece se o status da
 * inscrição ainda for o que foi lido (comparar e gravar): se outro aviso mudou
 * a inscrição no meio do caminho, ela é relida e a regra roda de novo, uma vez.
 * Aviso ignorado não grava nada e fica registrado no log.
 */
export const writePaymentTransition = async (
  supabaseAdmin: SupabaseClient,
  input: WriteInput,
  attempt = 0
): Promise<PaymentTransitionWriteResult> => {
  const currentStatus = input.registration?.payment_status ?? null;
  const decision = decidePaymentTransition({
    registration: {
      paymentStatus: currentStatus,
      paymentId: input.registration?.payment_id,
      paymentMethod: input.registration?.payment_method,
      paymentStatusDetail: input.registration?.payment_status_detail,
      cancelledBy: input.registration?.cancelled_by,
      cancelledAt: input.registration?.cancelled_at
    },
    payment: input.payment,
    nextStatus: input.nextStatus,
    isNewAttempt: input.isNewAttempt
  });

  const now = new Date().toISOString();
  const patch = buildPatch(decision, input, now);

  if (!patch) {
    logTransition(input, { decision: 'ignored', reason: decision.action === 'ignore' ? decision.reason : null });
    return { outcome: 'ignored', decision, status: currentStatus, becameApproved: false, error: null };
  }

  let query = supabaseAdmin.from('registrations').update(patch).eq('id', input.registrationId);
  if (input.eventId) query = query.eq('event_id', input.eventId);
  query = currentStatus === null ? query.is('payment_status', null) : query.eq('payment_status', currentStatus);
  const { data, error } = await query.select('payment_status');

  if (error) {
    return { outcome: OUTCOME_BY_ACTION[decision.action], decision, status: currentStatus, becameApproved: false, error };
  }

  const written = Array.isArray(data) ? data : (data ? [data] : []);
  if (written.length === 0) {
    // O status mudou desde a leitura (ou a inscrição não existe): relê e decide de novo.
    if (attempt === 0) {
      const reloaded = await loadTransitionRow(supabaseAdmin, input.registrationId, input.eventId);
      // Falha ao reler sobe como erro: o webhook responde 500 e o gateway reenvia o aviso.
      if (reloaded.error) {
        return { outcome: OUTCOME_BY_ACTION[decision.action], decision, status: currentStatus, becameApproved: false, error: reloaded.error };
      }
      if (reloaded.row) {
        return writePaymentTransition(supabaseAdmin, { ...input, registration: reloaded.row }, attempt + 1);
      }
    }
    logTransition(input, { decision: 'not_written', reason: 'registration_changed_or_missing' });
    return { outcome: 'ignored', decision, status: currentStatus, becameApproved: false, error: null };
  }

  const finalStatus = (written[0] as { payment_status?: string | null }).payment_status ?? null;
  if (decision.action !== 'apply') {
    logTransition(input, { decision: decision.action });
  }

  return {
    outcome: OUTCOME_BY_ACTION[decision.action],
    decision,
    status: finalStatus,
    becameApproved: currentStatus !== 'payment_approved' && finalStatus === 'payment_approved',
    error: null
  };
};
