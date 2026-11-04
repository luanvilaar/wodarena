// Semeador do banco em memória para o telão do Fitness Race (Story 1.112): converte
// o cenário de referência da maquete (tests/support/raceBroadcastScenario.mjs, em
// chaves) em linhas reais de events, divisions, athletes, scores, leaderboard_entries,
// workouts, event_broadcasts e race_* (com ids). De propósito, as linhas trazem dado
// que NUNCA pode sair no payload do telão (e-mail, telefone, nascimento, nome de
// judge, motivo e nota da infração), para o teste de privacidade ter o que procurar.

import { createHash } from 'node:crypto';

import { BASE_MS, buildReferenceInput, iso, stageList } from './raceBroadcastScenario.mjs';

export const EVENT_ID = 'ev-race-telao';
/** Token do link do telão (24 a 64 caracteres de [A-Za-z0-9_-]); o banco guarda só o hash. */
export const TOKEN = 'Rt'.repeat(16);
export const tokenHash = (token = TOKEN) => createHash('sha256').update(token).digest('hex');

export const MANAGER = { id: 'mgr-race-telao', name: 'Gestora Telão Race', email: 'gestora.telao@example.com', role: 'manager', service_valid_until: '2099-12-31' };
export const SECRETS = {
  email: 'segredo.rafael@example.com',
  phone: '85988887777',
  birth: '1990-04-23',
  instagram: '@rafael.segredo',
  city: 'Cidade Sigilosa',
  judge: 'Judge Paula Sigilo',
  reason: 'Invadiu a raia vizinha',
  note: 'Observação sigilosa do árbitro',
  member: 'Parceira Sigilosa'
};

export const athleteId = (key) => `ath-${key}`;
export const runId = (key) => `run-${key}`;
export const attemptId = (key, stationId) => `att-${key}-${stationId}`;
export const workoutId = (divisionId) => `wod-${divisionId}-total`;

const EXTRAS = {
  'sled-push': { maleWeight: '152kg', femaleWeight: '102kg' },
  'sled-pull': { maleWeight: '103kg', femaleWeight: '78kg' },
  'farmers-carry': { maleWeight: '2x24kg', femaleWeight: '2x16kg' },
  'sandbag-lunges': { maleWeight: '20kg', femaleWeight: '10kg' },
  'wall-balls': { maleWeight: '9kg', femaleWeight: '6kg' }
};

const KIND = { ergometer: 'ergometer', sled: 'sled', sections: 'sections', reps: 'wall_ball', generic: 'generic' };

/** Percurso no formato do snapshot do regulamento (tipo e meta já resolvidos), com as cargas por naipe. */
export const snapshotStages = () => stageList().map((stage) => {
  const isStation = stage.type === 'station';
  const expectedUnits = stage.units ?? (stage.conferenceKind === 'sled' ? 4 : undefined);
  return {
    id: stage.id,
    name: stage.name,
    type: stage.type,
    orderIndex: stage.orderIndex,
    ...(stage.distance ? { distance: stage.distance } : {}),
    ...(stage.reps ? { reps: stage.reps } : {}),
    ...(EXTRAS[stage.id] ?? {}),
    kind: isStation ? KIND[stage.conferenceKind] : 'generic',
    ...(isStation && expectedUnits !== undefined ? { expectedUnits } : {})
  };
});

const divisionRow = (id, name, order, category) => ({ id, event_id: EVENT_ID, name, order_index: order, category, type: 'individual', course_layout: stageList() });

/**
 * Banco da onda 3 aos `seconds` segundos da largada (o motor lê o resto). Devolve `seed`
 * (para createFakeSupabase), a entrada equivalente do motor e os atalhos de ids.
 * `athletePatch[chave]` troca colunas do atleta; `extra` acrescenta linhas por tabela;
 * `snapshot: false` deixa o regulamento sem percurso (a leitura cai no da categoria).
 * `input` troca o cenário de referência por outra entrada do motor (por exemplo, o do ranking
 * único, tests/support/raceRankingScenario.mjs), com as mesmas categorias e o mesmo percurso.
 */
export const seedRaceDatabase = ({ seconds, withResults = true, athletePatch = {}, extra = {}, mode = 'auto', pinnedHeat = null, pinnedDivision = null, snapshot = true, schedule, input: givenInput } = {}) => {
  const input = givenInput ?? buildReferenceInput({ seconds, withResults });
  const keyOf = new Map(input.athletes.map((athlete) => [athlete.key, athlete]));

  const athletes = input.athletes.map((athlete) => ({
    id: athleteId(athlete.key),
    name: athlete.name,
    box: athlete.box,
    division_id: athlete.divisionKey,
    is_team: false,
    email: `${athlete.key}@exemplo.test`,
    phone: '85900000000',
    birth_date: SECRETS.birth,
    instagram: SECRETS.instagram,
    city: SECRETS.city,
    team_members: [{ name: SECRETS.member }],
    ...(athletePatch[athlete.key] ?? {})
  }));

  const heatItems = schedule ?? input.waves.map((wave) => ({
    id: wave.key,
    kind: 'heat',
    workoutId: '',
    heatNumber: wave.heatNumber,
    date: wave.date,
    time: wave.time,
    title: '',
    athleteIds: wave.athleteKeys.map(athleteId)
  }));

  const stages = snapshotStages();
  const rulesets = [{
    id: 'rs-race-1',
    event_id: EVENT_ID,
    version: 1,
    preset: '2026_27',
    name: 'Fitness Race 2026/27',
    rules: { stations: {}, wallBall: {}, general: [] },
    course: snapshot ? { 'open-m': stages, 'open-f': stages } : {},
    locked_at: snapshot ? iso(-8000) : null
  }];

  const runs = input.runs.map((run) => {
    const official = run.officialSeconds;
    return {
      id: runId(run.athleteKey),
      event_id: EVENT_ID,
      division_id: keyOf.get(run.athleteKey).divisionKey,
      athlete_id: athleteId(run.athleteKey),
      heat_id: run.waveKey,
      ruleset_id: 'rs-race-1',
      status: run.status,
      started_at: run.startedAt ?? iso(0),
      finish_at: run.finishAt,
      gross_seconds: official,
      penalty_seconds: 0,
      official_seconds: official,
      time_source: run.timeSource,
      created_at: iso(0),
      updated_at: iso(seconds)
    };
  });

  const stationKind = new Map(stages.map((stage) => [stage.id, stage.kind]));
  const attempts = input.attempts.map((attempt) => ({
    id: attemptId(attempt.athleteKey, attempt.stationId),
    run_id: runId(attempt.athleteKey),
    event_id: EVENT_ID,
    athlete_id: athleteId(attempt.athleteKey),
    station_id: attempt.stationId,
    station_kind: stationKind.get(attempt.stationId),
    lane: 3,
    judge_user_id: 'judge-race-1',
    judge_name: SECRETS.judge,
    status: attempt.status,
    progress: { units: attempt.units, expectedUnits: attempt.expectedUnits, validReps: attempt.validReps, targetReps: attempt.targetReps },
    started_at: attempt.startedAt,
    ended_at: attempt.endedAt,
    created_at: attempt.startedAt,
    updated_at: attempt.startedAt
  }));

  const infractions = input.penalties.map((penalty, index) => ({
    id: `inf-${index}`,
    run_id: runId(penalty.athleteKey),
    attempt_id: attemptId(penalty.athleteKey, penalty.stationId),
    station_id: penalty.stationId,
    source_key: `${penalty.stationId}|1|wrong_lane`,
    code: 'wrong_lane',
    label: SECRETS.reason,
    kind: 'penalty',
    seconds: penalty.seconds,
    status: 'confirmed',
    origin: 'engine',
    general: false,
    note: SECRETS.note,
    created_by_user_id: 'judge-race-1',
    created_by_name: SECRETS.judge,
    created_at: penalty.at,
    updated_at: penalty.at
  }));
  // Linhas que não são penalidade vigente e nunca entram: advertência e penalidade revogada.
  if (runs.some((run) => run.athlete_id === athleteId('rafael'))) {
    infractions.push(
      { id: 'inf-warn', run_id: runId('rafael'), station_id: 'ski-erg', source_key: 'ski-erg|1|warn', code: 'feet', label: SECRETS.reason, kind: 'warning', seconds: 0, status: 'confirmed', origin: 'engine', general: false, note: null, created_at: iso(300), updated_at: iso(300) },
      { id: 'inf-revoked', run_id: runId('rafael'), station_id: 'sled-push', source_key: 'sled-push|1|revoked', code: 'lane', label: SECRETS.reason, kind: 'penalty', seconds: 15, status: 'revoked', origin: 'engine', general: false, note: SECRETS.note, created_at: iso(800), updated_at: iso(800) }
    );
  }

  const decisions = input.runs
    .filter((run) => run.status === 'dnf')
    .map((run) => ({
      id: `dec-${run.athleteKey}`,
      event_id: EVENT_ID,
      run_id: runId(run.athleteKey),
      heat_id: run.waveKey,
      action: 'mark_dnf',
      actor_user_id: MANAGER.id,
      actor_name: MANAGER.name,
      actor_role: 'manager',
      reason: SECRETS.reason,
      created_at: run.dnfAt
    }));

  const scores = input.results.map((result) => {
    const row = {
      athlete_id: athleteId(result.athleteKey),
      workout_id: workoutId(result.divisionKey),
      result: result.resultStatus === 'dnf' ? 'DNF' : `${Math.floor(result.value / 60)}:${String(result.value % 60).padStart(2, '0')}`,
      value: result.value,
      rank: null,
      points: null,
      splits: result.splits,
      result_status: result.resultStatus
    };
    return row;
  });

  const seed = {
    users: [MANAGER],
    events: [{
      id: EVENT_ID,
      name: 'Fitness Race Fortaleza',
      date: '2026-11-14',
      organizer_id: MANAGER.id,
      event_type: 'fitness_racing',
      status: 'upcoming',
      logo_url: 'https://exemplo.test/logo.png',
      time_zone: 'America/Fortaleza',
      event_schedule: heatItems
    }],
    divisions: [divisionRow('open-m', 'Open Masculino', 1, 'male'), divisionRow('open-f', 'Open Feminino', 2, 'female')],
    athletes,
    leaderboard_entries: athletes.map((athlete) => ({ id: `le-${athlete.id}`, event_id: EVENT_ID, division_id: athlete.division_id, athlete_id: athlete.id })),
    workouts: ['open-m', 'open-f'].map((id) => ({ id: workoutId(id), event_id: EVENT_ID, name: 'Percurso Completo', code: 'TOTAL', order_index: 1, type: 'fortime', division_id: id })),
    scores,
    event_broadcasts: [{
      event_id: EVENT_ID,
      token_hash: tokenHash(),
      token_created_at: iso(-9000),
      token_revoked_at: null,
      mode,
      pinned_heat_id: pinnedHeat,
      pinned_division_id: pinnedDivision,
      updated_at: iso(-9000)
    }],
    race_rulesets: rulesets,
    race_heat_marks: input.waves.filter((wave) => wave.startedAt).map((wave) => ({ event_id: EVENT_ID, heat_id: wave.key, started_at: wave.startedAt })),
    race_runs: runs,
    race_attempts: attempts,
    race_infractions: infractions,
    race_decisions: decisions,
    race_attempt_events: []
  };
  for (const [table, rows] of Object.entries(extra)) seed[table] = [...(seed[table] ?? []), ...rows];
  return { seed, input, nowMs: input.nowMs, baseMs: BASE_MS };
};
