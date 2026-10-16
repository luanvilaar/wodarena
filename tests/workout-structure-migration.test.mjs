import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

// Story 1.43 (AC1, AC13): migration aditiva e idempotente de workouts.structure.
// A execução real foi validada em Postgres em memória (PGlite), fora do
// projeto; aqui o contrato do arquivo fica travado contra regressão.

const MIGRATION = '20261016120000_workout_structure.sql';
const PREVIOUS_STORY_MIGRATION = '20261015120000_event_map_coordinates.sql';
const migrationsDir = new URL('../supabase/migrations/', import.meta.url);
const readMigration = (name) => readFileSync(new URL(name, migrationsDir), 'utf8');
const allMigrations = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();

const migration = readMigration(MIGRATION);
// Sem os comentários: o rollback documentado no cabeçalho cita DROP de propósito.
const sql = migration.replace(/--[^\n]*/g, '');

// Impressão digital das 54 migrations anteriores (nome + conteúdo, LF), tirada
// quando esta migration foi criada. Migration aplicada não se edita: a mudança
// entra em migration nova. Se este teste falhar, veja `git diff -- supabase/migrations`.
const PREVIOUS_MIGRATIONS_COUNT = 54;
const PREVIOUS_MIGRATIONS_SHA256 = 'bcdfbdb16eec305ae34930ce375489081e1763b612415fb3dfca082f385cca00';

test('a migration existe e vem depois da Story 1.41 na ordem de nome', () => {
  assert.ok(MIGRATION > PREVIOUS_STORY_MIGRATION);
  const position = allMigrations.indexOf(MIGRATION);
  assert.ok(position >= 0);
  assert.ok(position > allMigrations.indexOf(PREVIOUS_STORY_MIGRATION));
  assert.ok(allMigrations.indexOf(PREVIOUS_STORY_MIGRATION) >= 0);
});

test('workouts ganha structure JSONB, nullable, sem default e sem backfill', () => {
  assert.match(sql, /ALTER TABLE public\.workouts\s+ADD COLUMN IF NOT EXISTS structure JSONB;/);
  assert.doesNotMatch(sql, /\bDEFAULT\b/i);
  assert.doesNotMatch(sql, /structure JSONB NOT NULL|SET NOT NULL/i);
});

test('o CHECK tem nome fixo e aceita só NULL ou objeto JSON', () => {
  const statement = sql.match(/ALTER TABLE public\.workouts ADD CONSTRAINT workouts_structure_is_object\s+([^;]+);/);
  assert.ok(statement, 'ADD CONSTRAINT workouts_structure_is_object ausente');
  assert.match(statement[1], /^CHECK \(structure IS NULL OR jsonb_typeof\(structure\) = 'object'\)\s*$/);
  assert.equal(sql.match(/ADD CONSTRAINT/g).length, 1);
});

test('a migration é idempotente: coluna com IF NOT EXISTS e CHECK guardado por pg_constraint', () => {
  assert.equal((sql.match(/ADD COLUMN/g) || []).length, 1);
  assert.equal((sql.match(/ADD COLUMN IF NOT EXISTS/g) || []).length, 1);
  assert.match(
    sql,
    /IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint\s+WHERE conrelid = 'public\.workouts'::regclass AND conname = 'workouts_structure_is_object'\s*\) THEN\s+ALTER TABLE public\.workouts ADD CONSTRAINT workouts_structure_is_object\b/
  );
  assert.doesNotMatch(sql, /CREATE (TABLE|INDEX|TRIGGER|POLICY|VIEW|FUNCTION)\b/i);
});

test('a migration é só aditiva: sem DROP, UPDATE, INSERT nem mudança de RLS, policy ou grant', () => {
  assert.doesNotMatch(sql, /\bDROP\b/i);
  assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
  assert.doesNotMatch(sql, /\bDELETE\b/i);
  assert.doesNotMatch(sql, /\bUPDATE\b/i);
  assert.doesNotMatch(sql, /\bINSERT\b/i);
  assert.doesNotMatch(sql, /ALTER COLUMN/i);
  assert.doesNotMatch(sql, /\bRENAME\b/i);
  assert.doesNotMatch(sql, /\bGRANT\b|\bREVOKE\b/i);
  assert.doesNotMatch(sql, /ROW LEVEL SECURITY|\bPOLICY\b/i);
  assert.doesNotMatch(sql, /CREATE OR REPLACE/i);
  // Só a tabela workouts é tocada.
  for (const table of sql.match(/ALTER TABLE\s+[\w.]+/g)) assert.equal(table.replace(/\s+/g, ' '), 'ALTER TABLE public.workouts');
});

test('a coluna é documentada com o contrato e a versão; o cabeçalho traz ordem de deploy e rollback', () => {
  const comment = sql.match(/COMMENT ON COLUMN public\.workouts\.structure IS\s+'([^']{80,})'/);
  assert.ok(comment, 'COMMENT ON COLUMN ausente');
  assert.match(comment[1], /contrato versão 1/);
  assert.match(comment[1], /NULL = prova sem estrutura/);
  assert.match(migration, /-- Ordem de deploy: aplicar antes de publicar o código da Story 1\.43, depois de\n-- 20261015120000_event_map_coordinates\.sql/);
  assert.match(migration, /-- Rollback \(em nova migration/);
  assert.match(migration, /DROP CONSTRAINT IF EXISTS workouts_structure_is_object/);
  assert.match(migration, /DROP COLUMN IF EXISTS structure/);
});

test('nenhuma migration anterior foi editada nem cita a coluna nova', () => {
  const previous = allMigrations.filter((name) => name < MIGRATION);
  assert.equal(previous.length, PREVIOUS_MIGRATIONS_COUNT);

  const hash = createHash('sha256');
  for (const name of previous) {
    hash.update(`${name}\n${readMigration(name).replace(/\r\n/g, '\n')}\n`);
  }
  assert.equal(hash.digest('hex'), PREVIOUS_MIGRATIONS_SHA256, 'migration já aplicada foi alterada');

  for (const name of previous) {
    assert.doesNotMatch(readMigration(name), /\bstructure\b|workouts_structure_is_object/, name);
  }
});
