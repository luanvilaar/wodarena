import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { createRaceClient } from './support/fakeRaceSupabase.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Story 1.100 (F2 da súmula Fitness Race): estrutura da prova. Cada estação do
// percurso ganha tipo de conferência (sugerido pelo nome, ajustável) e meta
// (trechos, voltas, reps); o snapshot por categoria carrega o que o
// organizador definiu (D33, D6). Percurso sem os campos se comporta como antes.

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-estrutura-race';

let database = createFakeSupabase();
const state = { missingRaceTables: false, beforeUpdate: {}, beforeCount: {} };
const client = createRaceClient(() => database, state);
setActiveSupabaseClient(client);

const structure = await importServerModule('lib/raceCourseStructure.ts');
const race = await importServerModule('lib/serverRaceSheets.ts');
const { POST: postRace } = await importServerModule('app/api/race-sheets/route.ts');
const { POST: postSheets } = await importServerModule('app/api/sheets/route.ts');
const { createSessionToken } = await importServerModule('lib/serverSecurity.ts');
const { PUBLIC_DIVISION_SELECT } = await importServerModule('lib/bootstrapPayload.ts');
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const MANAGER = { id: 'mgr-estrutura', name: 'Gestora Estrutura', email: 'estrutura@example.com', role: 'manager', service_valid_until: '2099-12-31' };
const JUDGE = { id: 'judge-estrutura', name: 'Judge Estrutura', email: 'judge-estrutura@example.com', role: 'judge', parent_manager_id: MANAGER.id };
const EVENT = 'ev-estrutura';

// O mesmo percurso do teste do snapshot da 1.94 (race-sheets-route.test.mjs).
const OFFICIAL = [
  { id: 'run-1', name: 'Corrida 1', type: 'run', orderIndex: 0, distance: '1km' },
  { id: 'sled-push', name: 'Sled Push', type: 'station', orderIndex: 1, distance: '50m', maleWeight: '152kg', femaleWeight: '102kg' },
  { id: 'run-2', name: 'Corrida 2', type: 'run', orderIndex: 2, distance: '1km' },
  { id: 'wall-balls', name: 'Wall Balls', type: 'station', orderIndex: 3, reps: 100, maleWeight: '9kg', femaleWeight: '6kg' }
];

// Percurso personalizado: estação fora da biblioteca ajustada à mão para reps.
const CUSTOM = [
  { id: 'run-1', name: 'Run 1', type: 'run', orderIndex: 1, distance: '800m', conferenceKind: 'sled', units: 9 },
  { id: 'stage-course-kettlebell-swing-1', name: 'Kettlebell Swing', type: 'station', orderIndex: 2, reps: 50, conferenceKind: 'reps' },
  { id: 'stage-course-tire-flip-2', name: 'Tire Flip', type: 'station', orderIndex: 3, distance: '40m', conferenceKind: 'sections', units: 8 }
];

const seed = () => {
  database = createFakeSupabase({
    users: [MANAGER, JUDGE],
    events: [
      { id: EVENT, name: 'Race Estrutura', date: '2026-11-01', location: 'Recife', organizer_id: MANAGER.id, event_type: 'fitness_racing', status: 'upcoming', event_schedule: [] }
    ],
    event_judges: [{ event_id: EVENT, judge_user_id: JUDGE.id }],
    divisions: [
      { id: 'div-oficial', event_id: EVENT, name: 'Open', course_layout: OFFICIAL },
      { id: 'div-custom', event_id: EVENT, name: 'Iniciante', course_layout: CUSTOM }
    ],
    athletes: [
      { id: 'ath-oficial', name: 'Caio Reis', box: 'Tropa Fit', division_id: 'div-oficial' },
      { id: 'ath-custom', name: 'Ana Souza', box: 'Litoral', division_id: 'div-custom' }
    ],
    workouts: [],
    scores: [],
    registrations: []
  });
  state.missingRaceTables = false;
  state.beforeUpdate = {};
  state.beforeCount = {};
};

const cookie = (user) => `woda_session=${createSessionToken({ id: user.id, name: user.name, email: user.email, role: user.role })}`;
const post = async (route, user, body) => {
  const response = await route(new Request('http://localhost/api/x', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie(user) }, body: JSON.stringify(body)
  }));
  return { status: response.status, body: await response.json() };
};
const quiet = (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
};

const startRun = async (athleteId, divisionId) => {
  const ruleset = await race.ensureRaceRuleset(client, EVENT);
  database.rows('race_runs').push({
    id: `run-${athleteId}`, event_id: EVENT, division_id: divisionId, athlete_id: athleteId, heat_id: 'heat-1', ruleset_id: ruleset.id,
    status: 'racing', started_at: '2026-11-01T10:00:00.000Z', finish_at: null, gross_seconds: null, penalty_seconds: 0, official_seconds: null,
    time_source: null, created_at: '2026-11-01T10:00:00.000Z', updated_at: '2026-11-01T10:00:00.000Z'
  });
  return ruleset;
};

const station = (id, name, extra = {}) => ({ id, name, type: 'station', orderIndex: 1, ...extra });

// ---------------------------------------------------------------------------
// Sugestão por nome, rótulos e tradução (AC2)
// ---------------------------------------------------------------------------

test('raceCourseStructure é puro: sem React, Supabase ou fetch', () => {
  const source = read('../src/lib/raceCourseStructure.ts');
  const imports = source.match(/^import .+$/gm) ?? [];
  assert.deepEqual(imports.filter((line) => !/from '@\/lib\/raceRules'|from '@\/types'/.test(line)), []);
  assert.doesNotMatch(source, /\bfetch\(|createClient|from 'react'|@supabase/);
});

test('suggestRaceConferenceKind: os 8 nomes da biblioteca (por nome e por id), o resto genérico, corrida sem tipo', () => {
  const suggest = (id, name, type = 'station') => structure.suggestRaceConferenceKind({ id, name, type });
  assert.equal(suggest('', 'Ski Erg'), 'ergometer');
  assert.equal(suggest('', 'Row'), 'ergometer');
  assert.equal(suggest('', 'Sled Push'), 'sled');
  assert.equal(suggest('', 'Sled Pull'), 'sled');
  assert.equal(suggest('', 'Burpee Broad Jump'), 'sections');
  assert.equal(suggest('', 'Farmers Carry'), 'sections');
  assert.equal(suggest('', 'Sandbag Lunges'), 'sections');
  assert.equal(suggest('', 'Wall Balls'), 'reps');
  assert.equal(suggest('wall-balls', 'Arremesso'), 'reps', 'pelo id da biblioteca');
  assert.equal(suggest('stage-course-wall-ball-1', 'Wall Ball'), 'generic', 'singular não é reconhecido (D33)');
  assert.equal(suggest('stage-course-x', 'Kettlebell Swing'), 'generic');
  assert.equal(suggest('run-1', 'Run 1', 'run'), null);
});

test('rótulos em português e tradução reps ↔ wall_ball', () => {
  assert.deepEqual([...structure.RACE_CONFERENCE_KINDS], ['ergometer', 'sled', 'sections', 'reps', 'generic']);
  assert.deepEqual(structure.RACE_CONFERENCE_KIND_LABELS, { ergometer: 'Ergômetro', sled: 'Trenó', sections: 'Seções', reps: 'Reps', generic: 'Genérica' });
  assert.equal(structure.toEngineStationKind('reps'), 'wall_ball');
  assert.equal(structure.toEngineStationKind('sled'), 'sled');
  assert.equal(structure.toRaceConferenceKind('wall_ball'), 'reps');
  assert.equal(structure.toRaceConferenceKind('generic'), 'generic');
  assert.equal(structure.parseRaceStageUnits(1), 1);
  assert.equal(structure.parseRaceStageUnits(200), 200);
  for (const bad of [0, 201, 2.5, -3, '4', null, undefined, Number.NaN]) assert.equal(structure.parseRaceStageUnits(bad), undefined, String(bad));
});

// ---------------------------------------------------------------------------
// Snapshot: tipo e meta (AC5)
// ---------------------------------------------------------------------------

test('toRaceSnapshotStages: percurso sem os campos fica idêntico ao de hoje (Sled 50 m = 4 trechos, Wall Balls 100 reps)', () => {
  const stages = race.toRaceSnapshotStages(OFFICIAL);
  assert.deepEqual(stages, [
    { id: 'run-1', name: 'Corrida 1', type: 'run', orderIndex: 0, distance: '1km', kind: 'generic' },
    { id: 'sled-push', name: 'Sled Push', type: 'station', orderIndex: 1, distance: '50m', maleWeight: '152kg', femaleWeight: '102kg', kind: 'sled', expectedUnits: 4 },
    { id: 'run-2', name: 'Corrida 2', type: 'run', orderIndex: 2, distance: '1km', kind: 'generic' },
    { id: 'wall-balls', name: 'Wall Balls', type: 'station', orderIndex: 3, reps: 100, maleWeight: '9kg', femaleWeight: '6kg', kind: 'wall_ball' }
  ]);
  const sections = race.toRaceSnapshotStages([station('farmers-carry', 'Farmers Carry', { distance: '200m' })]);
  assert.equal(sections[0].kind, 'sections');
  assert.equal(sections[0].expectedUnits, undefined, 'seções sem units seguem sem meta');
});

test('toRaceSnapshotStages: conferenceKind válido manda sobre o nome; reps vira wall_ball; units manda sobre a conta do trenó', () => {
  const [kb, erg, sled, lunges, plain] = race.toRaceSnapshotStages([
    station('stage-course-kb', 'Kettlebell Swing', { orderIndex: 1, reps: 50, conferenceKind: 'reps' }),
    station('sled-push', 'Sled Push', { orderIndex: 2, distance: '50m', conferenceKind: 'ergometer', units: 6 }),
    station('sled-pull', 'Sled Pull', { orderIndex: 3, distance: '50m', units: 6 }),
    station('sandbag-lunges', 'Sandbag Lunges', { orderIndex: 4, distance: '100m', units: 8 }),
    station('stage-course-carry', 'Carry Livre', { orderIndex: 5, conferenceKind: 'sections', units: 3 })
  ]);
  assert.deepEqual({ kind: kb.kind, reps: kb.reps, expectedUnits: kb.expectedUnits }, { kind: 'wall_ball', reps: 50, expectedUnits: undefined });
  assert.deepEqual({ kind: erg.kind, expectedUnits: erg.expectedUnits }, { kind: 'ergometer', expectedUnits: undefined }, 'ergômetro ignora units');
  assert.equal(sled.expectedUnits, 6, 'units no lugar de 50 m / 12,5 m');
  assert.deepEqual({ kind: lunges.kind, expectedUnits: lunges.expectedUnits }, { kind: 'sections', expectedUnits: 8 });
  assert.deepEqual({ kind: plain.kind, expectedUnits: plain.expectedUnits }, { kind: 'sections', expectedUnits: 3 });
  for (const stage of [kb, erg, sled, lunges, plain]) {
    assert.equal('conferenceKind' in stage, false, 'o snapshot leva o tipo resolvido, não o campo bruto');
    assert.equal('units' in stage, false);
  }
});

test('toRaceSnapshotStages: valores inválidos ignorados sem lançar; corrida ignora os campos', () => {
  const stages = race.toRaceSnapshotStages([
    station('sled-push', 'Sled Push', { orderIndex: 1, distance: '50m', conferenceKind: 'trenó', units: 0 }),
    station('stage-course-y', 'Tire Flip', { orderIndex: 2, conferenceKind: 'sections', units: 2.5 }),
    station('stage-course-z', 'Bike', { orderIndex: 3, conferenceKind: 42, units: '8' }),
    station('sled-pull', 'Sled Pull', { orderIndex: 4, distance: '50m', conferenceKind: 'sled', units: 999 }),
    { id: 'run-1', name: 'Run 1', type: 'run', orderIndex: 5, distance: '1km', conferenceKind: 'reps', units: 4, reps: 20 }
  ]);
  assert.deepEqual(stages.map((stage) => [stage.kind, stage.expectedUnits]), [
    ['sled', 4],
    ['sections', undefined],
    ['generic', undefined],
    ['sled', 4],
    ['generic', undefined]
  ]);
});

// ---------------------------------------------------------------------------
// Snapshot por categoria e travado (AC6, AC7)
// ---------------------------------------------------------------------------

test('snapshot por categoria: cada categoria leva o próprio percurso, sem misturar tipo e meta', async (t) => {
  quiet(t);
  seed();
  const ruleset = await race.ensureRaceRuleset(client, EVENT);
  assert.deepEqual(ruleset.course['div-oficial'].map((stage) => [stage.id, stage.kind, stage.expectedUnits]), [
    ['run-1', 'generic', undefined],
    ['sled-push', 'sled', 4],
    ['run-2', 'generic', undefined],
    ['wall-balls', 'wall_ball', undefined]
  ]);
  assert.deepEqual(ruleset.course['div-custom'].map((stage) => [stage.id, stage.kind, stage.expectedUnits, stage.reps]), [
    ['run-1', 'generic', undefined, undefined],
    ['stage-course-kettlebell-swing-1', 'wall_ball', undefined, 50],
    ['stage-course-tire-flip-2', 'sections', 8, undefined]
  ]);
});

test('snapshot travado: mudar tipo e meta depois de locked_at não altera a corrida; a tela do árbitro recebe kind, meta e reps do snapshot', async (t) => {
  quiet(t);
  seed();
  await startRun('ath-custom', 'div-custom');
  database.rows('race_rulesets')[0].locked_at = '2026-11-01T10:00:00.000Z';
  database.rows('divisions')[1].course_layout = CUSTOM.map((stage) => (
    stage.id === 'stage-course-kettlebell-swing-1' ? { ...stage, reps: 80, conferenceKind: 'generic' } : stage
  ));
  const opened = await post(postRace, JUDGE, { action: 'open_attempt', eventId: EVENT, athleteId: 'ath-custom', stationId: 'stage-course-kettlebell-swing-1', lane: 1 });
  assert.equal(opened.status, 200, opened.body.error);
  assert.deepEqual(
    { kind: opened.body.stage.kind, reps: opened.body.stage.reps, expectedUnits: opened.body.stage.expectedUnits },
    { kind: 'wall_ball', reps: 50, expectedUnits: undefined }
  );
  assert.equal(opened.body.attempt.stationKind, 'wall_ball');
  assert.equal((await race.ensureRaceRuleset(client, EVENT)).course['div-custom'][1].reps, 50, 'o snapshot não muda');
});

test('AC7: fora de toRaceSnapshotStages/suggestRaceConferenceKind, nenhum código lê o tipo da estação pelo nome', () => {
  const server = read('../src/lib/serverRaceSheets.ts');
  assert.doesNotMatch(server, /resolveRaceStationKind/);
  assert.doesNotMatch(server, /expectedUnitsOf|metersOf/);
  assert.match(server, /resolveRaceStageConference\(\{/);
  for (const file of [
    '../src/app/admin/page.tsx',
    '../src/components/admin/RaceSheetPanel.tsx',
    '../src/components/admin/RacePenaltiesPanel.tsx',
    '../src/lib/serverRacePublication.ts',
    '../src/lib/serverRaceDecisions.ts'
  ]) {
    assert.doesNotMatch(read(file), /resolveRaceStationKind/, file);
  }
});

// ---------------------------------------------------------------------------
// Editor do percurso (AC3, AC4)
// ---------------------------------------------------------------------------

test('validação do editor: reps sem reps bloqueado; units fora de 1 a 200 bloqueado; corrida livre', () => {
  const validate = structure.validateRaceStageConference;
  assert.match(validate({ type: 'station', conferenceKind: 'reps' }), /Informe as repetições/);
  assert.match(validate({ type: 'station', conferenceKind: 'reps', reps: 0 }), /Informe as repetições/);
  assert.equal(validate({ type: 'station', conferenceKind: 'reps', reps: 100 }), null);
  assert.match(validate({ type: 'station', conferenceKind: 'sled', units: 0 }), /número inteiro de 1 a 200/);
  assert.match(validate({ type: 'station', conferenceKind: 'sections', units: 201 }), /1 a 200/);
  assert.match(validate({ type: 'station', conferenceKind: 'sections', units: 2.5 }), /1 a 200/);
  assert.equal(validate({ type: 'station', conferenceKind: 'sled' }), null, 'sem units, o trenó usa a distância');
  assert.equal(validate({ type: 'station', conferenceKind: 'ergometer', units: 999 }), null, 'units só vale no trenó e nas seções');
  assert.equal(validate({ type: 'run', conferenceKind: 'reps' }), null);
});

test('withRaceStageConference: estação grava o tipo e units só no trenó e nas seções; corrida sai sem os campos', () => {
  const base = { id: 's', name: 'Tire Flip', type: 'station', orderIndex: 1, distance: '40m' };
  assert.deepEqual(structure.withRaceStageConference(base, { conferenceKind: 'sections', units: 8 }), { ...base, conferenceKind: 'sections', units: 8 });
  assert.deepEqual(structure.withRaceStageConference({ ...base, units: 8 }, { conferenceKind: 'ergometer', units: 8 }), { ...base, conferenceKind: 'ergometer' });
  assert.deepEqual(structure.withRaceStageConference({ ...base, type: 'run', conferenceKind: 'sled', units: 4 }, { conferenceKind: 'sled', units: 4 }), { ...base, type: 'run' });
});

test('lista de etapas: tipo e meta de cada estação; sem os campos, o tipo sugerido (o mesmo da súmula); corrida sem rótulo', () => {
  const describe = structure.describeRaceStageConference;
  assert.equal(describe(station('sled-push', 'Sled Push', { distance: '50m' })), 'Trenó · 4 trechos');
  assert.equal(describe(station('x', 'Tire Flip', { conferenceKind: 'sled', units: 1 })), 'Trenó · 1 trecho');
  assert.equal(describe(station('x', 'Tire Flip', { conferenceKind: 'sections', units: 8 })), 'Seções · 8 voltas');
  assert.equal(describe(station('farmers-carry', 'Farmers Carry', { distance: '200m' })), 'Seções');
  assert.equal(describe(station('wall-balls', 'Wall Balls', { reps: 100 })), 'Reps · 100');
  assert.equal(describe(station('ski-erg', 'Ski Erg', { distance: '1000m' })), 'Ergômetro');
  assert.equal(describe(station('x', 'Kettlebell Swing')), 'Genérica');
  assert.equal(describe({ id: 'run-1', name: 'Run 1', type: 'run', orderIndex: 1 }), null);
});

test('editor (estático): componente próprio, import no painel, reps obrigatório para o tipo Reps e a aba sheets de FF intacta', () => {
  const component = read('../src/components/admin/CourseStageConferenceFields.tsx');
  assert.match(component, /export function CourseStageConferenceFields/);
  assert.match(component, /Tipo de conferência \*/);
  assert.match(component, /Trechos \/ voltas/);
  assert.match(component, /const showUnits = conferenceKindUsesUnits\(conferenceKind\)/);
  const admin = read('../src/app/admin/page.tsx');
  assert.match(admin, /import \{ CourseStageConferenceFields \} from '@\/components\/admin\/CourseStageConferenceFields';/);
  assert.match(admin, /<CourseStageConferenceFields\n/);
  assert.match(admin, /const conferenceError = validateRaceStageConference\(\{ type: stageType, conferenceKind: stageEffectiveConferenceKind, units: stageUnits, reps: stageReps \}\);\n    if \(conferenceError\) \{/);
  assert.match(admin, /required=\{stageType === 'station' && stageEffectiveConferenceKind === 'reps'\}/);
  assert.match(admin, /const stageEffectiveConferenceKind: RaceConferenceKind = stageConferenceKind \?\? stageSuggestedConferenceKind;/);
  assert.match(admin, /\{activeEventTab === 'sheets' && \(selectedEventToManage\.eventType \|\| 'functional_fitness'\) === 'functional_fitness' && <ScoresheetsPanel event=\{selectedEventToManage\} \/>\}/);
});

// ---------------------------------------------------------------------------
// Compatibilidade (AC8)
// ---------------------------------------------------------------------------

test('regressão: /api/sheets recusa Fitness Race; bootstrap público segue com course_layout e sem coluna race_*', async (t) => {
  quiet(t);
  seed();
  const sheets = await post(postSheets, JUDGE, { action: 'open', eventId: EVENT, workoutId: 'wod-x', athleteId: 'ath-oficial' });
  assert.equal(sheets.status, 400);
  assert.match(sheets.body.error, /exclusiva de eventos Functional Fitness presenciais/);
  assert.match(PUBLIC_DIVISION_SELECT, /\bcourse_layout\b/);
  assert.doesNotMatch(PUBLIC_DIVISION_SELECT, /race_/);
  const types = read('../src/types/index.ts');
  assert.match(types, /conferenceKind\?: RaceConferenceKind;/);
  assert.match(types, /units\?: number;/);
});
