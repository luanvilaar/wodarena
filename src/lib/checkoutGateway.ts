import { SupabaseClient } from '@supabase/supabase-js';
import type { EventCountryCode, EventCurrency, PaymentGateway } from '@/types';
import { resolveGateway } from '@/lib/paymentGateway';
import { getTaxIdRequirement, TaxIdRequirement } from '@/lib/taxId';

export class CheckoutGatewayError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

export type EventPaymentContext = {
  gateway: PaymentGateway;
  currency: EventCurrency;
  countryCode: EventCountryCode;
  taxIdRequirement: TaxIdRequirement;
};

type EventGatewayRow = {
  country_code: EventCountryCode | null;
  currency: EventCurrency | null;
  payment_gateway: PaymentGateway | null;
};

/**
 * Ponto único de decisão de qual gateway processa o checkout de um evento —
 * usado pelos dispatchers em /api/checkout/* para rotear entre Mercado Pago
 * (BRL) e Stripe (EUR/GBP) sem duplicar a regra em cada rota.
 */
export const resolveEventPaymentContext = async (
  supabaseAdmin: SupabaseClient,
  eventId: string
): Promise<EventPaymentContext> => {
  if (!eventId) {
    throw new CheckoutGatewayError('Evento obrigatório para processar pagamento.', 400);
  }

  const { data: event, error } = await supabaseAdmin
    .from('events')
    .select('country_code, currency, payment_gateway')
    .eq('id', eventId)
    .maybeSingle<EventGatewayRow>();

  if (error || !event) {
    throw new CheckoutGatewayError('Evento não encontrado para processar pagamento.', 404);
  }

  const countryCode = event.country_code || 'BR';
  const currency = event.currency || 'BRL';

  return {
    gateway: resolveGateway({ currency, paymentGateway: event.payment_gateway || undefined }),
    currency,
    countryCode,
    taxIdRequirement: getTaxIdRequirement(countryCode)
  };
};
