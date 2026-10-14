import { NextResponse } from 'next/server';
import { ManagerAccessError, assertManagerOperationalAccess, managerAccessErrorResponse } from '@/lib/serverManagerAccess';
import { checkRateLimit, createSupabaseAdmin, requireSession } from '@/lib/serverSecurity';
import {
  GEOCODE_QUERY_MAX_LENGTH,
  GEOCODE_QUERY_MIN_LENGTH,
  GeocodingProviderError,
  GeocodingUnavailableError,
  geocodeAddress,
  parseGeocodeCountry
} from '@/lib/serverGeocoding';

// "Buscar pelo endereço" do painel do gestor (Stories 1.41 e 1.42): devolve até 5
// candidatos { label, latitude, longitude } para o texto de Local + Cidade +
// Estado, limitados ao país do evento quando informado. Só sugere: nada é gravado aqui; o gestor confere o ponto na prévia
// e salva o evento pela persistência administrativa.

// Chamada paga ao provedor: limite mais curto que o da persistência (120/min).
const GEOCODE_RATE_LIMIT = 10;
const GEOCODE_RATE_WINDOW_MS = 60 * 1000;

const UNAVAILABLE_MESSAGE = 'A busca por endereço está indisponível no momento. Cole as coordenadas no campo "Coordenadas (lat, lng)": essa opção continua funcionando.';
const PROVIDER_FAILURE_MESSAGE = 'Não foi possível buscar o endereço agora. Tente novamente em instantes ou cole as coordenadas.';
const INVALID_COUNTRY_MESSAGE = 'País inválido para a busca. Use BR, PT ou GB.';
const INVALID_QUERY_MESSAGE = `Informe o endereço para a busca, com ${GEOCODE_QUERY_MIN_LENGTH} a ${GEOCODE_QUERY_MAX_LENGTH} caracteres.`;

export async function POST(request: Request) {
  try {
    const auth = requireSession(request, ['manager', 'owner']);
    if (auth.response) return auth.response;
    const actor = auth.user;

    const rateLimited = checkRateLimit({
      key: `admin-geocode:${actor.id}`,
      limit: GEOCODE_RATE_LIMIT,
      windowMs: GEOCODE_RATE_WINDOW_MS
    });
    if (rateLimited) return rateLimited;

    // Gestor com acesso expirado não consome chamada paga; owner passa direto.
    await assertManagerOperationalAccess(createSupabaseAdmin(), actor);

    const body: unknown = await request.json().catch(() => null);
    const rawQuery = body && typeof body === 'object' ? (body as Record<string, unknown>).query : undefined;
    const query = typeof rawQuery === 'string' ? rawQuery.trim() : '';
    if (query.length < GEOCODE_QUERY_MIN_LENGTH || query.length > GEOCODE_QUERY_MAX_LENGTH) {
      return NextResponse.json({ error: INVALID_QUERY_MESSAGE }, { status: 400 });
    }

    // País opcional (Story 1.42): limita a busca ao país do evento. Valor fora da lista é recusado.
    const rawCountry = body && typeof body === 'object' ? (body as Record<string, unknown>).country : undefined;
    const country = rawCountry === undefined || rawCountry === null || rawCountry === '' ? null : parseGeocodeCountry(rawCountry);
    if (rawCountry !== undefined && rawCountry !== null && rawCountry !== '' && !country) {
      return NextResponse.json({ error: INVALID_COUNTRY_MESSAGE }, { status: 400 });
    }

    const candidates = await geocodeAddress(query, { country });
    return NextResponse.json({ candidates });
  } catch (err) {
    if (err instanceof ManagerAccessError) {
      return managerAccessErrorResponse(err);
    }
    if (err instanceof GeocodingUnavailableError) {
      return NextResponse.json({ error: UNAVAILABLE_MESSAGE }, { status: 503 });
    }
    if (err instanceof GeocodingProviderError) {
      // Só o motivo e o status do provedor: a URL da chamada carrega o token.
      console.error('[Geocode API] Falha no provedor:', JSON.stringify({
        reason: err.reason,
        providerStatus: err.providerStatus
      }));
      return NextResponse.json({ error: PROVIDER_FAILURE_MESSAGE }, { status: 502 });
    }
    console.error('[Geocode API] Erro inesperado:', JSON.stringify({
      name: err instanceof Error ? err.name : 'desconhecido'
    }));
    return NextResponse.json({ error: 'Erro ao buscar o endereço.' }, { status: 500 });
  }
}
