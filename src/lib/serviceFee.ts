export const DEFAULT_SERVICE_FEE_PERCENT = 10;

// Quem arca com a taxa da plataforma. 'athlete': somada ao valor da inscrição e
// mostrada ao atleta. 'organizer': já está dentro do valor da inscrição e sai do
// que o gestor recebe. O gestor escolhe (manager_payment_settings); inscrição
// anterior à escolha guarda null e vale o padrão do gateway.
export const SERVICE_FEE_PAYERS = ['athlete', 'organizer'] as const;

export type ServiceFeePayer = (typeof SERVICE_FEE_PAYERS)[number];

export type ServiceFeeGateway = 'mercadopago' | 'stripe';

export const normalizeServiceFeePayer = (value: unknown): ServiceFeePayer | null => (
  value === 'athlete' || value === 'organizer' ? value : null
);

// O Mercado Pago sempre somou a taxa ao valor do atleta. A Stripe sempre cobrou
// só a inscrição e retirou a taxa do gestor (application_fee_amount): manter isso
// como padrão não muda o preço de ninguém até o gestor escolher.
export const defaultServiceFeePayer = (gateway: unknown): ServiceFeePayer => (
  gateway === 'stripe' ? 'organizer' : 'athlete'
);

export const resolveServiceFeePayer = (value: unknown, gateway: unknown): ServiceFeePayer => (
  normalizeServiceFeePayer(value) ?? defaultServiceFeePayer(gateway)
);

export type ServiceFeeBreakdown = {
  baseAmount: number;
  serviceFeePercent: number;
  serviceFeeAmount: number;
  amountCollected: number;
};

const toCents = (amount: number) => Math.max(0, Math.round((amount + Number.EPSILON) * 100));

const fromCents = (amount: number) => amount / 100;

export const normalizeServiceFeePercent = (value: unknown, fallback = DEFAULT_SERVICE_FEE_PERCENT) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed >= 100) return fallback;
  return parsed;
};

export const calculateServiceFee = (
  baseAmount: number,
  serviceFeePercent = DEFAULT_SERVICE_FEE_PERCENT,
  enabled = true,
  payer: ServiceFeePayer = 'athlete'
): ServiceFeeBreakdown => {
  const baseCents = toCents(baseAmount);
  const percent = normalizeServiceFeePercent(serviceFeePercent);
  const serviceFeeCents = enabled && baseCents > 0
    ? Math.round((baseCents * percent) / 100)
    : 0;

  return {
    baseAmount: fromCents(baseCents),
    serviceFeePercent: enabled ? percent : 0,
    serviceFeeAmount: fromCents(serviceFeeCents),
    // A taxa é sempre o mesmo percentual da inscrição; só muda se o atleta paga por cima.
    amountCollected: fromCents(payer === 'organizer' ? baseCents : baseCents + serviceFeeCents)
  };
};

/**
 * Valor que o gestor recebe e total cobrado do atleta para uma inscrição já
 * gravada, a partir de `total_paid` (o valor da inscrição) e da taxa.
 */
export const splitRegistrationAmounts = (
  totalPaid: number,
  serviceFeeAmount: number,
  payer: ServiceFeePayer
) => {
  const totalCents = toCents(totalPaid);
  const feeCents = toCents(serviceFeeAmount);
  return payer === 'organizer'
    ? { organizerReceives: fromCents(Math.max(0, totalCents - feeCents)), athletePays: fromCents(totalCents) }
    : { organizerReceives: fromCents(totalCents), athletePays: fromCents(totalCents + feeCents) };
};
