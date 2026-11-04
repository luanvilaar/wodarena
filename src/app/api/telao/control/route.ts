import type { SupabaseClient } from '@supabase/supabase-js';
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
import { readRaceBroadcastControl } from '@/lib/serverRaceBroadcast';
import { RaceSheetAccessError, assertRaceManagerAccess, isRaceEventType } from '@/lib/serverRaceSheetAccess';
import { SheetAccessError, assertSheetManagerAccess } from '@/lib/serverSheetAccess';
import { checkRateLimit, createSupabaseAdmin, requireSession, safeErrorMessage } from '@/lib/serverSecurity';

// Mesa de controle do telão (Story 1.58), na aba "Telão" do painel. Só o
// gestor dono do evento (com acesso válido) ou o owner: gerar e revogar o link,
// escolher o que o telão mostra e, em Functional Fitness, marcar largada e
// encerramento da bateria. A rota decide pelo tipo do evento (Story 1.115):
// Fitness Race tem acesso (`assertRaceManagerAccess`) e leitura próprios e
// nunca marca largada por aqui (D45): ela é só do gesto do gestor na seção
// Ondas da aba Súmula Fitness Race. O Qualifier segue recusado (400).

export const dynamic = 'force-dynamic';

const ROLES = ['manager', 'owner'] as const;
const ACTIONS = new Set(['generate_link', 'revoke_link', 'set_mode', 'mark_heat']);
const ACCESS = { notPresentialMessage: BROADCAST_EVENT_TYPE_MESSAGE };
const RACE_MARK_HEAT_MESSAGE = 'A largada do Fitness Race é feita na seção Ondas da aba Súmula Fitness Race, não no telão.';

const errorResponse = (error: unknown) => {
  if (error instanceof BroadcastError || error instanceof SheetAccessError || error instanceof RaceSheetAccessError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error('Erro na mesa do telão:', error);
  return NextResponse.json({ error: safeErrorMessage(error, 'Erro ao processar o telão.') }, { status: 500 });
};

/** O evento é Fitness Race? Só o tipo: quem decide o acesso é a função do tipo certo. */
const isRaceEventId = async (supabaseAdmin: SupabaseClient, eventId: unknown) => {
  if (typeof eventId !== 'string' || !eventId) return false;
  const { data, error } = await supabaseAdmin.from('events').select('event_type').eq('id', eventId).maybeSingle();
  if (error) throw error;
  return isRaceEventType((data as { event_type?: unknown } | null)?.event_type);
};

export async function GET(request: Request) {
  try {
    const auth = requireSession(request, [...ROLES]);
    if (auth.response) return auth.response;
    const supabaseAdmin = createSupabaseAdmin();
    const eventId = new URL(request.url).searchParams.get('eventId');
    if (await isRaceEventId(supabaseAdmin, eventId)) {
      const raceEvent = await assertRaceManagerAccess(supabaseAdmin, auth.user, eventId);
      return NextResponse.json(await readRaceBroadcastControl(supabaseAdmin, raceEvent.id), { headers: { 'Cache-Control': 'no-store' } });
    }
    const event = await assertSheetManagerAccess(supabaseAdmin, auth.user, eventId, ACCESS);
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
    const race = await isRaceEventId(supabaseAdmin, body.eventId);
    const event = race
      ? await assertRaceManagerAccess(supabaseAdmin, actor, body.eventId)
      : await assertSheetManagerAccess(supabaseAdmin, actor, body.eventId, ACCESS);
    // D45: o telão do Fitness Race só lê. Largada e encerramento de bateria não existem nele, e a recusa é
    // aqui, no servidor, antes de qualquer gravação em `broadcast_heat_states`.
    if (race && action === 'mark_heat') throw new BroadcastError(RACE_MARK_HEAT_MESSAGE, 400);

    if (action === 'generate_link') {
      const link = await generateBroadcastLink(supabaseAdmin, actor, event.id);
      return NextResponse.json({ token: link.token, createdAt: link.createdAt }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (action === 'revoke_link') await revokeBroadcastLink(supabaseAdmin, actor, event.id);
    if (action === 'set_mode') await setBroadcastMode(supabaseAdmin, actor, event.id, { mode: body.mode, heatId: body.heatId, divisionId: body.divisionId });
    if (action === 'mark_heat') await markBroadcastHeat(supabaseAdmin, actor, event.id, { heatId: body.heatId, mark: body.mark });
    const view = race ? await readRaceBroadcastControl(supabaseAdmin, event.id) : await readBroadcastControl(supabaseAdmin, event.id);
    return NextResponse.json(view, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
