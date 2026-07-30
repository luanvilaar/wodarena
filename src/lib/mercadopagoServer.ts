import { createSupabaseAdmin } from '@/lib/serverSecurity';
import { DEFAULT_SERVICE_FEE_PERCENT, normalizeServiceFeePercent } from '@/lib/serviceFee';

type MercadoPagoEventRow = {
  organizer_id: string;
};

type MercadoPagoAccountRow = {
  expires_at: string | null;
  mercadopago_user_id: string | null;
  oauth_client_id: string | null;
  oauth_verified_at: string | null;
  public_key: string | null;
  status: string | null;
};

type MercadoPagoSecretRow = {
  access_token: string | null;
  refresh_token: string | null;
};

type PlatformSettingsRow = {
  service_fee_enabled: boolean | null;
  service_fee_percent: number | string | null;
};

export type ServiceFeeConfig = {
  serviceFeeEnabled: boolean;
  serviceFeePercent: number;
};

export type MercadoPagoCheckoutConfig = ServiceFeeConfig & {
  accessToken: string;
  organizerId: string;
  source: 'organizer_oauth' | 'organizer_manual_legacy';
};

export type MercadoPagoPublicConfig = ServiceFeeConfig & {
  publicKey: string;
  organizerId: string;
  source: 'organizer_oauth';
};

export class MercadoPagoConfigError extends Error {
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
    throw new MercadoPagoConfigError('Configuração administrativa do Supabase ausente.', 500);
  }
};

const refreshInFlight = new Map<string, Promise<string>>();

const isExpired = (expiresAt: string | null | undefined) => {
  const expiresAtMs = expiresAt ? new Date(expiresAt).getTime() : Number.NaN;
  return !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now() + 60_000;
};

export const PLATFORM_SELLER_ERROR_MESSAGE = 'Esta conta Mercado Pago é a própria conta da plataforma WODArena e não pode receber inscrições com taxa de serviço. Conecte uma conta Mercado Pago diferente para este gestor.';

/**
 * O Mercado Pago recusa `application_fee`/`marketplace_fee` quando o vendedor
 * (collector) é a mesma conta dona da aplicação marketplace — a aplicação não
 * pode cobrar comissão de si mesma. A tentativa retorna
 * "You cannot use application_fee with this payment" já na criação do pagamento,
 * então bloqueamos antes, tanto na conexão OAuth quanto no checkout.
 *
 * Sem `MERCADOPAGO_PLATFORM_USER_ID` configurada não há o que comparar e o
 * comportamento permanece inalterado.
 */
export const isPlatformOwnedSeller = (mercadopagoUserId: string | null | undefined) => {
  const platformUserId = process.env.MERCADOPAGO_PLATFORM_USER_ID?.trim();
  const sellerUserId = mercadopagoUserId ? String(mercadopagoUserId).trim() : '';
  return Boolean(platformUserId && sellerUserId && platformUserId === sellerUserId);
};

/**
 * Monta a chave de idempotência do checkout. Uma chave presa apenas ao id da inscrição
 * protege contra duplo clique, mas também prende a inscrição à primeira tentativa: se o
 * payload mudar (valor recalculado, comissão que passou a ser aplicada), o Mercado Pago
 * pode devolver a resposta antiga ou recusar a nova. Incluir o valor cobrado e a
 * comissão em centavos mantém as duas propriedades.
 */
export const buildCheckoutIdempotencyKey = (
  method: 'card' | 'pix',
  registrationId: string,
  amountCollected: number,
  serviceFeeAmount: number
) => {
  const cents = (value: number) => Math.max(0, Math.round((Number(value) + Number.EPSILON) * 100));
  return `${method}-${registrationId}-${cents(amountCollected)}-${cents(serviceFeeAmount)}`;
};

/**
 * Extrai a comissão efetivamente retida pela plataforma na resposta do Mercado Pago.
 * Nem o POST nem o GET de `/v1/payments` devolvem `application_fee` na raiz: o valor
 * aplicado aparece apenas em `fee_details`. Ler só a raiz gravava zero mesmo quando a
 * comissão havia sido cobrada.
 */
export const extractApplicationFeeCharged = (paymentData: unknown): number => {
  const payment = (paymentData || {}) as {
    application_fee?: unknown;
    fee_details?: Array<{ type?: unknown; amount?: unknown }> | null;
  };

  const detail = Array.isArray(payment.fee_details)
    ? payment.fee_details.find(item => item?.type === 'application_fee')
    : undefined;

  const fromDetails = Number(detail?.amount);
  if (Number.isFinite(fromDetails) && fromDetails > 0) return fromDetails;

  const fromRoot = Number(payment.application_fee);
  return Number.isFinite(fromRoot) && fromRoot > 0 ? fromRoot : 0;
};

const assertOAuthSellerIdentity = (
  account: MercadoPagoAccountRow,
  secret: MercadoPagoSecretRow,
) => {
  const publicKey = account.public_key?.trim();
  const mercadopagoUserId = account.mercadopago_user_id?.trim();
  const refreshToken = secret.refresh_token?.trim();
  const oauthClientId = account.oauth_client_id?.trim();
  const oauthVerifiedAt = account.oauth_verified_at?.trim();
  const currentClientId = process.env.MERCADOPAGO_CLIENT_ID?.trim();

  if (!currentClientId) {
    throw new MercadoPagoConfigError('A integração OAuth do Mercado Pago não está configurada no servidor.', 500);
  }

  if (
    !publicKey
    || !mercadopagoUserId
    || !refreshToken
    || refreshToken === 'manual'
    || !oauthVerifiedAt
    || !oauthClientId
    || oauthClientId !== currentClientId
  ) {
    throw new MercadoPagoConfigError(
      'A conexão Mercado Pago deste evento não possui uma autorização OAuth verificada para split. Reconecte a conta via OAuth antes de receber inscrições com taxa de serviço.',
      403
    );
  }

  if (isPlatformOwnedSeller(mercadopagoUserId)) {
    throw new MercadoPagoConfigError(PLATFORM_SELLER_ERROR_MESSAGE, 403);
  }

  return { publicKey, mercadopagoUserId, refreshToken };
};

export const resolvePlatformServiceFeeConfig = async (): Promise<ServiceFeeConfig> => {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from('platform_settings')
    .select('service_fee_enabled, service_fee_percent')
    .eq('id', true)
    .maybeSingle<PlatformSettingsRow>();

  if (error) {
    console.error('[MercadoPago Config] Erro ao carregar taxa de serviço:', error);
    throw new MercadoPagoConfigError('Não foi possível carregar a configuração da taxa de serviço.', 500);
  }

  return {
    serviceFeeEnabled: data?.service_fee_enabled !== false,
    serviceFeePercent: normalizeServiceFeePercent(data?.service_fee_percent, DEFAULT_SERVICE_FEE_PERCENT)
  };
};

const refreshOAuthAccessToken = async (
  organizerId: string,
  refreshToken: string
): Promise<string> => {
  const existing = refreshInFlight.get(organizerId);
  if (existing) return existing;

  const refreshPromise = (async () => {
    const clientId = process.env.MERCADOPAGO_CLIENT_ID;
    const clientSecret = process.env.MERCADOPAGO_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new MercadoPagoConfigError('A renovação OAuth do Mercado Pago não está configurada no servidor.', 500);
    }

    const response = await fetch('https://api.mercadopago.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        accept: 'application/json'
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      }).toString()
    });

    if (!response.ok) {
      console.error('[MercadoPago OAuth] Falha ao renovar token do gestor:', organizerId, response.status);
      throw new MercadoPagoConfigError('A conexão Mercado Pago expirou. Peça ao gestor para reconectar a conta via OAuth.', 403);
    }

    const tokenData = await response.json();
    const nextAccessToken = typeof tokenData.access_token === 'string' ? tokenData.access_token : '';
    if (!nextAccessToken) {
      throw new MercadoPagoConfigError('O Mercado Pago não retornou um token OAuth válido.', 502);
    }

    const expiresIn = Number(tokenData.expires_in || 15_552_000);
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    const supabaseAdmin = getSupabaseAdmin();
    const { error: secretError } = await supabaseAdmin
      .from('mercadopago_secrets')
      .update({
        access_token: nextAccessToken,
        refresh_token: typeof tokenData.refresh_token === 'string' ? tokenData.refresh_token : refreshToken,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', organizerId);

    if (secretError) {
      console.error('[MercadoPago OAuth] Falha ao persistir token renovado:', secretError);
      throw new MercadoPagoConfigError('Não foi possível salvar a renovação OAuth do Mercado Pago.', 500);
    }

    const { error: accountError } = await supabaseAdmin
      .from('mercadopago_accounts')
      .update({ expires_at: expiresAt, status: 'connected', updated_at: new Date().toISOString() })
      .eq('user_id', organizerId);

    if (accountError) {
      console.error('[MercadoPago OAuth] Falha ao atualizar expiração OAuth:', accountError);
      throw new MercadoPagoConfigError('Não foi possível atualizar a conexão Mercado Pago.', 500);
    }

    return nextAccessToken;
  })();

  refreshInFlight.set(organizerId, refreshPromise);
  try {
    return await refreshPromise;
  } finally {
    refreshInFlight.delete(organizerId);
  }
};

export const resolveMercadoPagoCheckoutConfig = async (
  eventId: string,
  options: { allowManualLegacy?: boolean } = {},
): Promise<MercadoPagoCheckoutConfig> => {
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
    console.error('[MercadoPago Config] Evento não encontrado:', eventError);
    throw new MercadoPagoConfigError('Evento não encontrado para processar pagamento.', 404);
  }

  const [{ data: account, error: accountError }, { data: secret, error: secretError }, serviceFee] = await Promise.all([
    supabaseAdmin
      .from('mercadopago_accounts')
      .select('expires_at, mercadopago_user_id, oauth_client_id, oauth_verified_at, public_key, status')
      .eq('user_id', dbEvent.organizer_id)
      .maybeSingle<MercadoPagoAccountRow>(),
    supabaseAdmin
      .from('mercadopago_secrets')
      .select('access_token, refresh_token')
      .eq('user_id', dbEvent.organizer_id)
      .maybeSingle<MercadoPagoSecretRow>(),
    resolvePlatformServiceFeeConfig()
  ]);

  if (accountError || secretError) {
    console.error('[MercadoPago Config] Erro ao carregar conexão OAuth:', accountError || secretError);
    throw new MercadoPagoConfigError('Não foi possível carregar a conexão Mercado Pago do gestor.', 500);
  }

  if (!account || account.status !== 'connected' || !secret?.access_token || !secret.refresh_token) {
    throw new MercadoPagoConfigError('Este evento não possui uma conta Mercado Pago conectada via OAuth.', 403);
  }

  const isManualLegacy = secret.refresh_token === 'manual';

  if (isManualLegacy && !options.allowManualLegacy) {
    throw new MercadoPagoConfigError('Esta conta Mercado Pago usa credenciais manuais. Reconecte via OAuth para continuar recebendo inscrições com a taxa de serviço WODArena.', 403);
  }

  if (isManualLegacy) {
    return {
      accessToken: secret.access_token,
      organizerId: dbEvent.organizer_id,
      source: 'organizer_manual_legacy',
      ...serviceFee,
    };
  }

  const { refreshToken } = assertOAuthSellerIdentity(account, secret);

  const accessToken = isExpired(account.expires_at)
    ? await refreshOAuthAccessToken(dbEvent.organizer_id, refreshToken)
    : secret.access_token;

  return {
    accessToken,
    organizerId: dbEvent.organizer_id,
    source: 'organizer_oauth',
    ...serviceFee
  };
};

export const resolveMercadoPagoPublicConfig = async (eventId: string): Promise<MercadoPagoPublicConfig> => {
  if (!eventId) {
    throw new MercadoPagoConfigError('Evento obrigatório para carregar credenciais públicas de pagamento.', 400);
  }

  const supabaseAdmin = getSupabaseAdmin();
  const { data: dbEvent, error: eventError } = await supabaseAdmin
    .from('events')
    .select('organizer_id')
    .eq('id', eventId)
    .single<MercadoPagoEventRow>();

  if (eventError || !dbEvent) {
    console.error('[MercadoPago Config] Evento não encontrado para public key:', eventError);
    throw new MercadoPagoConfigError('Evento não encontrado para carregar credenciais públicas de pagamento.', 404);
  }

  const [{ data: account, error: accountError }, { data: secret, error: secretError }, serviceFee] = await Promise.all([
    supabaseAdmin
      .from('mercadopago_accounts')
      .select('expires_at, mercadopago_user_id, oauth_client_id, oauth_verified_at, public_key, status')
      .eq('user_id', dbEvent.organizer_id)
      .maybeSingle<MercadoPagoAccountRow>(),
    supabaseAdmin
      .from('mercadopago_secrets')
      .select('access_token, refresh_token')
      .eq('user_id', dbEvent.organizer_id)
      .maybeSingle<MercadoPagoSecretRow>(),
    resolvePlatformServiceFeeConfig()
  ]);

  if (accountError || secretError) {
    console.error('[MercadoPago Config] Erro ao carregar public key OAuth:', accountError || secretError);
    throw new MercadoPagoConfigError('Não foi possível carregar a conexão Mercado Pago do gestor.', 500);
  }

  if (!account || account.status !== 'connected' || !secret?.access_token || !secret.refresh_token) {
    throw new MercadoPagoConfigError('Este evento não possui uma conta Mercado Pago conectada via OAuth.', 403);
  }

  const { publicKey } = assertOAuthSellerIdentity(account, secret);

  return {
    publicKey,
    organizerId: dbEvent.organizer_id,
    source: 'organizer_oauth',
    ...serviceFee
  };
};

/**
 * Resolve a URL de retorno do OAuth do Mercado Pago a partir de `MERCADOPAGO_REDIRECT_URI`
 * (com fallback para `${origin}/admin`, o fluxo same-origin da Story 1.19).
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
    console.error(`[MercadoPago OAuth] MERCADOPAGO_REDIRECT_URI aponta para localhost em producao (${candidate}).`);
    throw new MercadoPagoConfigError(
      'A conexao automatica do Mercado Pago esta indisponivel por um erro de configuracao do servidor. Contate o suporte da plataforma.',
      500
    );
  }

  if (!parsed.pathname.startsWith('/admin')) {
    console.warn(`[MercadoPago OAuth] MERCADOPAGO_REDIRECT_URI nao aponta para /admin (${parsed.pathname}).`);
  }

  return !isLocalhost && parsed.protocol === 'http:' ? candidate.replace(/^http:/, 'https:') : candidate;
};
