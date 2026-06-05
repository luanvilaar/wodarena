import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://momigbtnsswoldqnadmc.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const defaultMarketplaceFee = Number(process.env.WODARENA_MARKETPLACE_FEE_DEFAULT || '10');

type MercadoPagoEventRow = {
  organizer_id: string;
  marketplace_fee: number | string | null;
  mp_access_token: string | null;
};

type MercadoPagoPublicEventRow = {
  organizer_id: string;
  mp_public_key: string | null;
};

type MercadoPagoAccountRow = {
  public_key: string | null;
};

type MercadoPagoSecretRow = {
  access_token: string | null;
};

export type MercadoPagoCheckoutConfig = {
  accessToken: string;
  marketplaceFee: number;
  organizerId: string;
  source: 'organizer_secret' | 'event_legacy';
};

export type MercadoPagoPublicConfig = {
  publicKey: string;
  organizerId: string;
  source: 'organizer_account' | 'event_legacy';
};

export class MercadoPagoConfigError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'MercadoPagoConfigError';
    this.status = status;
  }
}

const getSupabaseAdmin = () => {
  if (!supabaseServiceKey) {
    throw new MercadoPagoConfigError('Configuração administrativa do Supabase ausente.', 500);
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
};

export const resolveMercadoPagoCheckoutConfig = async (eventId: string): Promise<MercadoPagoCheckoutConfig> => {
  if (!eventId) {
    throw new MercadoPagoConfigError('Evento obrigatório para processar pagamento.', 400);
  }

  const supabaseAdmin = getSupabaseAdmin();

  const { data: dbEvent, error: eventError } = await supabaseAdmin
    .from('events')
    .select('organizer_id, marketplace_fee, mp_access_token')
    .eq('id', eventId)
    .single<MercadoPagoEventRow>();

  if (eventError || !dbEvent) {
    console.error('[MercadoPago Config] Evento não encontrado ou erro ao buscar credenciais:', eventError);
    throw new MercadoPagoConfigError('Evento não encontrado para processar pagamento.', 404);
  }

  const { data: mpSecret, error: secretError } = await supabaseAdmin
    .from('mercadopago_secrets')
    .select('access_token')
    .eq('user_id', dbEvent.organizer_id)
    .maybeSingle<MercadoPagoSecretRow>();

  if (secretError) {
    console.error('[MercadoPago Config] Erro ao buscar credenciais privadas do organizador:', secretError);
    throw new MercadoPagoConfigError('Erro ao carregar credenciais de pagamento do organizador.', 500);
  }

  const marketplaceFee = dbEvent.marketplace_fee !== null && dbEvent.marketplace_fee !== undefined
    ? Number(dbEvent.marketplace_fee)
    : defaultMarketplaceFee;

  if (mpSecret?.access_token) {
    return {
      accessToken: mpSecret.access_token,
      marketplaceFee,
      organizerId: dbEvent.organizer_id,
      source: 'organizer_secret'
    };
  }

  if (dbEvent.mp_access_token) {
    return {
      accessToken: dbEvent.mp_access_token,
      marketplaceFee,
      organizerId: dbEvent.organizer_id,
      source: 'event_legacy'
    };
  }

  throw new MercadoPagoConfigError(
    'Este evento não aceita pagamentos online no momento. Conecte a conta Mercado Pago do gestor na aba Pagamentos.',
    403
  );
};

export const resolveMercadoPagoPublicConfig = async (eventId: string): Promise<MercadoPagoPublicConfig> => {
  if (!eventId) {
    throw new MercadoPagoConfigError('Evento obrigatório para carregar credenciais públicas de pagamento.', 400);
  }

  const supabaseAdmin = getSupabaseAdmin();

  const { data: dbEvent, error: eventError } = await supabaseAdmin
    .from('events')
    .select('organizer_id, mp_public_key')
    .eq('id', eventId)
    .single<MercadoPagoPublicEventRow>();

  if (eventError || !dbEvent) {
    console.error('[MercadoPago Public Config] Evento não encontrado ou erro ao buscar public key:', eventError);
    throw new MercadoPagoConfigError('Evento não encontrado para carregar checkout.', 404);
  }

  const { data: mpAccount, error: accountError } = await supabaseAdmin
    .from('mercadopago_accounts')
    .select('public_key')
    .eq('user_id', dbEvent.organizer_id)
    .eq('status', 'connected')
    .maybeSingle<MercadoPagoAccountRow>();

  if (accountError) {
    console.error('[MercadoPago Public Config] Erro ao buscar conta pública do organizador:', accountError);
    throw new MercadoPagoConfigError('Erro ao carregar configuração pública de pagamento.', 500);
  }

  if (mpAccount?.public_key) {
    return {
      publicKey: mpAccount.public_key,
      organizerId: dbEvent.organizer_id,
      source: 'organizer_account'
    };
  }

  if (dbEvent.mp_public_key) {
    return {
      publicKey: dbEvent.mp_public_key,
      organizerId: dbEvent.organizer_id,
      source: 'event_legacy'
    };
  }

  throw new MercadoPagoConfigError(
    'Este evento não possui Public Key Mercado Pago conectada. Conecte a conta do gestor na aba Pagamentos.',
    403
  );
};

export const getMercadoPagoApplicationFee = (totalPaid: number, marketplaceFee: number) => {
  if (!Number.isFinite(totalPaid) || !Number.isFinite(marketplaceFee)) return undefined;
  if (totalPaid <= 0 || marketplaceFee <= 0) return undefined;
  return Math.min(totalPaid, marketplaceFee);
};
