import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://momigbtnsswoldqnadmc.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
type MercadoPagoEventRow = {
  organizer_id: string;
  mp_access_token: string | null;
};

type MercadoPagoPublicEventRow = {
  organizer_id: string;
  mp_public_key: string | null;
};

export type MercadoPagoCheckoutConfig = {
  accessToken: string;
  marketplaceFee: number;
  organizerId: string;
  source: 'event_legacy';
};

export type MercadoPagoPublicConfig = {
  publicKey: string;
  organizerId: string;
  source: 'event_legacy';
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
    .select('organizer_id, mp_access_token')
    .eq('id', eventId)
    .single<MercadoPagoEventRow>();

  if (eventError || !dbEvent) {
    console.error('[MercadoPago Config] Evento não encontrado ou erro ao buscar credenciais:', eventError);
    throw new MercadoPagoConfigError('Evento não encontrado para processar pagamento.', 404);
  }

  if (dbEvent.mp_access_token) {
    return {
      accessToken: dbEvent.mp_access_token,
      marketplaceFee: 0,
      organizerId: dbEvent.organizer_id,
      source: 'event_legacy'
    };
  }

  throw new MercadoPagoConfigError(
    'Este evento não aceita pagamentos online no momento. Cadastre as credenciais do Mercado Pago nas configurações do evento.',
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

  if (dbEvent.mp_public_key) {
    return {
      publicKey: dbEvent.mp_public_key,
      organizerId: dbEvent.organizer_id,
      source: 'event_legacy'
    };
  }

  throw new MercadoPagoConfigError(
    'Este evento não possui Public Key do Mercado Pago conectada. Cadastre as credenciais do Mercado Pago nas configurações do evento.',
    403
  );
};

export const getMercadoPagoApplicationFee = (totalPaid: number, marketplaceFee: number) => {
  if (!Number.isFinite(totalPaid) || !Number.isFinite(marketplaceFee)) return undefined;
  if (totalPaid <= 0 || marketplaceFee <= 0) return undefined;
  return Math.min(totalPaid, marketplaceFee);
};
