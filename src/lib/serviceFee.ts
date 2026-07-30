export const DEFAULT_SERVICE_FEE_PERCENT = 10;

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
  enabled = true
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
    amountCollected: fromCents(baseCents + serviceFeeCents)
  };
};
