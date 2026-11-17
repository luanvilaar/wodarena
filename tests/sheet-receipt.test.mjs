import assert from 'node:assert/strict';
import test from 'node:test';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Story 1.144: comprovante de envio da súmula digital (plano aprovado em
// docs/design/comprovante-sumula/). O modelo puro com os seis estados, o link
// assinado e a rota real com o banco em memória: link sem login, acesso por
// papel pela súmula, lista do atleta e nenhum e-mail, telefone ou CPF.

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-comprovante';

let database = createFakeSupabase();
setActiveSupabaseClient({ from: (table) => database.client.from(table), rpc: (name, args) => database.client.rpc(name, args) });

const receipt = await importServerModule('lib/sheetReceipt.ts');
const security = await importServerModule('lib/serverSecurity.ts');
const { GET } = await importServerModule('app/api/sheet-receipts/route.ts');

// ---------------------------------------------------------------------------
// Modelo puro
// ---------------------------------------------------------------------------

const AMRAP = { format: 'amrap', timeCapSeconds: 720 };
const baseInput = (sheet = {}, extra = {}) => ({
  sheet: {
    id: 'sheet-abc123xyz9', status: 'submitted', absent: false, corrected: false,
    official_result: '387', official_tie_break: '11:12', computed_result: '387',
    heat_number: 3, lane: 5, judge_name: 'Iara', created_at: '2026-11-15T13:47:00.000Z', submitted_at: '2026-11-15T13:59:00.000Z',
    structure: AMRAP, ...sheet
  },
  event: { name: 'Desafio Litoral 2026', date: '15/11/2026', location: 'Arena Norte', city: 'Fortaleza', state: 'CE', time_zone: 'America/Fortaleza' },
  workout: { code: 'PROVA 2', name: 'PROVA 2', description: '10 thrusters\n15 burpees over the bar\n\n20 wall balls', tie_breaker: 'Tempo do último round' },
  athlete: { name: 'Os Insistentes (Yuri Lacerda / Breno Macedo)', box: 'CT Maré Alta' },
  divisionName: 'Dupla Intermediário Masculino',
  heat: { date: '2026-11-15', time: '10:46' },
  reviews: [
    { action: 'opened', actor_name: 'Iara', actor_role: 'judge', created_at: '2026-11-15T13:47:00.000Z' },
    { action: 'submitted', actor_name: 'Iara', actor_role: 'judge', applied_result: '387', created_at: '2026-11-15T13:59:00.000Z' }
  ],
  score: { result: '387', scoresheet_id: 'sheet-abc123xyz9' },
  summary: '6 rounds + 27 (total 387)',
  ...extra
});

test('1.144: comprovante publicado com prova, atleta, bateria, horário, árbitro e linha do tempo', () => {
  const model = receipt.buildSheetReceipt(baseInput());
  assert.equal(model.state, 'published');
  assert.equal(model.code, '123XYZ9'.padStart(8, 'C'), 'últimos 8 caracteres do id');
  assert.deepEqual(model.event, { name: 'Desafio Litoral 2026', initials: 'DL', subtitle: '15/11/2026 · Arena Norte, Fortaleza/CE' });
  assert.deepEqual(model.workout, { code: 'PROVA 2', name: 'PROVA 2', format: 'AMRAP 12 min', movements: ['10 thrusters', '15 burpees over the bar', '20 wall balls'], tieBreaker: 'Tempo do último round' });
  assert.deepEqual(model.athlete, { name: 'Os Insistentes', members: 'Yuri Lacerda / Breno Macedo', box: 'CT Maré Alta', division: 'Dupla Intermediário Masculino' });
  assert.deepEqual(model.heat, { number: 3, lane: 5, scheduled: '15/11, 10:46' });
  assert.equal(model.judgeName, 'Iara');
  assert.equal(model.openedAt, '15/11, 10:47', 'no fuso do evento');
  assert.equal(model.sentAt, '15/11, 10:59');
  assert.deepEqual(model.result, { value: '387', unit: 'reps', tieBreak: '11:12', struck: false, official: false });
  assert.equal(model.judgeResult, null);
  assert.equal(model.summary, '6 rounds + 27 (total 387)');
  assert.deepEqual(model.seal, { title: 'Publicada no ranking', text: 'Enviada pelo judge em 15/11, 10:59.' });
  assert.deepEqual(model.timeline, [
    { at: '15/11, 10:47', label: 'Súmula aberta', detail: 'por Iara' },
    { at: '15/11, 10:59', label: 'Enviada e publicada', detail: 'por Iara · 387' }
  ]);
});

test('1.144: súmula nunca enviada não tem comprovante', () => {
  assert.equal(receipt.buildSheetReceipt(baseInput({ status: 'in_progress', submitted_at: null })), null);
});

test('1.144: corrigida mostra o oficial e o enviado pelo judge, sem justificativa nem nome do gestor', () => {
  const model = receipt.buildSheetReceipt(baseInput({ corrected: true, official_result: '391' }, {
    score: { result: '391', scoresheet_id: 'sheet-abc123xyz9' },
    reviews: [
      ...baseInput().reviews,
      { action: 'corrected', actor_name: 'Gestora Fulana', actor_role: 'manager', reason: 'Recontagem no vídeo', previous_result: '387', applied_result: '391', created_at: '2026-11-15T14:31:00.000Z' }
    ]
  }));
  assert.equal(model.state, 'corrected');
  assert.equal(model.result.value, '391');
  assert.equal(model.result.official, true);
  assert.equal(model.judgeResult, '387 reps');
  assert.equal(model.seal.text, 'O ranking usa 391 reps desde 15/11, 11:31.');
  assert.deepEqual(model.timeline.at(-1), { at: '15/11, 11:31', label: 'Resultado corrigido pelo gestor', detail: 'pelo gestor · 387 → 391' });
  assert.doesNotMatch(JSON.stringify(model), /Fulana|Recontagem/);
});

test('1.144: lançada à mão usa o resultado do ranking; devolvida, ausente e cancelada', () => {
  const manual = receipt.buildSheetReceipt(baseInput({}, {
    score: { result: '391', scoresheet_id: null },
    reviews: [...baseInput().reviews, { action: 'manual_override', actor_name: 'Gestora', actor_role: 'manager', previous_result: '387', applied_result: '391', created_at: '2026-11-15T15:05:00.000Z' }]
  }));
  assert.equal(manual.state, 'manual');
  assert.equal(manual.result.value, '391');
  assert.equal(manual.result.tieBreak, null);
  assert.equal(manual.judgeResult, '387 reps');
  assert.equal(manual.seal.text, 'O ranking usa o resultado lançado desde 15/11, 12:05.');

  const returned = receipt.buildSheetReceipt(baseInput({ status: 'returned' }));
  assert.equal(returned.state, 'returned');
  assert.equal(returned.result.value, '387');
  assert.match(returned.seal.text, /continua no ranking até o novo envio/);

  const absent = receipt.buildSheetReceipt(baseInput({ absent: true, official_result: '0', official_tie_break: null }));
  assert.equal(absent.state, 'absent');
  assert.equal(absent.sentLabel, 'Ausência marcada');

  const cancelled = receipt.buildSheetReceipt(baseInput({ status: 'cancelled' }, {
    score: null,
    reviews: [...baseInput().reviews, { action: 'cancelled', actor_name: 'Gestora', actor_role: 'owner', created_at: '2026-11-15T14:05:00.000Z' }]
  }));
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(cancelled.result.struck, true);
  assert.match(cancelled.seal.text, /saiu do ranking em 15\/11, 11:05/);
});

test('1.144: formatos e resultado sem bateria no cronograma', () => {
  assert.equal(receipt.formatReceiptWorkoutFormat({ format: 'for_time', timeCapSeconds: 600 }), 'For time · cap 10 min');
  assert.equal(receipt.formatReceiptWorkoutFormat({ format: 'max_load', timeCapSeconds: null }), 'Carga máxima');
  assert.deepEqual(receipt.formatReceiptResult('112.5', 'max_load'), { value: '112,5', unit: 'kg' });
  assert.deepEqual(receipt.formatReceiptResult('6330', 'distance'), { value: '6.330', unit: 'm' });
  assert.deepEqual(receipt.formatReceiptResult('08:41', 'for_time'), { value: '08:41', unit: '' });
  const loose = receipt.buildSheetReceipt(baseInput({ heat_number: null, lane: null }, { heat: null }));
  assert.deepEqual(loose.heat, { number: null, lane: null, scheduled: null });
});

// ---------------------------------------------------------------------------
// Link assinado
// ---------------------------------------------------------------------------

test('1.144: link assinado sem prazo; adulterado, de outro propósito ou malformado é recusado', () => {
  const token = security.createSheetReceiptToken('sheet-1');
  assert.equal(security.createSheetReceiptToken('sheet-1'), token, 'o mesmo link para a mesma súmula');
  assert.equal(security.verifySheetReceiptToken(token), 'sheet-1');
  const [payload, signature] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ typ: 'sheet-receipt', sub: 'sheet-2' })).toString('base64url');
  assert.equal(security.verifySheetReceiptToken(`${forged}.${signature}`), null);
  assert.equal(security.verifySheetReceiptToken(`${payload}.${signature}x`), null);
  assert.equal(security.verifySheetReceiptToken(`${payload}.${signature}.extra`), null);
  const registration = security.createRegistrationAccessToken({ registrationId: 'sheet-1', eventId: 'ev' });
  assert.equal(security.verifySheetReceiptToken(registration), null, 'token de inscrição não vale como comprovante');
  for (const bad of [null, undefined, '', 'sem-ponto', 'a.b']) assert.equal(security.verifySheetReceiptToken(bad), null);
});

// ---------------------------------------------------------------------------
// Rota
// ---------------------------------------------------------------------------

const MANAGER = { id: 'mgr-1', name: 'Gestora', email: 'gestora@example.com', role: 'manager', service_valid_until: '2099-12-31' };
const OTHER_MANAGER = { id: 'mgr-2', name: 'Outro', email: 'outro@example.com', role: 'manager', service_valid_until: '2099-12-31' };
const JUDGE = { id: 'judge-iara', name: 'Iara', email: 'iara@example.com', role: 'judge', parent_manager_id: MANAGER.id };
const JUDGE_OUT = { id: 'judge-fora', name: 'Fora', email: 'fora@example.com', role: 'judge', parent_manager_id: MANAGER.id };
const ATHLETE = { id: 'ath-user', name: 'Yuri', email: 'Yuri@Example.com', role: 'athlete' };
const STRANGER = { id: 'ath-outro', name: 'Outro Atleta', email: 'outro.atleta@example.com', role: 'athlete' };
const OWNER = { id: 'owner-1', name: 'Owner', email: 'owner@example.com', role: 'owner' };

const sheetRow = (id, extra = {}) => ({
  id, event_id: 'ev-ff', workout_id: 'w-2', athlete_id: 'ath-team', division_id: 'div-int', heat_id: 'heat-3', heat_number: 3, lane: 5,
  judge_user_id: JUDGE.id, judge_name: 'Iara', structure: AMRAP, status: 'submitted', absent: false, corrected: false,
  official_result: '387', official_tie_break: null, computed_result: '387', created_at: '2026-11-15T13:47:00.000Z',
  submitted_at: '2026-11-15T13:59:00.000Z', published_at: '2026-11-15T13:59:00.000Z', updated_at: '2026-11-15T13:59:00.000Z', ...extra
});

const seed = () => {
  database = createFakeSupabase({
    users: [MANAGER, OTHER_MANAGER, JUDGE, JUDGE_OUT, OWNER],
    events: [
      { id: 'ev-ff', name: 'Desafio Litoral 2026', date: '15/11/2026', location: 'Arena Norte', organizer_id: MANAGER.id, event_type: 'functional_fitness', time_zone: 'America/Fortaleza',
        event_schedule: [{ id: 'heat-3', kind: 'heat', heatNumber: 3, date: '2026-11-15', time: '10:46', athleteIds: ['ath-team'], workoutId: 'w-2' }] },
      { id: 'ev-race', name: 'Corrida', organizer_id: MANAGER.id, event_type: 'fitness_racing', event_schedule: [] }
    ],
    event_judges: [{ event_id: 'ev-ff', judge_user_id: JUDGE.id }],
    divisions: [{ id: 'div-int', event_id: 'ev-ff', name: 'Dupla Intermediário Masculino' }, { id: 'div-race', event_id: 'ev-race', name: 'Pro' }],
    athletes: [
      { id: 'ath-team', name: 'Os Insistentes (Yuri Lacerda / Breno Macedo)', box: 'CT Maré Alta', division_id: 'div-int', email: 'yuri@example.com', phone: '85999990000' },
      { id: 'ath-race', name: 'Corredor', box: 'X', division_id: 'div-race' }
    ],
    workouts: [
      { id: 'w-1', event_id: 'ev-ff', code: 'PROVA 1', name: 'PROVA 1', type: 'fortime', division_id: null, order_index: 1, structure: { format: 'for_time', timeCapSeconds: 600 } },
      { id: 'w-2', event_id: 'ev-ff', code: 'PROVA 2', name: 'PROVA 2', type: 'amrap', description: '10 thrusters', division_id: 'div-int', order_index: 2, structure: AMRAP },
      { id: 'w-other', event_id: 'ev-ff', code: 'PROVA 2', name: 'PROVA 2', type: 'amrap', division_id: 'div-outra', order_index: 2, structure: AMRAP },
      { id: 'w-text', event_id: 'ev-ff', code: 'PROVA 0', name: 'Só texto', type: 'reps', division_id: null, order_index: 0, structure: null },
      { id: 'w-race', event_id: 'ev-race', code: 'R1', name: 'R1', type: 'fortime', division_id: null, order_index: 1, structure: AMRAP }
    ],
    registrations: [
      { id: 'reg-1', event_id: 'ev-ff', division_id: 'div-int', athlete_id: 'ath-team', user_id: null, athlete_email: 'yuri@example.com', athlete_phone: '85999990000', payment_status: 'payment_approved' },
      { id: 'reg-race', event_id: 'ev-race', division_id: 'div-race', athlete_id: 'ath-race', user_id: ATHLETE.id, athlete_email: 'yuri@example.com', payment_status: 'payment_approved' }
    ],
    scoresheets: [
      sheetRow('sheet-old', { status: 'cancelled', submitted_at: '2026-11-15T13:30:00.000Z', updated_at: '2026-11-15T13:40:00.000Z' }),
      sheetRow('sheet-pub'),
      sheetRow('sheet-open', { workout_id: 'w-1', status: 'in_progress', submitted_at: null, official_result: null }),
      sheetRow('sheet-race', { event_id: 'ev-race', workout_id: 'w-race', athlete_id: 'ath-race' })
    ],
    scoresheet_reviews: [
      { id: 'r1', sheet_id: 'sheet-pub', action: 'opened', actor_user_id: JUDGE.id, actor_name: 'Iara', actor_role: 'judge', created_at: '2026-11-15T13:47:00.000Z' },
      { id: 'r2', sheet_id: 'sheet-pub', action: 'submitted', actor_user_id: JUDGE.id, actor_name: 'Iara', actor_role: 'judge', applied_result: '387', created_at: '2026-11-15T13:59:00.000Z' }
    ],
    scores: [{ athlete_id: 'ath-team', workout_id: 'w-2', result: '387', value: 387, scoresheet_id: 'sheet-pub' }]
  });
};

const cookie = (user) => `woda_session=${security.createSessionToken({ id: user.id, name: user.name, email: user.email, role: user.role })}`;
const get = async (query, user) => {
  const response = await GET(new Request(`http://localhost/api/sheet-receipts?${new URLSearchParams(query)}`, { headers: user ? { cookie: cookie(user) } : {} }));
  return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
};

test('1.144: pelo link, sem login; link inválido, súmula não enviada ou fora de Functional Fitness dão 404', async () => {
  seed();
  const ok = await get({ token: security.createSheetReceiptToken('sheet-pub') });
  assert.equal(ok.status, 200);
  assert.equal(ok.cache, 'no-store');
  assert.equal(ok.body.receipt.state, 'published');
  assert.equal(ok.body.receipt.heat.scheduled, '15/11, 10:46');
  assert.equal(ok.body.receipt.athlete.division, 'Dupla Intermediário Masculino');
  assert.doesNotMatch(JSON.stringify(ok.body), /@example\.com|85999990000|cpf/i, 'sem e-mail, telefone ou CPF');
  for (const token of ['lixo', security.createSheetReceiptToken('sheet-open'), security.createSheetReceiptToken('sheet-race'), security.createSheetReceiptToken('nao-existe')]) {
    const missing = await get({ token });
    assert.equal(missing.status, 404, token);
    assert.equal(missing.body.error, 'Comprovante não encontrado.');
  }
});

test('1.144: pela súmula, com sessão: atleta dono (por e-mail), judge do evento, gestor dono e owner; os outros não', async () => {
  seed();
  for (const user of [ATHLETE, JUDGE, MANAGER, OWNER]) {
    const result = await get({ sheetId: 'sheet-pub' }, user);
    assert.equal(result.status, 200, user.id);
    assert.equal(result.body.path, `/pt-br/comprovante/sumula/${security.createSheetReceiptToken('sheet-pub')}`);
  }
  for (const user of [STRANGER, JUDGE_OUT, OTHER_MANAGER]) assert.equal((await get({ sheetId: 'sheet-pub' }, user)).status, 403, user.id);
  assert.equal((await get({ sheetId: 'sheet-pub' })).status, 401, 'sem sessão');
  const open = await get({ sheetId: 'sheet-open' }, MANAGER);
  assert.equal(open.status, 404);
  assert.match(open.body.error, /não foi enviada/);
  assert.equal((await get({ sheetId: 'nao-existe' }, MANAGER)).status, 404);
});

test('1.144: lista do atleta por inscrição aprovada de Functional Fitness, com as provas de súmula digital da categoria', async () => {
  seed();
  const result = await get({ view: 'mine' }, ATHLETE);
  assert.equal(result.status, 200);
  assert.equal(result.body.registrations.length, 1, 'a inscrição de Fitness Race fica de fora');
  const [registration] = result.body.registrations;
  assert.equal(registration.registrationId, 'reg-1');
  assert.deepEqual(registration.provas.map((prova) => [prova.code, prova.receipt?.state ?? null]), [['PROVA 1', null], ['PROVA 2', 'published']], 'sem a prova só de texto nem a de outra categoria; a ativa vence a cancelada');
  assert.equal(registration.provas[1].receipt.path, `/pt-br/comprovante/sumula/${security.createSheetReceiptToken('sheet-pub')}`);
  assert.equal(registration.provas[1].receipt.judgeName, 'Iara');
  assert.doesNotMatch(JSON.stringify(result.body), /@example\.com|85999990000/);
  assert.equal((await get({ view: 'mine' }, MANAGER)).status, 403);
  assert.deepEqual((await get({ view: 'mine' }, STRANGER)).body.registrations, []);
});
