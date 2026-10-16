import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

// Story 1.41 (AC1): migration aditiva e idempotente das coordenadas do local
// do evento. A execução real foi validada em Postgres em memória (PGlite),
// fora do projeto; aqui o contrato do arquivo fica travado contra regressão.

const MIGRATION = '20261015120000_event_map_coordinates.sql';
const migrationsDir = new URL('../supabase/migrations/', import.meta.url);
const readMigration = (name) => readFileSync(new URL(name, migrationsDir), 'utf8');
const allMigrations = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();

const migration = readMigration(MIGRATION);
// Sem os comentários: o rollback documentado no cabeçalho cita DROP de propósito.
const sql = migration.replace(/--[^\n]*/g, '');

const NEW_CONSTRAINTS = {
  events_coordinates_range_check: /CHECK \(\s*\(latitude IS NULL OR latitude BETWEEN -90 AND 90\)\s*AND \(longitude IS NULL OR longitude BETWEEN -180 AND 180\)\s*\)/,
  events_coordinates_both_or_none: /CHECK \(\s*\(latitude IS NULL AND longitude IS NULL\)\s*OR \(latitude IS NOT NULL AND longitude IS NOT NULL\)\s*\)/
};

// Impressão digital das 53 migrations anteriores (nome + conteúdo, LF), tirada
// quando esta migration foi criada. Migration aplicada não se edita: a mudança
// entra em migration nova. Se este teste falhar, veja `git diff -- supabase/migrations`.
const PREVIOUS_MIGRATIONS_COUNT = 53;
const PREVIOUS_MIGRATIONS_SHA256 = '81799683ef9615cd23ecc5843954fcfb718d34fcf18f3d998a0efe68f1d34333';

test('a migration vem depois da Story 1.40 na ordem de nome', () => {
  assert.ok(MIGRATION > '20261014120000_protect_paid_registrations.sql');
  // Presença e ordem, não "a última": migrations posteriores (ex.: Story 1.43)
  // não quebram este teste (achado TEST-001 da Story 1.41).
  const position = allMigrations.indexOf(MIGRATION);
  const previousStory = allMigrations.indexOf('20261014120000_protect_paid_registrations.sql');
  assert.ok(position >= 0, 'a migration da Story 1.41 existe');
  assert.ok(previousStory >= 0, 'a migration da Story 1.40 existe');
  assert.ok(position > previousStory, 'a migration da Story 1.41 vem depois da 1.40');
});

test('events ganha latitude e longitude NUMERIC, nullable, sem default e sem backfill', () => {
  assert.match(
    sql,
    /ALTER TABLE public\.events\s+ADD COLUMN IF NOT EXISTS latitude NUMERIC,\s+ADD COLUMN IF NOT EXISTS longitude NUMERIC;/
  );
  assert.doesNotMatch(sql, /\bDEFAULT\b/i);
  assert.doesNotMatch(sql, /NOT NULL DEFAULT|latitude NUMERIC NOT NULL|longitude NUMERIC NOT NULL/);
});

test('os dois CHECKs têm nome fixo e as regras de faixa e de ambos-ou-nenhum', () => {
  for (const [name, check] of Object.entries(NEW_CONSTRAINTS)) {
    const statement = sql.match(new RegExp(`ALTER TABLE public\\.events ADD CONSTRAINT ${name}\\s+([^;]+);`));
    assert.ok(statement, `ADD CONSTRAINT ${name} ausente`);
    assert.match(statement[1], check, name);
  }
  assert.equal(sql.match(/ADD CONSTRAINT/g).length, Object.keys(NEW_CONSTRAINTS).length);
});

test('a migration é idempotente: colunas com IF NOT EXISTS e cada CHECK guardado por pg_constraint', () => {
  const addColumns = sql.match(/ADD COLUMN/g) || [];
  const guardedColumns = sql.match(/ADD COLUMN IF NOT EXISTS/g) || [];
  assert.equal(addColumns.length, 2);
  assert.equal(guardedColumns.length, addColumns.length);

  for (const name of Object.keys(NEW_CONSTRAINTS)) {
    assert.match(
      sql,
      new RegExp(
        `IF NOT EXISTS \\(\\s*SELECT 1 FROM pg_constraint\\s+WHERE conrelid = 'public\\.events'::regclass AND conname = '${name}'\\s*\\) THEN\\s+ALTER TABLE public\\.events ADD CONSTRAINT ${name}\\b`
      ),
      `${name} sem guarda de idempotência`
    );
  }
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
});

test('as colunas são documentadas e o cabeçalho traz ordem de deploy e rollback', () => {
  for (const column of ['latitude', 'longitude']) {
    assert.match(sql, new RegExp(`COMMENT ON COLUMN public\\.events\\.${column} IS\\s+'[^']{40,}'`), column);
  }
  assert.match(migration, /-- Ordem de deploy: aplicar antes de publicar o código da Story 1\.41/);
  assert.match(migration, /-- Rollback \(em nova migration/);
  assert.match(migration, /DROP CONSTRAINT IF EXISTS events_coordinates_both_or_none/);
  assert.match(migration, /DROP COLUMN IF EXISTS longitude, DROP COLUMN IF EXISTS latitude/);
});

test('nenhuma migration anterior foi editada nem recebeu as colunas novas', () => {
  const previous = allMigrations.filter((name) => name < MIGRATION);
  assert.equal(previous.length, PREVIOUS_MIGRATIONS_COUNT);

  const hash = createHash('sha256');
  for (const name of previous) {
    hash.update(`${name}\n${readMigration(name).replace(/\r\n/g, '\n')}\n`);
  }
  assert.equal(hash.digest('hex'), PREVIOUS_MIGRATIONS_SHA256, 'migration já aplicada foi alterada');

  for (const name of previous) {
    assert.doesNotMatch(readMigration(name), /\blatitude\b|\blongitude\b|events_coordinates_/, name);
  }
  // A migration base segue com location TEXT NOT NULL (texto livre do local).
  assert.match(readMigration('20260602164100_supabase_schema.sql'), /location TEXT NOT NULL/);
});
