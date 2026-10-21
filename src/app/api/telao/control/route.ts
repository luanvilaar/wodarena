import { NextResponse } from 'next/server';

import {
  BROADCAST_EVENT_TYPE_MESSAGE,
  BroadcastError,
  generateBroadcastLink,
  markBroadcastHeat,
  readBroadcastControl,
  revokeBroadcastLink,
  setBroadcastMode
} from '@/lib/serverBroadcast';
import { SheetAccessError, assertSheetManagerAccess } from '@/lib/serverSheetAccess';
import { checkRateLimit, createSupabaseAdmin, requireSession, safeErrorMessage } from '@/lib/serverSecurity';

// Mesa de controle do telão (Story 1.58), na aba "Telão" do painel. Só o
// gestor dono do evento (com acesso válido) ou o owner: gerar e revogar o link,
// escolher o que o telão mostra e marcar largada e encerramento da bateria.

export const dynamic = 'force-dynamic';

const ROLES = ['manager', 'owner'] as const;
const ACTIONS = new Set(['generate_link', 'revoke_link', 'set_mode', 'mark_heat']);
const ACCESS = { notPresentialMessage: BROADCAST_EVENT_TYPE_MESSAGE };

const errorResponse = (error: unknown) => {
  if (error instanceof BroadcastError || error instanceof SheetAccessError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error('Erro na mesa do telão:', error);
  return NextResponse.json({ error: safeErrorMessage(error, 'Erro ao processar o telão.') }, { status: 500 });
};

export async function GET(request: Request) {
  try {
    const auth = requireSession(request, [...ROLES]);
    if (auth.response) return auth.response;
    const supabaseAdmin = createSupabaseAdmin();
    const event = await assertSheetManagerAccess(supabaseAdmin, auth.user, new URL(request.url).searchParams.get('eventId'), ACCESS);
    return NextResponse.json(await readBroadcastControl(supabaseAdmin, event.id), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = requireSession(request, [...ROLES]);
    if (auth.response) return auth.response;
    const actor = auth.user;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const action = typeof body?.action === 'string' ? body.action : '';
    if (!body || !ACTIONS.has(action)) return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });

    const limited = checkRateLimit({ key: `telao-control:${actor.id}`, limit: 60, windowMs: 60_000 });
    if (limited) return limited;

    const supabaseAdmin = createSupabaseAdmin();
    const event = await assertSheetManagerAccess(supabaseAdmin, actor, body.eventId, ACCESS);

    if (action === 'generate_link') {
      const link = await generateBroadcastLink(supabaseAdmin, actor, event.id);
      return NextResponse.json({ token: link.token, createdAt: link.createdAt }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (action === 'revoke_link') await revokeBroadcastLink(supabaseAdmin, actor, event.id);
    if (action === 'set_mode') await setBroadcastMode(supabaseAdmin, actor, event.id, { mode: body.mode, heatId: body.heatId, divisionId: body.divisionId });
    if (action === 'mark_heat') await markBroadcastHeat(supabaseAdmin, actor, event.id, { heatId: body.heatId, mark: body.mark });
    return NextResponse.json(await readBroadcastControl(supabaseAdmin, event.id), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
