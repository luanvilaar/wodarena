import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

// Story 1.78: migration aditiva e idempotente do tipo de prova "tonnage" em
// workouts.type (formato Tonelagem da súmula digital). Os tipos antigos
// continuam aceitos; nada mais muda no banco.

const MIGRATION = '20261027120000_workout_type_tonnage.sql';
const LAST_APPLIED_BEFORE = '20261026120000_event_dates.sql';
const migrationsDir = new URL('../supabase/migrations/', import.meta.url);
const readMigration = (name) => readFileSync(new URL(name, migrationsDir), 'utf8');
const allMigrations = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();

const migration = readMigration(MIGRATION);
// Sem os comentários: o rollback documentado no cabeçalho cita DROP de propósito.
const sql = migration.replace(/--[^\n]*/g, '');

// Impressão digital das 59 migrations anteriores (nome + conteúdo, LF), tirada
// quando esta migration foi criada. Migration aplicada não se edita: a mudança
// entra em migration nova. Se este teste falhar, veja `git diff -- supabase/migrations`.
const PREVIOUS_MIGRATIONS_COUNT = 59;
const PREVIOUS_MIGRATIONS_SHA256 = '34efe44cd72c10c6c11a09c944fff5ede31eb36e8a24118f528eb19d82324735';

const OLD_TYPES = ['fortime', 'amrap', 'maxweight', 'reps', 'points', 'distance'];

test('a migration existe e vem depois da última migration aplicada na ordem de nome', () => {
  assert.ok(MIGRATION > LAST_APPLIED_BEFORE);
  assert.ok(allMigrations.indexOf(LAST_APPLIED_BEFORE) >= 0);
  assert.equal(allMigrations.indexOf(MIGRATION), allMigrations.indexOf(LAST_APPLIED_BEFORE) + 1);
});

test('workouts_type_check é removido se existir e recriado com os seis tipos de hoje mais tonnage', () => {
  assert.match(sql, /ALTER TABLE workouts DROP CONSTRAINT IF EXISTS workouts_type_check;/);
  const recreated = sql.match(/ALTER TABLE workouts ADD CONSTRAINT workouts_type_check\s+CHECK \(type IN \(([^)]+)\)\);/);
  assert.ok(recreated, 'ADD CONSTRAINT workouts_type_check ausente');
  const values = [...recreated[1].matchAll(/'([a-z]+)'/g)].map((match) => match[1]);
  assert.deepEqual(values, [...OLD_TYPES, 'tonnage']);
  // O DROP vem antes do ADD, na mesma migration: reaplicar não falha por nome repetido.
  assert.ok(sql.indexOf('DROP CONSTRAINT IF EXISTS workouts_type_check') < sql.indexOf('ADD CONSTRAINT workouts_type_check'));
});

test('a migration é só isso: nenhuma tabela, coluna, policy, grant, função ou dado novo', () => {
  assert.equal((sql.match(/\bALTER TABLE\b/g) || []).length, 2, 'só o DROP e o ADD da restrição');
  assert.doesNotMatch(sql, /\b(CREATE|DROP TABLE|ADD COLUMN|DROP COLUMN|POLICY|GRANT|REVOKE|FUNCTION|TRIGGER|INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
  // Os tipos antigos ficam todos aceitos: nenhum foi retirado.
  for (const type of OLD_TYPES) assert.match(sql, new RegExp(`'${type}'`));
});

test('o cabeçalho documenta o que fica de fora e a ordem de deploy', () => {
  assert.match(migration, /Story 1\.78/);
  assert.match(migration, /Ordem de deploy: aplicar ANTES de publicar o construtor da Tonelagem \(Story\n-- 1\.79\)/);
  assert.match(migration, /Rollback/);
  assert.match(migration, /funções SQL de correção de qualifier/);
});

test('nenhuma migration anterior foi editada nem cita o tipo novo', () => {
  const previous = allMigrations.filter((name) => name < MIGRATION);
  assert.equal(previous.length, PREVIOUS_MIGRATIONS_COUNT);

  const hash = createHash('sha256');
  for (const name of previous) {
    hash.update(`${name}\n${readMigration(name).replace(/\r\n/g, '\n')}\n`);
  }
  assert.equal(hash.digest('hex'), PREVIOUS_MIGRATIONS_SHA256, 'migration já aplicada foi alterada');
  for (const name of previous) assert.doesNotMatch(readMigration(name), /'tonnage'/, name);
});
