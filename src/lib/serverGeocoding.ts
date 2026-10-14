import { validateEventCoordinates } from '@/lib/eventMap';

// Busca de coordenadas por endereço para o painel do gestor (Story 1.41).
// Só servidor. O provedor (Mapbox Geocoding v6, forward) fica isolado neste
// módulo: trocar de provedor não mexe na rota /api/admin/geocode nem na tela.
//
// Segredo: o Mapbox recebe o token na query string da URL. Por isso a URL da
// chamada nunca é registrada em log nem entra em erro ou resposta; os erros
// daqui carregam só o motivo e o status HTTP do provedor.
//
// SSRF: o host é fixo. O cliente manda só o texto de busca, nunca uma URL.
//
// Modo permanente (permanent=true): a documentação do Mapbox só permite
// guardar resultados do modo permanente, e o ponto escolhido é gravado no
// evento. Uma conta sem acesso ao modo permanente recebe 401/403 do provedor,
// que aqui vira GeocodingProviderError (502 na rota).

export type GeocodeCandidate = {
  label: string;
  latitude: number;
  longitude: number;
};

export const GEOCODE_MAX_CANDIDATES = 5;
export const GEOCODE_TIMEOUT_MS = 5000;
export const GEOCODE_QUERY_MIN_LENGTH = 3;
export const GEOCODE_QUERY_MAX_LENGTH = 200;
/** Países dos eventos (EventCountryCode): a busca é limitada ao país do evento. */
export const GEOCODE_COUNTRIES = ['BR', 'PT', 'GB'] as const;
export type GeocodeCountry = (typeof GEOCODE_COUNTRIES)[number];

/** Código do país (qualquer caixa) ou `null` quando não é um dos países dos eventos. */
export const parseGeocodeCountry = (value: unknown): GeocodeCountry | null => {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return (GEOCODE_COUNTRIES as readonly string[]).includes(code) ? (code as GeocodeCountry) : null;
};

const MAPBOX_FORWARD_GEOCODING_URL = 'https://api.mapbox.com/search/geocode/v6/forward';
const CANDIDATE_LABEL_MAX_LENGTH = 300;

/** MAPBOX_TOKEN ausente ou vazio: a busca por endereço fica desligada. */
export class GeocodingUnavailableError extends Error {
  constructor() {
    super('Busca por endereço não configurada.');
    this.name = 'GeocodingUnavailableError';
  }
}

export type GeocodingFailureReason = 'network' | 'timeout' | 'status' | 'invalid_response';

/** Falha do provedor. Nunca carrega URL, token nem corpo da resposta. */
export class GeocodingProviderError extends Error {
  reason: GeocodingFailureReason;
  providerStatus: number | null;

  constructor(reason: GeocodingFailureReason, providerStatus: number | null = null) {
    super('Falha ao consultar o provedor de geocoding.');
    this.name = 'GeocodingProviderError';
    this.reason = reason;
    this.providerStatus = providerStatus;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

// Lido a cada requisição, nunca no carregamento do módulo.
const readMapboxToken = () => (process.env.MAPBOX_TOKEN || '').trim();

const isTimeoutError = (error: unknown) => (
  error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
);

const textOf = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const candidateLabel = (properties: Record<string, unknown>) => {
  const label = textOf(properties.full_address)
    || [textOf(properties.name), textOf(properties.place_formatted)].filter(Boolean).join(', ');
  return label.slice(0, CANDIDATE_LABEL_MAX_LENGTH);
};

/**
 * Converte a resposta GeoJSON do Mapbox em até 5 candidatos. Coordenadas vêm
 * de properties.coordinates (latitude/longitude) e, na falta delas, de
 * geometry.coordinates (ordem longitude, latitude). Candidato com coordenada
 * inválida ou sem rótulo é descartado.
 */
export const parseMapboxCandidates = (body: unknown): GeocodeCandidate[] => {
  const features = isRecord(body) && Array.isArray(body.features) ? body.features : [];
  const candidates: GeocodeCandidate[] = [];

  for (const feature of features) {
    if (candidates.length >= GEOCODE_MAX_CANDIDATES) break;
    if (!isRecord(feature)) continue;
    const properties = isRecord(feature.properties) ? feature.properties : {};
    const propertyCoordinates = isRecord(properties.coordinates) ? properties.coordinates : null;
    const geometryCoordinates = isRecord(feature.geometry) && Array.isArray(feature.geometry.coordinates)
      ? feature.geometry.coordinates
      : [];

    const latitude = propertyCoordinates?.latitude ?? geometryCoordinates[1];
    const longitude = propertyCoordinates?.longitude ?? geometryCoordinates[0];
    const coordinates = validateEventCoordinates({ latitude, longitude });
    if (!coordinates.ok || !coordinates.coordinates) continue;

    const label = candidateLabel(properties);
    if (!label) continue;

    candidates.push({
      label,
      latitude: coordinates.coordinates.latitude,
      longitude: coordinates.coordinates.longitude
    });
  }

  return candidates;
};

/**
 * Busca até 5 candidatos para o texto informado, limitados ao país do evento
 * quando informado (sem isso o Mapbox devolve homônimos de qualquer país). Lança
 * GeocodingUnavailableError sem token e GeocodingProviderError em falha de
 * rede, timeout (5 s), status diferente de 2xx ou resposta ilegível.
 */
export const geocodeAddress = async (query: string, options: { country?: GeocodeCountry | null } = {}): Promise<GeocodeCandidate[]> => {
  const token = readMapboxToken();
  if (!token) throw new GeocodingUnavailableError();

  const url = new URL(MAPBOX_FORWARD_GEOCODING_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(GEOCODE_MAX_CANDIDATES));
  url.searchParams.set('permanent', 'true');
  if (options.country) url.searchParams.set('country', options.country.toLowerCase());
  url.searchParams.set('access_token', token);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS)
    });
  } catch (error) {
    throw new GeocodingProviderError(isTimeoutError(error) ? 'timeout' : 'network');
  }

  if (!response.ok) {
    // O corpo de erro do provedor não é lido nem repassado; só libera a conexão.
    await response.body?.cancel().catch(() => undefined);
    throw new GeocodingProviderError('status', response.status);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new GeocodingProviderError(isTimeoutError(error) ? 'timeout' : 'invalid_response', response.status);
  }

  return parseMapboxCandidates(body);
};
