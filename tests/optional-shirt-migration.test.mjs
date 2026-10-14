import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

// Story 1.38 (AC1): migration aditiva e idempotente da camisa opcional.
// A execução real foi validada em Postgres em memória (PGlite), fora do
// projeto; aqui o contrato do arquivo fica travado contra regressão.

const MIGRATION = '20261013120000_event_optional_shirt.sql';
const migrationsDir = new URL('../supabase/migrations/', import.meta.url);
const readMigration = (name) => readFileSync(new URL(name, migrationsDir), 'utf8');
const allMigrations = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();

const migration = readMigration(MIGRATION);
// Sem os comentários: o rollback documentado no cabeçalho cita DROP de propósito.
const sql = migration.replace(/--[^\n]*/g, '');

const NEW_CONSTRAINTS = {
  events_shirt_mode_check: ['events', /CHECK \(shirt_mode IN \('included', 'optional'\)\)/],
  events_shirt_addon_price_check: ['events', /CHECK \(shirt_addon_price >= 0\)/],
  events_optional_shirt_has_price: ['events', /CHECK \(shirt_mode <> 'optional' OR shirt_addon_price > 0\)/],
  registrations_shirt_addon_count_check: ['registrations', /CHECK \(shirt_addon_count >= 0\)/],
  registrations_shirt_addon_amount_check: ['registrations', /CHECK \(shirt_addon_amount >= 0\)/]
};

// Impressão digital das 51 migrations anteriores (nome + conteúdo, LF), tirada
// quando esta migration foi criada. Migration aplicada não se edita: a mudança
// entra em migration nova. Se este teste falhar, veja `git diff -- supabase/migrations`.
const PREVIOUS_MIGRATIONS_COUNT = 51;
const PREVIOUS_MIGRATIONS_SHA256 = 'e70c46fe0977bd14968ac859b2740fa3e7a519bf064923d66e90cea4dfbb5ea9';

test('events ganha shirt_mode e shirt_addon_price com padrão que preserva os eventos existentes', () => {
  assert.match(
    sql,
    /ALTER TABLE public\.events\s+ADD COLUMN IF NOT EXISTS shirt_mode TEXT NOT NULL DEFAULT 'included',\s+ADD COLUMN IF NOT EXISTS shirt_addon_price NUMERIC NOT NULL DEFAULT 0;/
  );
});

test('registrations ganha shirt_addon_count e shirt_addon_amount com padrão 0', () => {
  assert.match(
    sql,
    /ALTER TABLE public\.registrations\s+ADD COLUMN IF NOT EXISTS shirt_addon_count INTEGER NOT NULL DEFAULT 0,\s+ADD COLUMN IF NOT EXISTS shirt_addon_amount NUMERIC NOT NULL DEFAULT 0;/
  );
});

test('os CHECKs têm nome fixo e as regras do contrato', () => {
  for (const [name, [table, check]] of Object.entries(NEW_CONSTRAINTS)) {
    const statement = sql.match(new RegExp(`ALTER TABLE public\\.${table} ADD CONSTRAINT ${name}\\s+([^;]+);`));
    assert.ok(statement, `ADD CONSTRAINT ${name} ausente`);
    assert.match(statement[1], check, name);
  }
  assert.equal(sql.match(/ADD CONSTRAINT/g).length, Object.keys(NEW_CONSTRAINTS).length);
});

test('a migration é idempotente: colunas com IF NOT EXISTS e cada CHECK guardado por pg_constraint', () => {
  const addColumns = sql.match(/ADD COLUMN/g) || [];
  const guardedColumns = sql.match(/ADD COLUMN IF NOT EXISTS/g) || [];
  assert.equal(addColumns.length, 4);
  assert.equal(guardedColumns.length, addColumns.length);

  for (const [name, [table]] of Object.entries(NEW_CONSTRAINTS)) {
    assert.match(
      sql,
      new RegExp(
        `IF NOT EXISTS \\(\\s*SELECT 1 FROM pg_constraint\\s+WHERE conrelid = 'public\\.${table}'::regclass AND conname = '${name}'\\s*\\) THEN\\s+ALTER TABLE public\\.${table} ADD CONSTRAINT ${name}\\b`
      ),
      `${name} sem guarda de idempotência`
    );
  }
  assert.doesNotMatch(sql, /CREATE (TABLE|INDEX|TRIGGER|POLICY|VIEW|FUNCTION)\b/i);
});

test('a migration é só aditiva: sem DROP, ALTER COLUMN, backfill nem mudança de acesso', () => {
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

test('as colunas são documentadas e "sem camisa" é NONE no tamanho, não coluna', () => {
  for (const column of ['events.shirt_mode', 'events.shirt_addon_price', 'registrations.shirt_addon_count', 'registrations.shirt_addon_amount']) {
    assert.match(sql, new RegExp(`COMMENT ON COLUMN public\\.${column.replace('.', '\\.')} IS\\s+'`), column);
  }
  assert.match(sql, /COMMENT ON COLUMN public\.events\.shirt_mode IS\s+'[^']*NONE em athletes\.shirt_size e team_members\[\]\.shirtSize/);
  assert.match(sql, /COMMENT ON COLUMN public\.registrations\.shirt_addon_count IS\s+'[^']*NONE/);
  assert.match(migration, /-- Rollback \(em nova migration/);
  assert.match(migration, /-- Ordem de deploy: aplicar antes de publicar o código da Story 1\.38/);
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
    assert.doesNotMatch(readMigration(name), /shirt_mode|shirt_addon_|events_optional_shirt_has_price/, name);
  }
});

test('o banco aceita NONE no tamanho: CHECK em shirt_size, se houver, inclui NONE e o RPC de edição grava o valor recebido', () => {
  for (const name of allMigrations) {
    for (const [statement] of readMigration(name).matchAll(/shirt_size[^;]*\bCHECK\b[^;]*/gi)) {
      assert.match(statement, /'NONE'/, `${name}: CHECK de shirt_size sem 'NONE'`);
    }
  }

  const definitions = allMigrations.filter((name) => /CREATE OR REPLACE FUNCTION admin_update_registration_details\(/.test(readMigration(name)));
  assert.ok(definitions.length > 0);
  const latest = readMigration(definitions.at(-1));
  assert.match(latest, /v_next_shirt_size := NULLIF\(TRIM\(COALESCE\(p_shirt_size, ''\)\), ''\);/);
  assert.match(latest, /shirt_size = v_next_shirt_size/);
  assert.doesNotMatch(latest, /p_shirt_size\s+(NOT\s+)?IN\s*\(/i);
});
