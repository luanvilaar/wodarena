import { NextResponse } from 'next/server';

import {
  BroadcastError,
  buildBroadcastState,
  findBroadcastByToken,
  hashBroadcastToken,
  isBroadcastTokenFormat
} from '@/lib/serverBroadcast';
import { checkRateLimit, createSupabaseAdmin, getClientIp, safeErrorMessage } from '@/lib/serverSecurity';

// Estado do telão ao vivo (Story 1.56). Sem sessão: o link secreto gerado pelo
// gestor é a credencial, só de leitura e só daquele evento. O telão pergunta a
// cada 1 s durante a bateria; sem mudança, a resposta é 304 sem corpo.

export const dynamic = 'force-dynamic';

const HEADERS = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer'
};

const REVOKED = 'Link do telão desativado. Peça um novo link ao organizador do evento.';

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    if (!isBroadcastTokenFormat(token)) return NextResponse.json({ error: REVOKED }, { status: 404, headers: HEADERS });

    const limited = checkRateLimit({ key: `telao:${hashBroadcastToken(token).slice(0, 16)}:${getClientIp(request)}`, limit: 240, windowMs: 60_000 });
    if (limited) return limited;

    const supabaseAdmin = createSupabaseAdmin();
    const config = await findBroadcastByToken(supabaseAdmin, token);
    if (!config) return NextResponse.json({ error: REVOKED }, { status: 404, headers: HEADERS });

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
