import type { EventCurrency, PaymentGateway } from '@/types';

// BRL sempre roteia para o Mercado Pago (único gateway que opera no Brasil
// hoje); EUR/GBP roteiam para o Stripe, que não exige CPF e opera na UE/UK.
// `events.payment_gateway` existe como escape hatch para um caso futuro fora
// dessa regra, mas o valor é sempre pré-calculado a partir da moeda.
export const resolveGatewayForCurrency = (currency: EventCurrency): PaymentGateway =>
  currency === 'BRL' ? 'mercadopago' : 'stripe';

export const resolveGateway = (event: { currency?: EventCurrency; paymentGateway?: PaymentGateway }): PaymentGateway =>
  event.paymentGateway ?? resolveGatewayForCurrency(event.currency ?? 'BRL');

export const isPixSupported = (currency: EventCurrency): boolean => currency === 'BRL';
