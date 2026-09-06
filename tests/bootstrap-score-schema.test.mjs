import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/bootstrapPayload.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
const { buildPublicEventBootstrapPayload, PUBLIC_SCORE_SELECT, readBootstrapQuery } =
  await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

// Public scores store the final decision/result. Penalty percentages and private
// review evidence belong to score_submissions, not to this table.
const score = {
  athlete_id: 'athlete-1', workout_id: 'workout-1', result: '85', value: 85,
  rank: 1, points: 1, splits: {}, result_status: 'penalized'
};

function database() {
  const rows = {
    events: [{ id: 'event-1' }],
    divisions: [{ id: 'division-1', event_id: 'event-1' }],
    workouts: [{ id: 'workout-1', event_id: 'event-1' }],
    athletes: [], scores: [score], leaderboard_entries: []
  };
  return {
    from(table) {
      let selected;
      let single = false;
      const filters = [];
      const query = {
        select(fields) { selected = fields.split(',').map(field => field.trim()); return query; },
        eq(key, value) { filters.push(row => row[key] === value); return query; },
        in(key, values) { filters.push(row => values.includes(row[key])); return query; },
        maybeSingle() { single = true; return query; },
        then(resolve, reject) {
          const missing = table === 'scores' && selected.find(field => !(field in score));
          if (missing) return Promise.resolve({ data: null, error: {
            code: '42703', message: `column scores.${missing} does not exist`
          } }).then(resolve, reject);
          const data = rows[table].filter(row => filters.every(filter => filter(row)))
            .map(row => Object.fromEntries(selected.filter(field => field in row).map(field => [field, row[field]])));
          return Promise.resolve({ data: single ? data[0] ?? null : data, error: null }).then(resolve, reject);
        }
      };
      return query;
    }
  };
}

test('public event bootstrap loads the final penalized score without querying submission-only columns', async () => {
  const payload = await buildPublicEventBootstrapPayload(database(), 'event-1');
  assert.deepEqual(payload.scores, [score]);
  assert.equal(payload.events[0].id, 'event-1');
  assert.deepEqual(payload.registrations, []);
});

test('shared private bootstrap score projection matches the scores schema and preserves its scope', async () => {
  const db = database();
  assert.deepEqual(await readBootstrapQuery('scores do gestor', db.from('scores')
    .select(PUBLIC_SCORE_SELECT).in('workout_id', ['workout-1'])), [score]);
  assert.deepEqual(await readBootstrapQuery('scores de outro evento', db.from('scores')
    .select(PUBLIC_SCORE_SELECT).in('workout_id', ['other-workout'])), []);
});
