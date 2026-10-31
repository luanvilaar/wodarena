import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import { lastRaceStation } from '@/lib/raceCourseStructure';
import {
  isRaceInfractionAltered,
  originalRaceInfractionSeconds,
  type RaceClosingStationSnapshot,
  type RaceManageDecision,
  type RaceManagePenalty
} from '@/lib/racePenaltiesView';
import { computeOfficialSeconds, sumConfirmedPenaltySeconds } from '@/lib/raceRules';
import { publishRaceRun } from '@/lib/serverRacePublication';
import { RACE_DEFAULT_TIME_ZONE, findRaceHeatItem, raceWaveTitle, readRaceHeatItems } from '@/lib/raceWaves';
import {
  RaceSheetError,
  closeRaceRunOnRelease,
  isMissingRaceSchema,
  readRaceClosingStationId,
  resolveEventTime,
  type RaceAttemptRow,
  type RaceInfractionRow,
  type RaceRulesetRow,
  type RaceRunRow,
  type RaceRunStatus
} from '@/lib/serverRaceSheets';
import type { SessionUser } from '@/lib/serverSecurity';

// Decisões do organizador na súmula Fitness Race (Story 1.98): revogar e
// alterar penalidade, ajustar o tempo, marcar e desfazer DNF, e a correção da
// largada da onda (Story 1.96, AC7, D14a). Não há DQ: o caso grave é DNF. Toda decisão
// exige motivo (conferido aqui, não só na tela), grava race_decisions com o
// antes e o depois e, quando muda tempo ou penalidade, chama o ponto único de
// republicação (republishRaceRun), que recalcula penalty_seconds e
// official_seconds e chama o publicador: `publishRaceRun` (Story 1.99,
// serverRacePublication.ts), trocável nos testes por setRaceRunPublisher. Falha na
// republicação não desfaz a decisão: volta como aviso para tentar de novo.
// O recálculo do motor (serverRaceSheets.ts) não mexe em infração com
// `decided_at`, então nenhuma decisão daqui é desfeita por um lote novo.

const UNAVAILABLE_MESSAGE = 'A súmula Fitness Race ainda não está disponível neste ambiente. Aplique a migration 20261030120000_race_sheets.sql antes de usar.';

const check = <T>(result: { data: T; error: unknown }) => {
  if (result.error) {
    if (isMissingRaceSchema(result.error)) throw new RaceSheetError(UNAVAILABLE_MESSAGE, 503);
    throw result.error;
  }
  return result.data;
};

// Horário das decisões estritamente crescente no processo: "a decisão mais
// recente" (AC16) não empata quando duas saem no mesmo milissegundo.
let lastDecisionMs = 0;
const decisionTime = () => {
  lastDecisionMs = Math.max(Date.now(), lastDecisionMs + 1);
  return new Date(lastDecisionMs).toISOString();
};

const newId = (prefix: string) => `${prefix}_${randomUUID()}`;
type PlainObject = Record<string, unknown>;
const isPlainObject = (value: unknown): value is PlainObject => value !== null && typeof value === 'object' && !Array.isArray(value);
const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));

export const RACE_DECISION_REASON_MIN = 3;
export const RACE_DECISION_REASON_MAX = 1000;
const MAX_INFRACTION_SECONDS = 3600;
const MAX_GROSS_SECONDS = 24 * 3600;

/** Motivo obrigatório de toda decisão (aparado, 3 a 1000 caracteres). */
export const readDecisionReason = (value: unknown) => {
  const reason = typeof value === 'string' ? value.trim() : '';
  if (reason.length < RACE_DECISION_REASON_MIN) throw new RaceSheetError('Escreva o motivo da decisão (pelo menos 3 caracteres).', 400);
  if (reason.length > RACE_DECISION_REASON_MAX) throw new RaceSheetError(`O motivo passa de ${RACE_DECISION_REASON_MAX} caracteres.`, 400);
  return reason;
};

const assertDecider = (actor: SessionUser) => {
  // A rota já confere o acesso de gestor dono ou owner; aqui é a defesa extra (judge nunca decide).
  if (actor.role !== 'manager' && actor.role !== 'owner') throw new RaceSheetError('Só o gestor do evento ou o owner decidem.', 403);
};

const actorRole = (actor: SessionUser) => (actor.role === 'owner' ? 'owner' : 'manager');

// ---------------------------------------------------------------------------
// Leitura e estado
// ---------------------------------------------------------------------------

const readRun = async (supabaseAdmin: SupabaseClient, eventId: string, runId: unknown) => {
  if (typeof runId !== 'string' || !runId) throw new RaceSheetError('Informe a corrida.', 400);
  const run = check(await supabaseAdmin.from('race_runs').select('*').eq('id', runId).maybeSingle()) as RaceRunRow | null;
  if (!run || run.event_id !== eventId) throw new RaceSheetError('Corrida não encontrada neste evento.', 404);
  return run;
};

const readRunInfractions = async (supabaseAdmin: SupabaseClient, runId: string) => (
  (check(await supabaseAdmin.from('race_infractions').select('*').eq('run_id', runId)) || []) as RaceInfractionRow[]
);

const readInfraction = async (supabaseAdmin: SupabaseClient, eventId: string, infractionId: unknown) => {
  if (typeof infractionId !== 'string' || !infractionId) throw new RaceSheetError('Informe a penalidade.', 400);
  const row = check(await supabaseAdmin.from('race_infractions').select('*').eq('id', infractionId).maybeSingle()) as RaceInfractionRow | null;
  if (!row) throw new RaceSheetError('Penalidade não encontrada neste evento.', 404);
  const run = await readRun(supabaseAdmin, eventId, row.run_id).catch(() => null);
  if (!run) throw new RaceSheetError('Penalidade não encontrada neste evento.', 404);
  return { infraction: row, run };
};

/** Estado da corrida gravado em `before`/`after` (AC16: completo, para o desfazer). */
export const RACE_RUN_STATE_KEYS = ['status', 'finish_at', 'gross_seconds', 'penalty_seconds', 'official_seconds', 'time_source'] as const;

const runState = (run: Pick<RaceRunRow, typeof RACE_RUN_STATE_KEYS[number]>) => ({
  status: run.status,
  finish_at: run.finish_at ?? null,
  gross_seconds: num(run.gross_seconds),
  penalty_seconds: Number(run.penalty_seconds ?? 0),
  official_seconds: num(run.official_seconds),
  time_source: run.time_source ?? null
});

const vigentes = (infractions: RaceInfractionRow[]) => infractions.map((row) => ({ kind: row.kind, status: row.status, seconds: Number(row.seconds) }));

/** Penalidades e tempo oficial da corrida (D2): só `finished` tem oficial. */
const runTotals = (status: RaceRunStatus, grossSeconds: number | null, infractions: RaceInfractionRow[]) => ({
  penalty_seconds: sumConfirmedPenaltySeconds(vigentes(infractions)),
  official_seconds: status === 'finished' ? computeOfficialSeconds(grossSeconds, vigentes(infractions)) : null
});

const changedRun = () => new RaceSheetError('A corrida mudou agora. Recarregue e decida de novo.', 409);
const changedInfraction = () => new RaceSheetError('A penalidade mudou agora. Recarregue e decida de novo.', 409);

/** Grava na corrida só se a situação ainda é a lida; confere depois (outra decisão no mesmo instante = 409). */
const updateRunIf = async (supabaseAdmin: SupabaseClient, run: RaceRunRow, patch: Partial<RaceRunRow> & { updated_at: string }) => {
  check(await supabaseAdmin.from('race_runs').update(patch).eq('id', run.id).eq('status', run.status));
  const fresh = check(await supabaseAdmin.from('race_runs').select('*').eq('id', run.id).maybeSingle()) as RaceRunRow | null;
  // A situação também é conferida: outra gravação no mesmo milissegundo (o
  // árbitro liberou e a corrida fechou) deixaria o mesmo `updated_at` sem a
  // nossa gravação ter valido (REL-002, teste intermitente).
  if (!fresh || Date.parse(fresh.updated_at) !== Date.parse(patch.updated_at) || fresh.status !== (patch.status ?? run.status)) throw changedRun();
  return fresh;
};

const updateInfractionIf = async (supabaseAdmin: SupabaseClient, row: RaceInfractionRow, patch: Partial<RaceInfractionRow> & { updated_at: string }) => {
  check(await supabaseAdmin.from('race_infractions').update(patch).eq('id', row.id).eq('status', row.status));
  const fresh = check(await supabaseAdmin.from('race_infractions').select('*').eq('id', row.id).maybeSingle()) as RaceInfractionRow | null;
  if (!fresh || Date.parse(fresh.updated_at) !== Date.parse(patch.updated_at)) throw changedInfraction();
  return fresh;
};

/** Regrava penalidades e tempo oficial da corrida com as infrações de agora, sem mudar a situação. */
const refreshRunTotals = async (supabaseAdmin: SupabaseClient, runId: string) => {
  const run = check(await supabaseAdmin.from('race_runs').select('*').eq('id', runId).maybeSingle()) as RaceRunRow | null;
  if (!run) throw new RaceSheetError('Corrida não encontrada.', 404);
  const totals = runTotals(run.status, num(run.gross_seconds), await readRunInfractions(supabaseAdmin, run.id));
  if (Number(run.penalty_seconds ?? 0) === totals.penalty_seconds && num(run.official_seconds) === totals.official_seconds) return run;
  const patch = { ...totals, updated_at: decisionTime() };
  check(await supabaseAdmin.from('race_runs').update(patch).eq('id', run.id).eq('status', run.status));
  return { ...run, ...patch };
};

type DecisionInput = {
  eventId: string;
  action: string;
  reason: string | null;
  runId?: string | null;
  infractionId?: string | null;
  heatId?: string | null;
  before: PlainObject | null;
  after: PlainObject | null;
};

const insertDecision = async (supabaseAdmin: SupabaseClient, actor: SessionUser, input: DecisionInput) => {
  const row = {
    id: newId('decision'),
    event_id: input.eventId,
    run_id: input.runId ?? null,
    heat_id: input.heatId ?? null,
    infraction_id: input.infractionId ?? null,
    action: input.action,
    actor_user_id: actor.id,
    actor_name: actor.name,
    actor_role: actorRole(actor),
    reason: input.reason,
    before: input.before,
    after: input.after,
    created_at: decisionTime()
  };
  check(await supabaseAdmin.from('race_decisions').insert(row));
  return row;
};

// ---------------------------------------------------------------------------
// Ponto único de republicação (AC12)
// ---------------------------------------------------------------------------

/** Publicador do resultado da corrida: `publishRaceRun` (Story 1.99), no placar da prova TOTAL. */
export type RaceRunPublisher = (supabaseAdmin: SupabaseClient, run: RaceRunRow) => unknown | Promise<unknown>;
let raceRunPublisher: RaceRunPublisher | null = publishRaceRun;

/** Troca o publicador (os testes usam um substituto que falha). null = sem publicação. */
export const setRaceRunPublisher = (publisher: RaceRunPublisher | null) => {
  raceRunPublisher = publisher;
};

/**
 * Ponto único de republicação da corrida (AC12): recalcula `penalty_seconds` e
 * `official_seconds` com as penalidades vigentes (bruto + `confirmed`, D2;
 * DNF sem oficial) e chama o publicador. Idempotente: pode ser chamado
 * de novo pelo "Tentar de novo" do painel.
 */
export const republishRaceRun = async (supabaseAdmin: SupabaseClient, runId: string) => {
  const run = await refreshRunTotals(supabaseAdmin, runId);
  if (raceRunPublisher) await raceRunPublisher(supabaseAdmin, run);
  return run;
};

export const RACE_REPUBLISH_WARNING = 'Decisão gravada, mas o resultado não foi atualizado. Tente de novo.';

/** Republica as corridas sem desfazer a decisão: a falha volta como aviso, com as corridas a tentar de novo. */
const republishAfterDecision = async (supabaseAdmin: SupabaseClient, runIds: string[]) => {
  const failedRunIds: string[] = [];
  for (const runId of runIds) {
    try {
      await republishRaceRun(supabaseAdmin, runId);
    } catch (error) {
      console.error('Erro ao republicar a corrida Fitness Race:', error);
      failedRunIds.push(runId);
    }
  }
  return failedRunIds.length ? { ok: false as const, failedRunIds, warning: RACE_REPUBLISH_WARNING } : { ok: true as const, failedRunIds };
};

/**
 * Fechamento da corrida pela súmula (Story 1.101, D34: só a liberação da
 * última estação do percurso fecha; no tipo reps, com as reps completas, D22)
 * e registro tardio de uma estação anterior com o tempo já fechado (Story
 * 1.101, AC5, D9): publica pelo mesmo ponto único (Story 1.99, AC1). Falha
 * volta como aviso; o log do árbitro já está gravado.
 */
export const republishAfterRaceClose = (supabaseAdmin: SupabaseClient, runId: string) => republishAfterDecision(supabaseAdmin, [runId]);

/** "Tentar de novo" do aviso de republicação (ação `republish_run`). */
export const retryRaceRunRepublish = async (supabaseAdmin: SupabaseClient, actor: SessionUser, eventId: string, input: { runIds?: unknown; runId?: unknown }) => {
  assertDecider(actor);
  const ids = Array.isArray(input.runIds) ? input.runIds : [input.runId];
  const runIds: string[] = [];
  for (const id of ids.slice(0, 200)) runIds.push((await readRun(supabaseAdmin, eventId, id)).id);
  if (runIds.length === 0) throw new RaceSheetError('Informe a corrida.', 400);
  return { republish: await republishAfterDecision(supabaseAdmin, runIds) };
};

const runDto = (run: RaceRunRow) => ({
  id: run.id,
  status: run.status,
  startedAt: run.started_at,
  finishAt: run.finish_at,
  grossSeconds: num(run.gross_seconds),
  penaltySeconds: Number(run.penalty_seconds ?? 0),
  officialSeconds: num(run.official_seconds),
  timeSource: run.time_source
});

// ---------------------------------------------------------------------------
// Penalidades (AC3, AC4, AC6)
// ---------------------------------------------------------------------------

const assertEditablePenalty = (row: RaceInfractionRow) => {
  if (row.status !== 'confirmed' || (row.kind !== 'penalty' && row.kind !== 'warning')) {
    throw new RaceSheetError('Só penalidade ou advertência em vigor pode ser revogada ou alterada.', 409);
  }
};

const infractionState = (row: RaceInfractionRow) => ({ status: row.status, kind: row.kind, seconds: Number(row.seconds), label: row.label });

/** Revogar (AC3): sai da soma, fica `revoked` com `decided_*`; o recálculo do motor não a reativa. */
export const revokeRaceInfraction = async (supabaseAdmin: SupabaseClient, actor: SessionUser, eventId: string, input: { infractionId?: unknown; reason?: unknown }) => {
  assertDecider(actor);
  const reason = readDecisionReason(input.reason);
  const { infraction, run } = await readInfraction(supabaseAdmin, eventId, input.infractionId);
  assertEditablePenalty(infraction);
  const at = decisionTime();
  const updated = await updateInfractionIf(supabaseAdmin, infraction, {
    status: 'revoked', decided_by_user_id: actor.id, decided_by_name: actor.name, decided_at: at, updated_at: at
  });
  const after = await refreshRunTotals(supabaseAdmin, run.id);
  const decision = await insertDecision(supabaseAdmin, actor, {
    eventId, action: 'revoke', reason, runId: run.id, infractionId: infraction.id,
    before: { ...infractionState(infraction), official_seconds: num(run.official_seconds) },
    after: { ...infractionState(updated), official_seconds: num(after.official_seconds) }
  });
  return { decisionId: decision.id, run: runDto(after), republish: await republishAfterDecision(supabaseAdmin, [run.id]) };
};

/** Alterar segundos ou motivo (AC4): segue `confirmed` e ganha o selo "Alterada" pela decisão (D19). */
export const adjustRaceInfraction = async (
  supabaseAdmin: SupabaseClient,
  actor: SessionUser,
  eventId: string,
  input: { infractionId?: unknown; seconds?: unknown; label?: unknown; reason?: unknown }
) => {
  assertDecider(actor);
  const reason = readDecisionReason(input.reason);
  const { infraction, run } = await readInfraction(supabaseAdmin, eventId, input.infractionId);
  assertEditablePenalty(infraction);
  const seconds = input.seconds === undefined || input.seconds === null || input.seconds === '' ? Number(infraction.seconds) : Number(input.seconds);
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > MAX_INFRACTION_SECONDS) throw new RaceSheetError(`Informe os segundos (0 a ${MAX_INFRACTION_SECONDS}).`, 400);
  const label = typeof input.label === 'string' && input.label.trim() ? input.label.trim() : infraction.label;
  if (label.length > 200) throw new RaceSheetError('O motivo da infração passa de 200 caracteres.', 400);
  if (seconds === Number(infraction.seconds) && label === infraction.label) throw new RaceSheetError('Nada mudou: altere os segundos ou o motivo da infração.', 400);
  const at = decisionTime();
  const updated = await updateInfractionIf(supabaseAdmin, infraction, {
    seconds, label, decided_by_user_id: actor.id, decided_by_name: actor.name, decided_at: at, updated_at: at
  });
  const after = await refreshRunTotals(supabaseAdmin, run.id);
  const decision = await insertDecision(supabaseAdmin, actor, {
    eventId, action: 'adjust_infraction', reason, runId: run.id, infractionId: infraction.id,
    before: { ...infractionState(infraction), official_seconds: num(run.official_seconds) },
    after: { ...infractionState(updated), official_seconds: num(after.official_seconds) }
  });
  return { decisionId: decision.id, run: runDto(after), republish: await republishAfterDecision(supabaseAdmin, [run.id]) };
};

type StoredDecision = { id: string; action: string; run_id: string | null; before: unknown; created_at: string };

const readRunDecisions = async (supabaseAdmin: SupabaseClient, runId: string, actions: string[]) => (
  ((check(await supabaseAdmin.from('race_decisions').select('id, action, run_id, before, created_at').eq('run_id', runId)) || []) as StoredDecision[])
    .filter((row) => actions.includes(row.action))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
);

const hasCompleteState = (before: unknown): before is PlainObject => (
  isPlainObject(before) && RACE_RUN_STATE_KEYS.every((key) => Object.hasOwn(before, key))
);

/**
 * Estado restaurado a partir do `before` da decisão de origem: situação, fim,
 * bruto e origem do tempo. O bruto da súmula é refeito pelo fim e pela
 * largada de agora (a largada pode ter sido corrigida no meio, D14a).
 */
const restoredState = (run: RaceRunRow, before: PlainObject) => {
  const status = before.status as RaceRunStatus;
  if (!['racing', 'finished', 'dnf'].includes(status)) throw new RaceSheetError('O estado anterior desta corrida está inválido.', 409);
  const finishAt = typeof before.finish_at === 'string' ? before.finish_at : null;
  const timeSource: RaceRunRow['time_source'] = before.time_source === 'sheet' || before.time_source === 'manual' ? before.time_source : null;
  let gross = num(before.gross_seconds);
  const start = run.started_at ? Date.parse(run.started_at) : Number.NaN;
  const finish = finishAt ? Date.parse(finishAt) : Number.NaN;
  if (timeSource === 'sheet' && Number.isFinite(start) && Number.isFinite(finish) && finish > start) gross = Math.round(finish - start) / 1000;
  if (status === 'finished' && gross === null) throw new RaceSheetError('O estado anterior desta corrida não tem tempo.', 409);
  return { status, finish_at: finishAt, gross_seconds: gross, time_source: timeSource };
};

/**
 * Fecha a corrida restaurada a `racing` se a última estação do percurso já foi
 * liberada (Story 1.101, AC6, D34; Story 1.97, AC7; idempotente). Saída
 * incompleta na última estação não fecha (D44).
 */
const closeIfLastStationReleased = async (supabaseAdmin: SupabaseClient, run: RaceRunRow) => {
  if (run.status !== 'racing') return run;
  const closingStationId = await readRaceClosingStationId(supabaseAdmin, run);
  if (!closingStationId) return run;
  const attempts = (check(await supabaseAdmin.from('race_attempts').select('*').eq('run_id', run.id)) || []) as RaceAttemptRow[];
  const released = attempts.find((row) => row.station_id === closingStationId && row.status === 'released' && row.ended_at);
  if (!released) return run;
  const closed = await closeRaceRunOnRelease(supabaseAdmin, run, released, await readRunInfractions(supabaseAdmin, run.id), closingStationId);
  return closed ?? run;
};

// ---------------------------------------------------------------------------
// Tempo e DNF (AC7, AC8)
// ---------------------------------------------------------------------------

/**
 * Ajustar o tempo bruto (AC7): corrida em andamento ou fechada passa a
 * `finished` com o bruto digitado; fim = largada + bruto; oficial = bruto +
 * penalidades vigentes. O tempo digitado pelo organizador é `manual`.
 */
export const adjustRaceRunTime = async (
  supabaseAdmin: SupabaseClient,
  actor: SessionUser,
  eventId: string,
  input: { runId?: unknown; grossSeconds?: unknown; reason?: unknown }
) => {
  assertDecider(actor);
  const reason = readDecisionReason(input.reason);
  const run = await readRun(supabaseAdmin, eventId, input.runId);
  if (run.status !== 'racing' && run.status !== 'finished') throw new RaceSheetError('Só corrida em andamento ou finalizada tem o tempo ajustado.', 409);
  const gross = Number(input.grossSeconds);
  if (!Number.isFinite(gross) || gross <= 0 || gross > MAX_GROSS_SECONDS) throw new RaceSheetError('Informe o tempo bruto (H:MM:SS).', 400);
  const rounded = Math.round(gross * 1000) / 1000;
  const start = run.started_at ? Date.parse(run.started_at) : Number.NaN;
  const finishAt = Number.isFinite(start) ? new Date(start + rounded * 1000).toISOString() : null;
  const infractions = await readRunInfractions(supabaseAdmin, run.id);
  const after = await updateRunIf(supabaseAdmin, run, {
    status: 'finished', gross_seconds: rounded, finish_at: finishAt, time_source: 'manual', ...runTotals('finished', rounded, infractions), updated_at: decisionTime()
  });
  const decision = await insertDecision(supabaseAdmin, actor, {
    eventId, action: 'adjust_time', reason, runId: run.id, before: runState(run), after: runState(after)
  });
  return { decisionId: decision.id, run: runDto(after), republish: await republishAfterDecision(supabaseAdmin, [run.id]) };
};

/** Marcar DNF (AC8): corrida em andamento ou fechada fica `dnf`, sem tempo oficial. */
export const markRaceRunDnf = async (supabaseAdmin: SupabaseClient, actor: SessionUser, eventId: string, input: { runId?: unknown; reason?: unknown }) => {
  assertDecider(actor);
  const reason = readDecisionReason(input.reason);
  const run = await readRun(supabaseAdmin, eventId, input.runId);
  if (run.status === 'dnf') throw new RaceSheetError('Esta corrida já está como DNF.', 409);
  if (run.status !== 'racing' && run.status !== 'finished') throw new RaceSheetError('Só corrida em andamento ou finalizada pode virar DNF.', 409);
  const after = await updateRunIf(supabaseAdmin, run, {
    status: 'dnf', ...runTotals('dnf', num(run.gross_seconds), await readRunInfractions(supabaseAdmin, run.id)), updated_at: decisionTime()
  });
  const decision = await insertDecision(supabaseAdmin, actor, { eventId, action: 'mark_dnf', reason, runId: run.id, before: runState(run), after: runState(after) });
  return { decisionId: decision.id, run: runDto(after), republish: await republishAfterDecision(supabaseAdmin, [run.id]) };
};

/** Desfazer DNF (AC8): volta ao estado de antes da marcação mais recente, com nova decisão. */
export const unmarkRaceRunDnf = async (supabaseAdmin: SupabaseClient, actor: SessionUser, eventId: string, input: { runId?: unknown; reason?: unknown }) => {
  assertDecider(actor);
  const reason = readDecisionReason(input.reason);
  const run = await readRun(supabaseAdmin, eventId, input.runId);
  if (run.status !== 'dnf') throw new RaceSheetError('Esta corrida não está como DNF.', 409);
  const origin = (await readRunDecisions(supabaseAdmin, run.id, ['mark_dnf'])).find((row) => isPlainObject(row.before) && row.before.status !== 'dnf');
  if (!origin || !hasCompleteState(origin.before)) throw new RaceSheetError('Não há o estado anterior deste DNF para restaurar.', 409);
  const restored = restoredState(run, origin.before);
  let after = await updateRunIf(supabaseAdmin, run, {
    ...restored, ...runTotals(restored.status, restored.gross_seconds, await readRunInfractions(supabaseAdmin, run.id)), updated_at: decisionTime()
  });
  const decision = await insertDecision(supabaseAdmin, actor, {
    eventId, action: 'unmark_dnf', reason, runId: run.id, before: runState(run), after: { ...runState(after), source_decision_id: origin.id }
  });
  after = await closeIfLastStationReleased(supabaseAdmin, after);
  return { decisionId: decision.id, run: runDto(after), republish: await republishAfterDecision(supabaseAdmin, [run.id]) };
};

// ---------------------------------------------------------------------------
// Correção da largada da onda (Story 1.96, AC7, D14a)
// ---------------------------------------------------------------------------

const zonedParts = (ms: number, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
};

const zoneOffsetMs = (ms: number, timeZone: string) => {
  const p = zonedParts(ms, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
};

/**
 * Horário HH:MM:SS digitado no fuso do evento, no mesmo dia (do fuso) da
 * largada registrada, como instante UTC.
 */
export const raceClockOnSameDay = (referenceIso: string, clock: string, timeZone: string) => {
  const match = clock.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
  const reference = Date.parse(referenceIso);
  if (!match || !Number.isFinite(reference)) return null;
  const day = zonedParts(reference, timeZone);
  const guess = Date.UTC(day.year, day.month - 1, day.day, Number(match[1]), Number(match[2]), Number(match[3] ?? 0));
  let result = guess - zoneOffsetMs(guess, timeZone);
  const second = guess - zoneOffsetMs(result, timeZone);
  if (second !== result) result = second;
  return new Date(result).toISOString();
};

type HeatMark = { event_id: string; heat_id: string; started_at: string };

/**
 * Corrige a largada da onda inteira: grava `race_heat_marks.started_at` e o
 * `started_at` de todas as corridas da onda juntos, recalcula o bruto das
 * corridas fechadas pela súmula (fim - largada nova) e o oficial, grava a
 * decisão e chama o ponto único de republicação para cada corrida finalizada.
 * Tempo lançado à mão pelo organizador mantém o bruto (a decisão dele não é
 * desfeita) e só o fim acompanha a largada.
 */
export const adjustRaceHeatStart = async (
  supabaseAdmin: SupabaseClient,
  actor: SessionUser,
  eventId: string,
  input: { heatId?: unknown; clock?: unknown; reason?: unknown }
) => {
  assertDecider(actor);
  const reason = readDecisionReason(input.reason);
  const heatId = typeof input.heatId === 'string' ? input.heatId.trim() : '';
  if (!heatId) throw new RaceSheetError('Informe a onda.', 400);
  const event = check(await supabaseAdmin.from('events').select('id, event_schedule, time_zone').eq('id', eventId).maybeSingle()) as { id: string; event_schedule?: unknown; time_zone?: string | null } | null;
  if (!event) throw new RaceSheetError('Evento não encontrado.', 404);
  if (!findRaceHeatItem(event.event_schedule, heatId)) throw new RaceSheetError('Onda não encontrada no cronograma do evento.', 404);
  const mark = check(await supabaseAdmin.from('race_heat_marks').select('*').eq('event_id', eventId).eq('heat_id', heatId).maybeSingle()) as HeatMark | null;
  if (!mark) throw new RaceSheetError('Esta onda ainda não largou.', 409);
  const timeZone = event.time_zone || RACE_DEFAULT_TIME_ZONE;
  const startedAt = typeof input.clock === 'string' ? raceClockOnSameDay(mark.started_at, input.clock, timeZone) : null;
  if (!startedAt) throw new RaceSheetError('Informe o horário correto da largada (HH:MM:SS).', 400);
  const newStart = Date.parse(startedAt);
  if (newStart > Date.now() + 5000) throw new RaceSheetError('A largada não pode ficar no futuro.', 400);

  const runs = ((check(await supabaseAdmin.from('race_runs').select('*').eq('event_id', eventId).eq('heat_id', heatId)) || []) as RaceRunRow[])
    .filter((row) => row.status !== 'cancelled');
  const sheetClosed = runs.filter((row) => row.time_source === 'sheet' && row.finish_at);
  const invalid = sheetClosed.filter((row) => Date.parse(row.finish_at as string) <= newStart);
  if (invalid.length) {
    throw new RaceSheetError(`A largada nova fica depois do fim de ${invalid.length} ${invalid.length === 1 ? 'corrida' : 'corridas'} da onda.`, 400);
  }
  // REL-002: repetir o mesmo horário refaz só as corridas que ainda não estão com ele;
  // o 400 fica para quando a marca e todas as corridas da onda já estão certas.
  const pending = runs.filter((row) => heatStartPatch(row, startedAt, newStart));
  if (newStart === Date.parse(mark.started_at) && !pending.length) throw new RaceSheetError('Este já é o horário da largada.', 400);

  // Corridas primeiro, marca depois: se algo falhar no meio, a marca segue antiga e repetir converge.
  const recalculated: { id: string; before: number | null; after: number | null }[] = [];
  const finished: string[] = [];
  for (const original of pending) {
    let run: RaceRunRow | null = original;
    for (let attempt = 0; run; attempt += 1) {
      const base = heatStartPatch(run, startedAt, newStart);
      if (!base) break;
      const patch: Partial<RaceRunRow> & { updated_at: string } = { ...base, updated_at: decisionTime() };
      if (patch.gross_seconds !== undefined) {
        // A corrida pode ter fechado no meio, com o fim antes da largada nova.
        if ((patch.gross_seconds as number) <= 0) throw new RaceSheetError('A largada nova fica depois do fim de 1 corrida da onda.', 400);
        Object.assign(patch, runTotals(run.status, patch.gross_seconds as number, await readRunInfractions(supabaseAdmin, run.id)));
      }
      try {
        const updated = await updateRunIf(supabaseAdmin, run, patch);
        if (patch.gross_seconds !== undefined) {
          recalculated.push({ id: run.id, before: num(original.gross_seconds), after: num(updated.gross_seconds) });
          if (updated.status === 'finished') finished.push(run.id);
        }
        break;
      } catch (error) {
        // A corrida mudou no meio (ex.: o árbitro liberou o atleta e ela fechou): relê e refaz do estado novo.
        if (!(error instanceof RaceSheetError) || error.status !== 409 || attempt >= 2) throw error;
        run = check(await supabaseAdmin.from('race_runs').select('*').eq('id', run.id).maybeSingle()) as RaceRunRow | null;
        if (run?.status === 'cancelled') run = null;
      }
    }
  }
  if (newStart !== Date.parse(mark.started_at)) {
    check(await supabaseAdmin.from('race_heat_marks').update({ started_at: startedAt, updated_at: decisionTime() }).eq('event_id', eventId).eq('heat_id', heatId));
  }
  const decision = await insertDecision(supabaseAdmin, actor, {
    eventId, action: 'adjust_heat_start', reason, heatId,
    before: { started_at: mark.started_at },
    after: { started_at: startedAt, runs: runs.length, recalculated }
  });
  return {
    decisionId: decision.id,
    heatId,
    startedAt,
    runsUpdated: pending.length,
    recalculated: recalculated.length,
    republish: await republishAfterDecision(supabaseAdmin, finished)
  };
};

/**
 * O que a corrida precisa mudar para ficar com a largada nova (nulo = já está):
 * a largada; o bruto da súmula (fim - largada) ou, no tempo lançado à mão, o
 * fim (largada + bruto, o bruto do organizador não muda).
 */
const heatStartPatch = (run: RaceRunRow, startedAt: string, newStart: number): Partial<RaceRunRow> | null => {
  const patch: Partial<RaceRunRow> = {};
  if (!run.started_at || Date.parse(run.started_at) !== newStart) patch.started_at = startedAt;
  if (run.time_source === 'sheet' && run.finish_at) {
    const gross = Math.round(Date.parse(run.finish_at) - newStart) / 1000;
    if (num(run.gross_seconds) !== gross || patch.started_at) patch.gross_seconds = gross;
  } else if (run.time_source === 'manual' && run.gross_seconds !== null && run.gross_seconds !== undefined) {
    const finishAt = new Date(newStart + Number(run.gross_seconds) * 1000).toISOString();
    if (!run.finish_at || Date.parse(run.finish_at) !== Date.parse(finishAt) || patch.started_at) patch.finish_at = finishAt;
  }
  if (!Object.keys(patch).length) return null;
  patch.started_at = startedAt;
  return patch;
};

// ---------------------------------------------------------------------------
// Leitura do painel (GET view=manage)
// ---------------------------------------------------------------------------

type DivisionRow = { id: string; name?: string };
type AthleteRow = { id: string; name?: string; box?: string; division_id: string };
type DecisionRow = {
  id: string; run_id: string | null; infraction_id: string | null; heat_id: string | null; action: string;
  actor_name: string; reason: string | null; before: unknown; after: unknown; created_at: string;
};

const stationNameOf = (ruleset: RaceRulesetRow | undefined, divisionId: string | null, stationId: string | null) => {
  if (!stationId) return 'Geral';
  const stages = ruleset && divisionId && isPlainObject(ruleset.course) ? (ruleset.course as PlainObject)[divisionId] : null;
  const stage = Array.isArray(stages) ? stages.find((item) => isPlainObject(item) && item.id === stationId) as PlainObject | undefined : undefined;
  return typeof stage?.name === 'string' ? stage.name : stationId;
};

const authorOf = (row: RaceInfractionRow) => row.created_by_name || (row.origin === 'engine' ? 'Motor' : row.origin === 'manager' ? 'Organizador' : 'Árbitro');

/**
 * Painel do organizador (AC1, AC2, AC9, AC10): corridas, penalidades (com o
 * selo "Alterada" derivado das decisões, D19), decisões, a estação que fecha o
 * tempo de cada corrida com a tentativa dela (Story 1.101, AC7, D34: estado,
 * reps ou trechos, árbitro, a marca "Atleta saiu" do tipo reps, D24, e a saída
 * incompleta de trenó ou seções, D44) e o regulamento vigente. Só para o
 * gestor dono ou o owner; nada daqui vai para o bootstrap público.
 */
export const readRaceManageBoard = async (supabaseAdmin: SupabaseClient, eventId: string) => {
  const event = check(await supabaseAdmin.from('events').select('id, name, event_schedule, time_zone').eq('id', eventId).maybeSingle()) as { id: string; name?: string; event_schedule?: unknown; time_zone?: string | null } | null;
  if (!event) throw new RaceSheetError('Evento não encontrado.', 404);
  const timeZone = event.time_zone || RACE_DEFAULT_TIME_ZONE;
  const divisions = (check(await supabaseAdmin.from('divisions').select('id, name').eq('event_id', eventId)) || []) as DivisionRow[];
  const divisionName = new Map(divisions.map((row) => [row.id, row.name ?? '']));
  const [athletesResult, runsResult, attemptsResult, rulesetsResult, decisionsResult] = await Promise.all([
    divisions.length ? supabaseAdmin.from('athletes').select('id, name, box, division_id').in('division_id', divisions.map((row) => row.id)) : Promise.resolve({ data: [], error: null }),
    supabaseAdmin.from('race_runs').select('*').eq('event_id', eventId),
    supabaseAdmin.from('race_attempts').select('*').eq('event_id', eventId),
    supabaseAdmin.from('race_rulesets').select('*').eq('event_id', eventId),
    supabaseAdmin.from('race_decisions').select('id, run_id, infraction_id, heat_id, action, actor_name, reason, before, after, created_at').eq('event_id', eventId)
  ]);
  const athletes = new Map(((check(athletesResult) || []) as AthleteRow[]).map((row) => [row.id, row]));
  const runs = ((check(runsResult) || []) as RaceRunRow[]).filter((row) => row.status !== 'cancelled');
  const attempts = ((check(attemptsResult) || []) as RaceAttemptRow[]).filter((row) => row.status !== 'cancelled');
  const rulesets = ((check(rulesetsResult) || []) as RaceRulesetRow[]).sort((a, b) => b.version - a.version);
  const rulesetById = new Map(rulesets.map((row) => [row.id, row]));
  const decisions: RaceManageDecision[] = ((check(decisionsResult) || []) as DecisionRow[])
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((row) => ({
      id: row.id, runId: row.run_id, infractionId: row.infraction_id, heatId: row.heat_id, action: row.action, actorName: row.actor_name,
      reason: row.reason, before: isPlainObject(row.before) ? row.before : null, after: isPlainObject(row.after) ? row.after : null, createdAt: row.created_at
    }));
  const infractions = runs.length
    ? ((check(await supabaseAdmin.from('race_infractions').select('*').in('run_id', runs.map((row) => row.id))) || []) as RaceInfractionRow[])
    : [];

  const heatTitle = new Map(readRaceHeatItems(event.event_schedule).map((item) => [item.id, raceWaveTitle(item)]));
  const runById = new Map(runs.map((row) => [row.id, row]));

  const runDivision = (run: RaceRunRow) => run.division_id ?? athletes.get(run.athlete_id)?.division_id ?? null;

  // Estação que fecha o tempo de cada corrida (AC7, D34) e a tentativa dela.
  // Saída registrada no tipo reps (D24): horário do evento `abandon` ativo,
  // corrigido pelo desvio; saída incompleta de trenó ou seções (D44): o fim da tentativa.
  const closingByRun = new Map<string, RaceClosingStationSnapshot>();
  for (const run of runs) {
    const ruleset = rulesetById.get(run.ruleset_id);
    const divisionId = runDivision(run);
    const stored = ruleset && divisionId && isPlainObject(ruleset.course) ? (ruleset.course as PlainObject)[divisionId] : null;
    const stages = Array.isArray(stored)
      ? stored.filter((item): item is { id: string; name?: unknown; type: 'run' | 'station'; orderIndex?: unknown; kind?: unknown; reps?: unknown; expectedUnits?: unknown } => (
        isPlainObject(item) && typeof item.id === 'string' && (item.type === 'run' || item.type === 'station')
      ))
      : [];
    const station = lastRaceStation(stages);
    if (!station) continue;
    const kind = typeof station.kind === 'string' ? station.kind : 'generic';
    const attempt = attempts.find((row) => row.run_id === run.id && row.station_id === station.id) ?? null;
    const progress = (attempt?.progress || {}) as PlainObject;
    const abandoned = kind === 'wall_ball' && progress.abandoned === true && typeof progress.abandonSeq === 'number';
    let abandonAt: string | null = null;
    if (attempt && abandoned && run.status === 'racing') {
      const event = check(await supabaseAdmin.from('race_attempt_events').select('device_at, clock_offset_ms, recorded_at').eq('attempt_id', attempt.id).eq('seq', progress.abandonSeq as number).maybeSingle()) as { device_at: string | null; clock_offset_ms: number | string | null; recorded_at: string | null } | null;
      abandonAt = event ? resolveEventTime({ deviceAt: event.device_at, clockOffsetMs: event.clock_offset_ms, serverAt: event.recorded_at }) : null;
    }
    const numberOr = (value: unknown, fallback: number | null) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
    closingByRun.set(run.id, {
      stationName: typeof station.name === 'string' && station.name ? station.name : station.id,
      kind,
      status: attempt?.status ?? null,
      validReps: numberOr(progress.validReps, 0) as number,
      targetReps: numberOr(progress.targetReps, numberOr(station.reps, null)),
      units: numberOr(progress.units, 0) as number,
      expectedUnits: numberOr(progress.expectedUnits, numberOr(station.expectedUnits, null)),
      abandoned,
      abandonAt,
      exitAt: attempt?.status === 'exited_incomplete' ? attempt.ended_at : null,
      judgeName: attempt?.judge_name || ''
    });
  }

  const penalties: RaceManagePenalty[] = infractions.flatMap((row) => {
    const run = runById.get(row.run_id);
    if (!run) return [];
    const divisionId = runDivision(run);
    return [{
      id: row.id,
      runId: row.run_id,
      athleteName: athletes.get(run.athlete_id)?.name ?? '',
      divisionId,
      divisionName: divisionId ? divisionName.get(divisionId) ?? '' : '',
      stationName: row.general && !row.station_id ? 'Geral' : stationNameOf(rulesetById.get(run.ruleset_id), divisionId, row.station_id),
      label: row.label,
      note: row.note ?? null,
      kind: row.kind,
      seconds: Number(row.seconds),
      status: row.status,
      origin: row.origin,
      createdByName: authorOf(row),
      createdAt: row.created_at,
      altered: isRaceInfractionAltered(row.id, decisions),
      originalSeconds: originalRaceInfractionSeconds(row.id, decisions)
    }];
  });

  const current = rulesets[0] ?? null;
  return {
    event: { id: event.id, name: event.name ?? '', timeZone },
    divisions: divisions.map((row) => ({ id: row.id, name: row.name ?? '' })),
    runs: runs.map((run) => {
      const athlete = athletes.get(run.athlete_id);
      const divisionId = runDivision(run);
      return {
        ...runDto(run),
        athleteId: run.athlete_id,
        athleteName: athlete?.name ?? '',
        box: athlete?.box ?? '',
        divisionId,
        divisionName: divisionId ? divisionName.get(divisionId) ?? '' : '',
        heatId: run.heat_id,
        heatTitle: run.heat_id ? heatTitle.get(run.heat_id) ?? '' : '',
        closingStation: closingByRun.get(run.id) ?? null
      };
    }).sort((a, b) => a.athleteName.localeCompare(b.athleteName, 'pt-BR')),
    penalties,
    decisions,
    ruleset: current ? {
      id: current.id,
      version: current.version,
      preset: current.preset,
      name: current.name,
      verified: Boolean(current.rules?.verified),
      lockedAt: current.locked_at,
      used: Boolean(current.locked_at) || runs.some((run) => run.ruleset_id === current.id),
      general: (Array.isArray(current.rules?.general) ? current.rules.general : []).map((item) => ({ code: item.code, label: item.label, seconds: Number(item.seconds) }))
    } : null
  };
};
