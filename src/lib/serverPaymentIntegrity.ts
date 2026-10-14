import type { SupabaseClient } from '@supabase/supabase-js';
import {
  isApprovedPaymentStatus,
  PAYMENT_INTEGRITY_LOG_PREFIX,
  resolvePaymentIntegrityMode,
  reviewPaymentIntegrity,
  type PaymentIntegrityPayment
} from '@/lib/paymentIntegrity';

export type PaymentIntegritySource = 'mp-status' | 'mp-webhook' | 'stripe-webhook';

type RegistrationAmountsRow = {
  total_paid?: unknown;
  service_fee_amount?: unknown;
  currency?: unknown;
};

const loadEventCurrency = async (supabaseAdmin: SupabaseClient, eventId: string): Promise<string | null> => {
  try {
    const { data, error } = await supabaseAdmin
      .from('events')
      .select('currency')
      .eq('id', eventId)
      .maybeSingle<{ currency: string | null }>();
    if (error || !data) return null;
    return data.currency || 'BRL';
  } catch {
    return null;
  }
};

// Moeda gravada na inscrição; com a coluna vazia vale a do evento, pela mesma
// regra de resolveEventPaymentContext. Sem nenhuma das duas, a moeda não é conferida.
const resolveRegistrationCurrency = async (
  supabaseAdmin: SupabaseClient,
  registration: RegistrationAmountsRow | null | undefined,
  eventId: string
): Promise<string | null> => {
  const own = typeof registration?.currency === 'string' ? registration.currency.trim() : '';
  if (own) return own;
  return eventId ? loadEventCurrency(supabaseAdmin, eventId) : null;
};

/**
 * Confere, antes de gravar a aprovação, que o pagamento corresponde à inscrição
 * (regras em paymentIntegrity.ts). O modo vem de PAYMENT_INTEGRITY_MODE:
 * 'observe' (padrão) só registra o aviso e não muda nada; 'enforce' devolve
 * holdForReview para a rota gravar payment_in_review no lugar da aprovação;
 * 'off' não confere. Nunca lança. Inscrição gratuita (total 0) nasce aprovada
 * em /api/registrations/start ou na Bilheteria, sem pagamento, e não passa aqui.
 */
export const reviewPaymentBeforeApproval = async (
  supabaseAdmin: SupabaseClient,
  input: {
    source: PaymentIntegritySource;
    eventId: string;
    registrationId: string;
    registration: RegistrationAmountsRow | null | undefined;
    payment: PaymentIntegrityPayment;
  }
): Promise<{ holdForReview: boolean }> => {
  const mode = resolvePaymentIntegrityMode(process.env.PAYMENT_INTEGRITY_MODE);
  if (mode === 'off' || !isApprovedPaymentStatus(input.payment?.gateway, input.payment?.status)) {
    return { holdForReview: false };
  }

  try {
    const currency = await resolveRegistrationCurrency(supabaseAdmin, input.registration, input.eventId);
    const review = reviewPaymentIntegrity({
      mode,
      source: input.source,
      eventId: input.eventId,
      registration: {
        id: input.registrationId,
        totalPaid: input.registration?.total_paid,
        serviceFeeAmount: input.registration?.service_fee_amount,
        currency
      },
      payment: input.payment
    });
    if (review.warning) console.warn(review.warning);
    return { holdForReview: review.hold };
  } catch (err) {
    // Conferência que não pôde rodar: em 'observe' o fluxo segue como hoje; em
    // 'enforce' a aprovação fica para revisão, pois nada foi conferido.
    console.error(`${PAYMENT_INTEGRITY_LOG_PREFIX} ${JSON.stringify({
      mode,
      source: input.source,
      registrationId: input.registrationId ?? null,
      eventId: input.eventId ?? null,
      error: err instanceof Error ? err.message : String(err)
    })}`);
    return { holdForReview: mode === 'enforce' };
  }
};
