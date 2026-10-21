import { NextResponse } from 'next/server';

import {
  SheetError,
  appendSheetEvents,
  buildSheetBoard,
  listSheetsForManager,
  markAthleteAbsent,
  markSheetAbsent,
  openSheet,
  readScoresForWorkouts,
  readSheetEventId,
  readSheetForActor,
  reviewSheet,
  submitSheet
} from '@/lib/serverScoresheets';
import {
  SheetAccessError,
  assertSheetJudgeAccess,
  assertSheetManagerAccess,
  listSheetEventsForActor
} from '@/lib/serverSheetAccess';
import { checkRateLimit, createSupabaseAdmin, requireSession, safeErrorMessage } from '@/lib/serverSecurity';

// Súmula digital presencial (Stories 1.49 a 1.52). Um só ponto de entrada,
// como /api/admin/persistence: sessão de judge, gestor ou owner; acesso
// conferido por evento (serverSheetAccess.ts) antes de ler ou gravar; limite
// de requisições por pessoa e ação. O servidor calcula e publica o resultado;
// o aparelho só envia o log. Atleta ausente (Story 1.59): `absent` (judge, na
// súmula dele), `review` com `review: 'absent'` (gestor, sobre a súmula) e
// `mark_absent` (gestor, atleta sem súmula); nenhum leva resultado no corpo.

const ROLES = ['judge', 'manager', 'owner'] as const;
const LIMITS: Record<string, number> = { append: 600, open: 60, submit: 30, review: 60, absent: 30, mark_absent: 60 };

const errorResponse = (error: unknown) => {
  if (error instanceof SheetError) return NextResponse.json({ error: error.message, ...error.extra }, { status: error.status });
  if (error instanceof SheetAccessError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error('Erro na súmula digital:', error);
  return NextResponse.json({ error: safeErrorMessage(error, 'Erro ao processar a súmula.') }, { status: 500 });
};

export async function GET(request: Request) {
  try {
    const auth = requireSession(request, [...ROLES]);
    if (auth.response) return auth.response;
    const actor = auth.user;
    const supabaseAdmin = createSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const view = searchParams.get('view');

    if (view === 'events') {
      const events = await listSheetEventsForActor(supabaseAdmin, actor);
      return NextResponse.json({ events: events.map((event) => ({ id: event.id, name: event.name, date: event.date ?? '', location: event.location ?? '', status: event.status ?? '' })) });
    }

    if (view === 'board') {
      const event = await assertSheetJudgeAccess(supabaseAdmin, actor, searchParams.get('eventId'));
      const board = await buildSheetBoard(supabaseAdmin, event.id);
      return NextResponse.json({ ...board, viewer: { id: actor.id, name: actor.name, role: actor.role } });
    }

    if (view === 'sheet') {
      const sheetId = searchParams.get('sheetId');
      await assertSheetJudgeAccess(supabaseAdmin, actor, await readSheetEventId(supabaseAdmin, sheetId));
      const data = await readSheetForActor(supabaseAdmin, sheetId);
      return NextResponse.json({ ...data, viewer: { id: actor.id, name: actor.name, role: actor.role } });
    }

    if (view === 'manage') {
      const event = await assertSheetManagerAccess(supabaseAdmin, actor, searchParams.get('eventId'));
      const sheets = await listSheetsForManager(supabaseAdmin, event.id);
      const locks: Record<string, number> = {};
      for (const sheet of sheets) {
        if (sheet.status !== 'cancelled') locks[sheet.workoutId] = (locks[sheet.workoutId] ?? 0) + 1;
      }
      const scores = await readScoresForWorkouts(supabaseAdmin, [...new Set(sheets.map((sheet) => sheet.workoutId))]);
      return NextResponse.json({ sheets, locks, scores });
    }

    return NextResponse.json({ error: 'Visão desconhecida.' }, { status: 400 });
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
    if (!body || !(action in LIMITS)) return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });

    const limited = checkRateLimit({ key: `sheets:${actor.id}:${action}`, limit: LIMITS[action], windowMs: 60_000 });
    if (limited) return limited;

    const supabaseAdmin = createSupabaseAdmin();

    if (action === 'open') {
      const event = await assertSheetJudgeAccess(supabaseAdmin, actor, body.eventId);
      const row = await openSheet(supabaseAdmin, actor, {
        eventId: event.id,
        workoutId: body.workoutId,
        athleteId: body.athleteId,
        heatId: body.heatId,
        lane: body.lane
      });
      return NextResponse.json(await readSheetForActor(supabaseAdmin, row.id));
    }

    if (action === 'mark_absent') {
      const event = await assertSheetManagerAccess(supabaseAdmin, actor, body.eventId);
      return NextResponse.json(await markAthleteAbsent(supabaseAdmin, actor, {
        eventId: event.id,
        workoutId: body.workoutId,
        athleteId: body.athleteId,
        reason: body.reason,
        heatId: body.heatId,
        lane: body.lane
      }));
    }

    const eventId = await readSheetEventId(supabaseAdmin, body.sheetId);

    if (action === 'append') {
      await assertSheetJudgeAccess(supabaseAdmin, actor, eventId);
      return NextResponse.json(await appendSheetEvents(supabaseAdmin, actor, body.sheetId, { fromSeq: body.fromSeq, events: body.events }));
    }

    if (action === 'submit') {
      await assertSheetJudgeAccess(supabaseAdmin, actor, eventId);
      return NextResponse.json(await submitSheet(supabaseAdmin, actor, body.sheetId, { expectedCount: body.expectedCount }));
    }

    if (action === 'absent') {
      await assertSheetJudgeAccess(supabaseAdmin, actor, eventId);
      return NextResponse.json(await markSheetAbsent(supabaseAdmin, actor, body.sheetId));
    }

    await assertSheetManagerAccess(supabaseAdmin, actor, eventId);
    return NextResponse.json(await reviewSheet(supabaseAdmin, actor, body.sheetId, {
      action: body.review,
      reason: body.reason,
      result: body.result,
      tieBreak: body.tieBreak
    }));
  } catch (error) {
    return errorResponse(error);
  }
}
