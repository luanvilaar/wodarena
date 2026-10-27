// Conferência de que um pagamento aprovado corresponde à inscrição que ele vai
// aprovar: valor, moeda e vínculo. Módulo puro, sem imports e só com sintaxe de
// tipos apagável, para ser importado direto pelo node --test.

export const PAYMENT_INTEGRITY_MODES = ['off', 'observe', 'enforce'] as const;

export type PaymentIntegrityMode = (typeof PAYMENT_INTEGRITY_MODES)[number];

export type PaymentIntegrityReason = 'amount_mismatch' | 'currency_mismatch' | 'registration_mismatch';

export type PaymentIntegrityGateway = 'mercadopago' | 'stripe';

export type PaymentIntegrityRegistration = {
  id: unknown;
  totalPaid: unknown;
  serviceFeeAmount?: unknown;
  // Quem paga a taxa: 'athlete' | 'organizer'. Vazio (inscrição anterior à
  // escolha do gestor) vale o padrão do gateway.
  serviceFeePayer?: unknown;
  currency?: unknown;
};

export type PaymentIntegrityPayment = {
  id?: unknown;
  status: unknown;
  // Na unidade principal da moeda (165 = R$ 165,00). No Stripe, converter
  // amount_received (unidades menores) antes de chamar.
  amount: unknown;
  currency?: unknown;
  registrationId?: unknown;
  gateway: PaymentIntegrityGateway;
};

export type PaymentIntegrityResult =
  | { ok: true; skipped?: true }
  | {
    ok: false;
    reasons: PaymentIntegrityReason[];
    expected: number | null;
    paid: number | null;
    direction: 'above' | 'below' | null;
  };

export type PaymentIntegrityReview = {
  hold: boolean;
  warning: string | null;
};

export const PAYMENT_INTEGRITY_STATUS_DETAIL = 'payment_integrity_mismatch';

export const PAYMENT_INTEGRITY_LOG_PREFIX = '[Payment Integrity]';

// 0,10 na unidade principal. As moedas aceitas (BRL, EUR, GBP) têm 2 casas.
export const PAYMENT_INTEGRITY_TOLERANCE_CENTS = 10;

const CENTS_PER_UNIT = 100;

// Ausente, vazio ou qualquer valor fora de 'off' e 'enforce' vale 'observe':
// um erro de digitação nunca desliga a conferência nem passa a bloquear.
export const resolvePaymentIntegrityMode = (value: unknown): PaymentIntegrityMode => (
  value === 'off' || value === 'enforce' ? value : 'observe'
);

export const isApprovedPaymentStatus = (gateway: unknown, status: unknown): boolean => (
  (gateway === 'mercadopago' && status === 'approved')
  || (gateway === 'stripe' && status === 'succeeded')
);

const DECIMAL_AMOUNT = /^\d+(?:\.\d+)?$/;

const parseAmount = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value === 'string' && DECIMAL_AMOUNT.test(value.trim())) return Number(value.trim());
  return null;
};

// Inteiro em centavos, para a comparação não depender de arredondamento de ponto flutuante.
const toCents = (value: unknown): number | null => {
  const amount = parseAmount(value);
  if (amount === null) return null;
  const cents = Math.round((amount + Number.EPSILON) * CENTS_PER_UNIT);
  return Number.isSafeInteger(cents) ? cents : null;
};

const fromCents = (cents: number | null) => (cents === null ? null : cents / CENTS_PER_UNIT);

const asText = (value: unknown): string | null => {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
};

// Valor cobrado do atleta conforme quem paga a taxa de serviço. Pagando o atleta,
// a taxa é somada ao valor da inscrição (transaction_amount = total_paid +
// service_fee_amount no Mercado Pago; a sessão do Stripe soma a taxa ao item).
// Pagando o gestor, a taxa já está dentro de total_paid e o atleta paga só ele.
// Sem escolha gravada, o padrão é o de sempre de cada gateway: o Mercado Pago somava
// a taxa e o Stripe cobrava só total_paid. Mantido aqui, sem importar serviceFee.ts,
// para este módulo continuar sem imports.
const resolveFeePayer = (registration: PaymentIntegrityRegistration, gateway: unknown): 'athlete' | 'organizer' => {
  const payer = registration.serviceFeePayer;
  if (payer === 'athlete' || payer === 'organizer') return payer;
  return gateway === 'stripe' ? 'organizer' : 'athlete';
};

const expectedChargeCents = (registration: PaymentIntegrityRegistration, gateway: unknown): number | null => {
  const totalCents = toCents(registration.totalPaid);
  if (totalCents === null) return null;
  if (resolveFeePayer(registration, gateway) === 'organizer') return totalCents;
  const fee = registration.serviceFeeAmount;
  const feeCents = fee === null || fee === undefined ? 0 : toCents(fee);
  return feeCents === null ? null : totalCents + feeCents;
};

export const checkPaymentAgainstRegistration = (input: {
  registration: PaymentIntegrityRegistration;
  payment: PaymentIntegrityPayment;
}): PaymentIntegrityResult => {
  const registration: PaymentIntegrityRegistration = input?.registration ?? { id: null, totalPaid: null };
  const payment: Partial<PaymentIntegrityPayment> = input?.payment ?? {};

  if (!isApprovedPaymentStatus(payment.gateway, payment.status)) {
    return { ok: true, skipped: true };
  }

  const reasons: PaymentIntegrityReason[] = [];

  const expectedCents = expectedChargeCents(registration, payment.gateway);
  const paidCents = toCents(payment.amount);
  let direction: 'above' | 'below' | null = null;
  if (expectedCents === null || paidCents === null) {
    // Sem os dois valores não há como conferir: conta como divergência.
    reasons.push('amount_mismatch');
  } else if (Math.abs(paidCents - expectedCents) > PAYMENT_INTEGRITY_TOLERANCE_CENTS) {
    reasons.push('amount_mismatch');
    direction = paidCents > expectedCents ? 'above' : 'below';
  }

  const expectedCurrency = asText(registration.currency)?.toLowerCase() ?? null;
  const paidCurrency = asText(payment.currency)?.toLowerCase() ?? null;
  if (expectedCurrency && paidCurrency && expectedCurrency !== paidCurrency) {
    reasons.push('currency_mismatch');
  }

  // Só quando o pagamento informa a inscrição a que pertence.
  const paymentRegistrationId = asText(payment.registrationId);
  if (paymentRegistrationId && paymentRegistrationId !== asText(registration.id)) {
    reasons.push('registration_mismatch');
  }

  if (reasons.length === 0) return { ok: true };

  return {
    ok: false,
    reasons,
    expected: fromCents(expectedCents),
    paid: fromCents(paidCents),
    direction
  };
};

// Uma linha de JSON, sem dados pessoais: só identificadores, motivos e valores.
export const formatPaymentIntegrityWarning = (entry: {
  mode: PaymentIntegrityMode;
  source: string;
  registrationId: unknown;
  eventId: unknown;
  paymentId: unknown;
  reasons: PaymentIntegrityReason[];
  expected: number | null;
  paid: number | null;
  currency: unknown;
}): string => `${PAYMENT_INTEGRITY_LOG_PREFIX} ${JSON.stringify({
  mode: entry.mode,
  source: entry.source,
  registrationId: asText(entry.registrationId),
  eventId: asText(entry.eventId),
  paymentId: asText(entry.paymentId),
  reasons: entry.reasons,
  expected: entry.expected,
  paid: entry.paid,
  currency: asText(entry.currency)?.toUpperCase() ?? null
})}`;

// Decide o que a rota faz com o resultado: 'observe' só registra o aviso e
// 'enforce' segura a aprovação para revisão. Em 'off' não há conferência.
export const reviewPaymentIntegrity = (input: {
  mode: unknown;
  source: string;
  eventId: unknown;
  registration: PaymentIntegrityRegistration;
  payment: PaymentIntegrityPayment;
}): PaymentIntegrityReview => {
  const mode = resolvePaymentIntegrityMode(input.mode);
  if (mode === 'off') return { hold: false, warning: null };

  const result = checkPaymentAgainstRegistration({ registration: input.registration, payment: input.payment });
  if (result.ok) return { hold: false, warning: null };

  return {
    hold: mode === 'enforce',
    warning: formatPaymentIntegrityWarning({
      mode,
      source: input.source,
      registrationId: input.registration?.id,
      eventId: input.eventId,
      paymentId: input.payment?.id,
      reasons: result.reasons,
      expected: result.expected,
      paid: result.paid,
      currency: input.registration?.currency
    })
  };
};
