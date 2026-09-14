import Stripe from 'stripe';
import { createSupabaseAdmin } from '@/lib/serverSecurity';
import { DEFAULT_SERVICE_FEE_PERCENT, normalizeServiceFeePercent } from '@/lib/serviceFee';
import type { EventCurrency } from '@/types';

type StripeEventRow = {
  organizer_id: string;
  currency: EventCurrency | null;
};

type StripeAccountRow = {
  stripe_account_id: string;
  country: string;
  default_currency: string;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  status: string;
};

type PlatformSettingsRow = {
  service_fee_enabled: boolean | null;
  service_fee_percent: number | string | null;
};

export type ServiceFeeConfig = {
  serviceFeeEnabled: boolean;
  serviceFeePercent: number;
};

export type StripeCheckoutConfig = ServiceFeeConfig & {
  stripeAccountId: string;
  currency: EventCurrency;
  organizerId: string;
};

export type StripePublicConfig = ServiceFeeConfig & {
  publishableKey: string;
  stripeAccountId: string;
  currency: EventCurrency;
  organizerId: string;
};

export class StripeConfigError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

const getSupabaseAdmin = () => {
  try {
    return createSupabaseAdmin();
  } catch {
    throw new StripeConfigError('Configuração administrativa do Supabase ausente.', 500);
  }
};

let cachedClient: Stripe | null = null;

// A secret key é sempre a da plataforma (nunca por gestor) — Stripe Connect usa
// essa chave + o stripe_account_id do gestor via o parâmetro `stripeAccount`,
// diferente do Mercado Pago que exige um access_token OAuth por gestor.
export const getStripeClient = (): Stripe => {
  if (cachedClient) return cachedClient;

  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new StripeConfigError('A integração com a Stripe não está configurada no servidor.', 500);
  }

  cachedClient = new Stripe(secretKey);
  return cachedClient;
};

export const resolvePlatformServiceFeeConfig = async (): Promise<ServiceFeeConfig> => {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from('platform_settings')
    .select('service_fee_enabled, service_fee_percent')
    .eq('id', true)
    .maybeSingle<PlatformSettingsRow>();

  if (error) {
    console.error('[Stripe Config] Erro ao carregar taxa de serviço:', error);
    throw new StripeConfigError('Não foi possível carregar a configuração da taxa de serviço.', 500);
  }

  return {
    serviceFeeEnabled: data?.service_fee_enabled !== false,
    serviceFeePercent: normalizeServiceFeePercent(data?.service_fee_percent, DEFAULT_SERVICE_FEE_PERCENT)
  };
};

/**
 * Monta a chave de idempotência do checkout Stripe, no mesmo espírito da
 * versão do Mercado Pago (buildCheckoutIdempotencyKey em mercadopagoServer.ts):
 * presa ao valor cobrado e à comissão, não só à inscrição, para não devolver
 * uma resposta presa à primeira tentativa se o payload mudar.
 */
export const buildStripeIdempotencyKey = (
  method: 'payment_intent' | 'checkout_session',
  registrationId: string,
  amountCollectedMinorUnits: number,
  serviceFeeAmountMinorUnits: number
) => `stripe-${method}-${registrationId}-${amountCollectedMinorUnits}-${serviceFeeAmountMinorUnits}`;

/**
 * Extrai a comissão efetivamente retida pela plataforma de um PaymentIntent
 * Stripe. Diferente do Mercado Pago (que só expõe a comissão em fee_details),
 * a Stripe devolve application_fee_amount diretamente no objeto.
 */
export const extractApplicationFeeCharged = (paymentIntent: unknown): number => {
  const intent = (paymentIntent || {}) as { application_fee_amount?: unknown };
  const fee = Number(intent.application_fee_amount);
  return Number.isFinite(fee) && fee > 0 ? fee : 0;
};

const loadEventAndAccount = async (eventId: string) => {
  if (!eventId) {
    throw new StripeConfigError('Evento obrigatório para processar pagamento.', 400);
  }

  const supabaseAdmin = getSupabaseAdmin();
  const { data: dbEvent, error: eventError } = await supabaseAdmin
    .from('events')
    .select('organizer_id, currency')
    .eq('id', eventId)
    .single<StripeEventRow>();

  if (eventError || !dbEvent) {
    console.error('[Stripe Config] Evento não encontrado:', eventError);
    throw new StripeConfigError('Evento não encontrado para processar pagamento.', 404);
  }

  const currency = (dbEvent.currency || 'BRL') as EventCurrency;
  if (currency === 'BRL') {
    throw new StripeConfigError('Este evento está configurado em BRL e usa o Mercado Pago, não a Stripe.', 409);
  }

  const [{ data: account, error: accountError }, serviceFee] = await Promise.all([
    supabaseAdmin
      .from('stripe_accounts')
      .select('stripe_account_id, country, default_currency, charges_enabled, payouts_enabled, status')
      .eq('user_id', dbEvent.organizer_id)
      .maybeSingle<StripeAccountRow>(),
    resolvePlatformServiceFeeConfig()
  ]);

  if (accountError) {
    console.error('[Stripe Config] Erro ao carregar conta Stripe conectada:', accountError);
    throw new StripeConfigError('Não foi possível carregar a conexão Stripe do gestor.', 500);
  }

  if (!account || account.status !== 'connected' || !account.charges_enabled) {
    throw new StripeConfigError('Este evento não possui uma conta Stripe conectada e habilitada para receber pagamentos.', 403);
  }

  return { dbEvent, account, currency, serviceFee };
};

export const resolveStripeCheckoutConfig = async (eventId: string): Promise<StripeCheckoutConfig> => {
  const { dbEvent, account, currency, serviceFee } = await loadEventAndAccount(eventId);

  return {
    stripeAccountId: account.stripe_account_id,
    currency,
    organizerId: dbEvent.organizer_id,
    ...serviceFee
  };
};

export const resolveStripePublicConfig = async (eventId: string): Promise<StripePublicConfig> => {
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim();
  if (!publishableKey) {
    throw new StripeConfigError('A chave publicável da Stripe não está configurada no servidor.', 500);
  }

  const { dbEvent, account, currency, serviceFee } = await loadEventAndAccount(eventId);

  return {
    publishableKey,
    stripeAccountId: account.stripe_account_id,
    currency,
    organizerId: dbEvent.organizer_id,
    ...serviceFee
  };
};
