import { NextResponse } from 'next/server';

import {
  RaceSheetError,
  appendRaceEvents,
  claimRaceAttempt,
  dismissRaceAttempt,
  openRaceAttempt,
  readRaceAttemptEventId,
  readRaceAttemptForActor,
  readRaceJudgeCards,
  readRaceStationBoard,
  readRaceStations,
  readRaceWallBallBoard,
  readRaceWaves,
  startRaceHeat,
  toRaceAttemptDto
} from '@/lib/serverRaceSheets';
import {
  adjustRaceHeatStart,
  adjustRaceInfraction,
  adjustRaceRunTime,
  markRaceRunDnf,
  readRaceManageBoard,
  republishAfterRaceClose,
  resetRaceHeat,
  retryRaceRunRepublish,
  revokeRaceInfraction,
  unmarkRaceRunDnf
} from '@/lib/serverRaceDecisions';
import {
  clearRaceWaveAssignments,
  readRaceAssignments,
  readRaceMyStations,
  saveRaceAssignments
} from '@/lib/serverRaceAssignments';
import { readRaceCoverage } from '@/lib/serverRaceCoverage';
import {
  RaceSheetAccessError,
  assertRaceJudgeAccess,
  assertRaceManagerAccess,
  listRaceEventsForActor
} from '@/lib/serverRaceSheetAccess';
import { checkRateLimit, createSupabaseAdmin, requireSession, safeErrorMessage, type SessionUser } from '@/lib/serverSecurity';

// Súmula Fitness Race (Story 1.94, fase F1). Um só ponto de entrada, no padrão
// de /api/sheets (que continua só de Functional Fitness): sessão de judge,
// gestor ou owner; acesso conferido por evento (serverRaceSheetAccess.ts, só
// evento Fitness Race) antes de ler ou gravar; limite de requisições por
// pessoa e ação. O servidor recalcula as infrações com o motor; o aparelho só
// envia o log. As stories seguintes acrescentam as ações delas aqui, cada uma
// com o seu limite em LIMITS.

const ROLES = ['judge', 'manager', 'owner'] as const;
const LIMITS: Record<string, number> = {
  open_attempt: 60,
  claim_attempt: 60,
  // Story 1.103 (AC5, AC10): dispensar o cartão e soltar o próprio cartão (claim_attempt com release, ou release_attempt).
  dismiss_attempt: 30,
  release_attempt: 30,
  append: 600,
  start_heat: 30,
  // Decisões do organizador (Story 1.98) e correção da largada (Story 1.96, AC7).
  revoke_infraction: 60,
  adjust_infraction: 60,
  adjust_time: 60,
  mark_dnf: 30,
  unmark_dnf: 30,
  adjust_heat_start: 10,
  // Zerar a largada da onda (Story 1.107): cancela as corridas e retira os resultados.
  reset_heat: 10,
  republish_run: 30,
  // Escala de judges por estação (Story 1.104, AC3): só orienta (D3), não entra no open_attempt.
  save_assignments: 60,
  clear_wave_assignments: 30
};

// Ações de decisão do organizador: gestor dono do evento (com acesso válido) ou owner; judge recebe 403.
type DecisionHandler = (supabaseAdmin: ReturnType<typeof createSupabaseAdmin>, actor: SessionUser, eventId: string, body: Record<string, unknown>) => Promise<unknown>;
const DECISIONS: Record<string, DecisionHandler> = {
  revoke_infraction: (db, actor, eventId, body) => revokeRaceInfraction(db, actor, eventId, { infractionId: body.infractionId, reason: body.reason }),
  adjust_infraction: (db, actor, eventId, body) => adjustRaceInfraction(db, actor, eventId, { infractionId: body.infractionId, seconds: body.seconds, label: body.label, reason: body.reason }),
  adjust_time: (db, actor, eventId, body) => adjustRaceRunTime(db, actor, eventId, { runId: body.runId, grossSeconds: body.grossSeconds, reason: body.reason }),
  mark_dnf: (db, actor, eventId, body) => markRaceRunDnf(db, actor, eventId, { runId: body.runId, reason: body.reason }),
  unmark_dnf: (db, actor, eventId, body) => unmarkRaceRunDnf(db, actor, eventId, { runId: body.runId, reason: body.reason }),
  adjust_heat_start: (db, actor, eventId, body) => adjustRaceHeatStart(db, actor, eventId, { heatId: body.heatId, clock: body.clock, reason: body.reason }),
  reset_heat: (db, actor, eventId, body) => resetRaceHeat(db, actor, eventId, { heatId: body.heatId, reason: body.reason }),
  republish_run: (db, actor, eventId, body) => retryRaceRunRepublish(db, actor, eventId, { runId: body.runId, runIds: body.runIds })
};

// Escala de judges (Story 1.104, AC3): gestor dono do evento (com acesso válido) ou owner; judge recebe 403.
type AssignmentHandler = (supabaseAdmin: ReturnType<typeof createSupabaseAdmin>, actor: SessionUser, event: { id: string; organizer_id: string }, body: Record<string, unknown>) => Promise<unknown>;
const ASSIGNMENTS: Record<string, AssignmentHandler> = {
  save_assignments: (db, actor, event, body) => saveRaceAssignments(db, actor, event, { heatId: body.heatId, assignments: body.assignments }),
  clear_wave_assignments: (db, _actor, event, body) => clearRaceWaveAssignments(db, event, { heatId: body.heatId })
};

const errorResponse = (error: unknown) => {
  if (error instanceof RaceSheetError) return NextResponse.json({ error: error.message, ...error.extra }, { status: error.status });
  if (error instanceof RaceSheetAccessError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error('Erro na súmula Fitness Race:', error);
  return NextResponse.json({ error: safeErrorMessage(error, 'Erro ao processar a súmula Fitness Race.') }, { status: 500 });
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
      const events = await listRaceEventsForActor(supabaseAdmin, actor);
      return NextResponse.json({ events: events.map((event) => ({ id: event.id, name: event.name, date: event.date ?? '', location: event.location ?? '', status: event.status ?? '' })) });
    }

    // Ondas do cronograma com o estado da largada (Story 1.96): tela de largada e seção "Ondas" do painel.
    if (view === 'waves') {
      const event = await assertRaceJudgeAccess(supabaseAdmin, actor, searchParams.get('eventId'));
      return NextResponse.json({ ...(await readRaceWaves(supabaseAdmin, event.id)), viewer: { id: actor.id, name: actor.name, role: actor.role } });
    }

    // Lista da onda do Wall Ball (Story 1.97, AC1): atletas em corrida das ondas que largaram e as tentativas.
    if (view === 'wall_ball') {
      const event = await assertRaceJudgeAccess(supabaseAdmin, actor, searchParams.get('eventId'));
      return NextResponse.json({ ...(await readRaceWallBallBoard(supabaseAdmin, event.id)), viewer: { id: actor.id, name: actor.name, role: actor.role } });
    }

    // Estações do evento para o judge escolher onde está (Story 1.102, AC3): chave, nome, tipo, meta e se fecha o tempo, por categoria.
    if (view === 'stations') {
      const event = await assertRaceJudgeAccess(supabaseAdmin, actor, searchParams.get('eventId'));
      return NextResponse.json({ ...(await readRaceStations(supabaseAdmin, event.id)), viewer: { id: actor.id, name: actor.name, role: actor.role } });
    }

    // Lista da onda de uma estação (Story 1.102, AC3): atletas em corrida cujo percurso contém a estação, com a tentativa.
    if (view === 'station_board') {
      const event = await assertRaceJudgeAccess(supabaseAdmin, actor, searchParams.get('eventId'));
      return NextResponse.json({ ...(await readRaceStationBoard(supabaseAdmin, event.id, searchParams.get('stationKey'))), viewer: { id: actor.id, name: actor.name, role: actor.role } });
    }

    // Cartões abertos de quem pede (Story 1.103, AC7, AC10): as tentativas ativas dele no evento.
    if (view === 'my_cards') {
      const event = await assertRaceJudgeAccess(supabaseAdmin, actor, searchParams.get('eventId'));
      return NextResponse.json({ ...(await readRaceJudgeCards(supabaseAdmin, event.id, actor)), viewer: { id: actor.id, name: actor.name, role: actor.role } });
    }

    // Painel do organizador (Story 1.98): penalidades e corridas. Judge: 403.
    if (view === 'manage') {
      const event = await assertRaceManagerAccess(supabaseAdmin, actor, searchParams.get('eventId'));
      return NextResponse.json({ ...(await readRaceManageBoard(supabaseAdmin, event.id)), viewer: { id: actor.id, name: actor.name, role: actor.role } });
    }

    // Escala de judges para o editor do organizador (Story 1.104, AC4). Judge: 403.
    if (view === 'assignments') {
      const event = await assertRaceManagerAccess(supabaseAdmin, actor, searchParams.get('eventId'));
      return NextResponse.json({ ...(await readRaceAssignments(supabaseAdmin, event)), viewer: { id: actor.id, name: actor.name, role: actor.role } });
    }

    // Cobertura ao vivo (Story 1.105, AC2): escala efetiva, cartões abertos e atletas esperando por onda. Só leitura. Judge: 403.
    if (view === 'coverage') {
      const event = await assertRaceManagerAccess(supabaseAdmin, actor, searchParams.get('eventId'));
      return NextResponse.json({ ...(await readRaceCoverage(supabaseAdmin, event)), viewer: { id: actor.id, name: actor.name, role: actor.role } });
    }

    // "Minhas estações" de quem pede (Story 1.104, AC6): a escala efetiva dele por onda.
    if (view === 'my_stations') {
      const event = await assertRaceJudgeAccess(supabaseAdmin, actor, searchParams.get('eventId'));
      return NextResponse.json({ ...(await readRaceMyStations(supabaseAdmin, event, actor)), viewer: { id: actor.id, name: actor.name, role: actor.role } });
    }

    if (view === 'attempt') {
      const attemptId = searchParams.get('attemptId');
      await assertRaceJudgeAccess(supabaseAdmin, actor, await readRaceAttemptEventId(supabaseAdmin, attemptId));
      const data = await readRaceAttemptForActor(supabaseAdmin, attemptId);
      return NextResponse.json({ ...data, viewer: { id: actor.id, name: actor.name, role: actor.role } });
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
    if (!body || !Object.hasOwn(LIMITS, action)) return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });

    // Soltar o cartão tem limite próprio, mesmo pedido como claim_attempt com release (Story 1.103, AC10).
    const release = action === 'release_attempt' || (action === 'claim_attempt' && body.release === true);
    const limitAction = release ? 'release_attempt' : action;
    const limited = checkRateLimit({ key: `race-sheets:${actor.id}:${limitAction}`, limit: LIMITS[limitAction], windowMs: 60_000 });
    if (limited) return limited;

    const supabaseAdmin = createSupabaseAdmin();

    if (action === 'open_attempt') {
      const event = await assertRaceJudgeAccess(supabaseAdmin, actor, body.eventId);
      const row = await openRaceAttempt(supabaseAdmin, actor, {
        eventId: event.id,
        athleteId: body.athleteId,
        stationId: body.stationId,
        lane: body.lane
      });
      return NextResponse.json(await readRaceAttemptForActor(supabaseAdmin, row.id));
    }

    // Largada da onda (Story 1.96): judge atribuído, gestor dono ou owner.
    if (action === 'start_heat') {
      const event = await assertRaceJudgeAccess(supabaseAdmin, actor, body.eventId);
      return NextResponse.json(await startRaceHeat(supabaseAdmin, actor, event.id, {
        heatId: body.heatId,
        deviceAt: body.deviceAt,
        clientNow: body.clientNow
      }));
    }

    if (Object.hasOwn(DECISIONS, action)) {
      const event = await assertRaceManagerAccess(supabaseAdmin, actor, body.eventId);
      return NextResponse.json(await DECISIONS[action](supabaseAdmin, actor, event.id, body));
    }

    if (Object.hasOwn(ASSIGNMENTS, action)) {
      const event = await assertRaceManagerAccess(supabaseAdmin, actor, body.eventId);
      return NextResponse.json(await ASSIGNMENTS[action](supabaseAdmin, actor, event, body));
    }

    const eventId = await readRaceAttemptEventId(supabaseAdmin, body.attemptId);

    if (action === 'claim_attempt' || action === 'release_attempt') {
      // Liberar qualquer tentativa (tirar o árbitro) é do gestor dono ou do owner; o judge
      // solta só o próprio cartão (Story 1.103, AC5); assumir é de quem arbitra o evento.
      if (release && actor.role !== 'judge') await assertRaceManagerAccess(supabaseAdmin, actor, eventId);
      else await assertRaceJudgeAccess(supabaseAdmin, actor, eventId);
      const row = await claimRaceAttempt(supabaseAdmin, actor, body.attemptId, { release });
      return NextResponse.json(await readRaceAttemptForActor(supabaseAdmin, row.id));
    }

    // Dispensar o cartão aberto por engano (Story 1.103, AC5): o judge dono, sem registros.
    if (action === 'dismiss_attempt') {
      await assertRaceJudgeAccess(supabaseAdmin, actor, eventId);
      const row = await dismissRaceAttempt(supabaseAdmin, actor, body.attemptId);
      return NextResponse.json({ attempt: toRaceAttemptDto(row) });
    }

    // append
    await assertRaceJudgeAccess(supabaseAdmin, actor, eventId);
    const { closedRunId, republishRunId, ...appended } = await appendRaceEvents(supabaseAdmin, actor, body.attemptId, {
      fromSeq: body.fromSeq,
      events: body.events,
      clientNow: body.clientNow
    });
    // Corrida fechada pela liberação da última estação (Story 1.101, D34) ou
    // registro tardio numa corrida já fechada (Story 1.101, AC5): publica no
    // leaderboard pelo ponto único (Story 1.99, AC1).
    const publishRunId = closedRunId ?? republishRunId;
    if (!publishRunId) return NextResponse.json(appended);
    return NextResponse.json({ ...appended, republish: await republishAfterRaceClose(supabaseAdmin, publishRunId) });
  } catch (error) {
    return errorResponse(error);
  }
}
