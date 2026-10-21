import { NextResponse } from 'next/server';

import {
  BroadcastError,
  buildBroadcastState,
  findBroadcastByToken,
  hashBroadcastToken,
  isBroadcastTokenFormat
} from '@/lib/serverBroadcast';
import { checkRateLimit, createSupabaseAdmin, getClientIp, isRateLimitExceeded, safeErrorMessage } from '@/lib/serverSecurity';

// Estado do telão ao vivo (Story 1.56). Sem sessão: o link secreto gerado pelo
// gestor é a credencial, só de leitura e só daquele evento. O telão pergunta a
// cada 1 s durante a bateria; sem mudança, a resposta é 304 sem corpo. Toda
// resposta (inclusive 404 e 429) sai com no-store, noindex e no-referrer.

export const dynamic = 'force-dynamic';

const HEADERS = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer'
};

const REVOKED = 'Link do telão desativado. Peça um novo link ao organizador do evento.';

/** Por token e IP: o telão pergunta a cada 1 s; 240/min cobre a TV com folga. */
const TOKEN_LIMIT = 240;
/**
 * Por IP, só para link inválido (404): barra a varredura de tokens sem ir ao
 * banco e sem abrir uma chave nova do rate limit por token tentado. 120/min
 * cobre várias TVs com link revogado (perguntam a cada 5 s) atrás do mesmo IP.
 */
const MISS_LIMIT = 120;
const WINDOW_MS = 60_000;

/**
 * Links válidos vistos há pouco (hash → validade), para o bloqueio de 404 por
 * IP não alcançar a TV: no local do evento, a TV e o público costumam sair pelo
 * mesmo IP do Wi-Fi, e uma varredura de tokens não pode tirar o telão do ar.
 * Só pula o bloqueio por IP; o link continua sendo conferido no banco a cada
 * consulta (revogado volta a dar 404 e sai daqui) e o limite por link e IP
 * segue valendo. Quem não tem um link válido não entra aqui, então a varredura
 * continua barrada sem ir ao banco. Em memória por instância, como o rate
 * limit; a validade renova a cada consulta, e o tamanho é limitado.
 */
const RECENT_VALID_TTL_MS = 10 * 60_000;
const RECENT_VALID_MAX = 1000;
const recentValidLinks = new Map<string, number>();

const isRecentValidLink = (hash: string | null) => {
  if (!hash) return false;
  const until = recentValidLinks.get(hash);
  if (until === undefined) return false;
  if (until > Date.now()) return true;
  recentValidLinks.delete(hash);
  return false;
};

const rememberValidLink = (hash: string) => {
  recentValidLinks.delete(hash);
  recentValidLinks.set(hash, Date.now() + RECENT_VALID_TTL_MS);
  while (recentValidLinks.size > RECENT_VALID_MAX) {
    const oldest = recentValidLinks.keys().next().value;
    if (oldest === undefined) break;
    recentValidLinks.delete(oldest);
  }
};

const withHeaders = (response: Response) => {
  for (const [key, value] of Object.entries(HEADERS)) response.headers.set(key, value);
  return response;
};

const tooMany = () => NextResponse.json({ error: 'Muitas tentativas. Tente novamente em instantes.' }, { status: 429, headers: HEADERS });

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const tokenHash = isBroadcastTokenFormat(token) ? hashBroadcastToken(token) : null;
    const missKey = `telao-miss:${getClientIp(request)}`;
    if (!isRecentValidLink(tokenHash) && isRateLimitExceeded({ key: missKey, limit: MISS_LIMIT })) return tooMany();
    const notFound = () => withHeaders(checkRateLimit({ key: missKey, limit: MISS_LIMIT, windowMs: WINDOW_MS })
      ?? NextResponse.json({ error: REVOKED }, { status: 404 }));

    if (!tokenHash) return notFound();

    const supabaseAdmin = createSupabaseAdmin();
    const config = await findBroadcastByToken(supabaseAdmin, token);
    if (!config) {
      recentValidLinks.delete(tokenHash);
      return notFound();
    }
    rememberValidLink(tokenHash);

    // Chave só para link válido: o rateLimitStore não cresce com tokens inventados.
    const limited = checkRateLimit({ key: `telao:${hashBroadcastToken(token).slice(0, 16)}:${getClientIp(request)}`, limit: TOKEN_LIMIT, windowMs: WINDOW_MS });
    if (limited) return withHeaders(limited);

    const state = await buildBroadcastState(supabaseAdmin, config.event_id, config);
    const etag = `"${state.version}"`;
    if (request.headers.get('if-none-match') === etag) {
      return new NextResponse(null, { status: 304, headers: { ...HEADERS, ETag: etag } });
    }
    return NextResponse.json(state, { headers: { ...HEADERS, ETag: etag } });
  } catch (error) {
    if (error instanceof BroadcastError) return NextResponse.json({ error: error.message }, { status: error.status, headers: HEADERS });
    console.error('Erro no telão ao vivo:', error);
    return NextResponse.json({ error: safeErrorMessage(error, 'Erro ao carregar o telão.') }, { status: 500, headers: HEADERS });
  }
}
