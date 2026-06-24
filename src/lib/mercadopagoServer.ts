import { createSupabaseAdmin } from '@/lib/serverSecurity';
type MercadoPagoEventRow = {
  organizer_id: string;
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
  source: 'organizer_secret';
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
  try {
    return createSupabaseAdmin();
  } catch {
    throw new MercadoPagoConfigError('Configuração administrativa do Supabase ausente.', 500);
  }
};

export const resolveMercadoPagoCheckoutConfig = async (eventId: string): Promise<MercadoPagoCheckoutConfig> => {
  if (!eventId) {
    throw new MercadoPagoConfigError('Evento obrigatório para processar pagamento.', 400);
  }

  const supabaseAdmin = getSupabaseAdmin();

  const { data: dbEvent, error: eventError } = await supabaseAdmin
    .from('events')
    .select('organizer_id')
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
  }

  if (mpSecret?.access_token) {
    return {
      accessToken: mpSecret.access_token,
      marketplaceFee: 0,
      organizerId: dbEvent.organizer_id,
      source: 'organizer_secret'
    };
  }

  throw new MercadoPagoConfigError(
    'Este evento não aceita pagamentos online no momento. Conecte as credenciais do Mercado Pago na conta do gestor responsável.',
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
    'Este evento não possui Public Key do Mercado Pago conectada. Cadastre as credenciais do Mercado Pago nas configurações do evento.',
    403
  );
};

export const getMercadoPagoApplicationFee = (totalPaid: number, marketplaceFee: number) => {
  if (!Number.isFinite(totalPaid) || !Number.isFinite(marketplaceFee)) return undefined;
  if (totalPaid <= 0 || marketplaceFee <= 0) return undefined;
  return Math.min(totalPaid, marketplaceFee);
};

/**
 * Resolve a URL de retorno do OAuth do Mercado Pago a partir de `MERCADOPAGO_REDIRECT_URI`
 * (com fallback para `${origin}/admin`, o fluxo same-origin da Story 1.19).
 *
 * A mesma URL precisa ser usada na geracao da URL de autorizacao e na troca do
 * `authorization_code` por Access Token, e precisa casar exatamente com a URL
 * cadastrada no painel da aplicacao Mercado Pago. Esta funcao falha cedo com uma
 * mensagem acionavel quando a configuracao nao pode funcionar em producao
 * (ex.: aponta para localhost) e normaliza `http` -> `https` fora de localhost.
 */
export const resolveMercadoPagoRedirectUri = (origin: string): string => {
  const configured = process.env.MERCADOPAGO_REDIRECT_URI?.trim();
  const candidate = configured || `${origin}/admin`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    console.error(`[MercadoPago OAuth] MERCADOPAGO_REDIRECT_URI malformada: ${candidate}`);
    throw new MercadoPagoConfigError(
      'A URL de retorno do Mercado Pago esta malformada no servidor da plataforma. Contate o suporte.',
      500
    );
  }

  const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction && isLocalhost) {
    console.error(
      `[MercadoPago OAuth] MERCADOPAGO_REDIRECT_URI aponta para localhost em producao (${candidate}). ` +
        'Configure a URL publica HTTPS registrada no painel do Mercado Pago (ex.: https://wodarena.com.br/admin).'
    );
    throw new MercadoPagoConfigError(
      'A conexao automatica do Mercado Pago esta indisponivel por um erro de configuracao do servidor. Contate o suporte da plataforma.',
      500
    );
  }

  // O fluxo same-origin da Story 1.19 espera o retorno na pagina /admin.
  if (!parsed.pathname.startsWith('/admin')) {
    console.warn(
      `[MercadoPago OAuth] MERCADOPAGO_REDIRECT_URI nao aponta para /admin (${parsed.pathname}); ` +
        'o fluxo same-origin espera o retorno em /admin.'
    );
  }

  // Fora de localhost, forca HTTPS (mesma politica de normalizacao do checkout).
  if (!isLocalhost && parsed.protocol === 'http:') {
    return candidate.replace(/^http:/, 'https:');
  }

  return candidate;
};
