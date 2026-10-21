import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

// Story 1.59 (AC1, AC14): migration aditiva e idempotente da marca de ausência
// na súmula (scoresheets.absent) e da ação "absent" no histórico. A execução
// real foi validada em Postgres em memória (PGlite), fora do projeto; aqui o
// contrato do arquivo fica travado contra regressão.

const MIGRATION = '20261021120000_scoresheet_absent.sql';
const SCORESHEETS_MIGRATION = '20261017120000_scoresheets.sql';
const migrationsDir = new URL('../supabase/migrations/', import.meta.url);
const readMigration = (name) => readFileSync(new URL(name, migrationsDir), 'utf8');
const allMigrations = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();

const migration = readMigration(MIGRATION);
// Sem os comentários: o rollback documentado no cabeçalho cita DROP e DELETE de propósito.
const sql = migration.replace(/--[^\n]*/g, '');

// Impressão digital das 57 migrations anteriores (nome + conteúdo, LF), tirada
// quando esta migration foi criada. Migration aplicada não se edita: a mudança
// entra em migration nova. Se este teste falhar, veja `git diff -- supabase/migrations`.
const PREVIOUS_MIGRATIONS_COUNT = 57;
const PREVIOUS_MIGRATIONS_SHA256 = 'f760846e5d970f210ec171daad233a153301a1d2aaf2d206ac8e4f7c81bad5ca';

const ACTIONS = ['opened', 'submitted', 'returned', 'corrected', 'cancelled', 'manual_override', 'absent'];

test('a migration existe e vem depois da migration da súmula na ordem de nome', () => {
  assert.ok(MIGRATION > SCORESHEETS_MIGRATION);
  assert.ok(allMigrations.indexOf(SCORESHEETS_MIGRATION) >= 0);
  assert.ok(allMigrations.indexOf(MIGRATION) > allMigrations.indexOf(SCORESHEETS_MIGRATION));
});

test('scoresheets ganha absent BOOLEAN NOT NULL DEFAULT false, com IF NOT EXISTS e comentário', () => {
  assert.match(sql, /ALTER TABLE public\.scoresheets ADD COLUMN IF NOT EXISTS absent BOOLEAN NOT NULL DEFAULT false;/);
  assert.equal((sql.match(/ADD COLUMN/g) || []).length, 1);
  assert.equal((sql.match(/\bDEFAULT\b/g) || []).length, 1, 'só o default false da coluna nova');
  const comment = sql.match(/COMMENT ON COLUMN public\.scoresheets\.absent IS\s+'([^']{80,})'/);
  assert.ok(comment, 'COMMENT ON COLUMN ausente');
  assert.match(comment[1], /Story 1\.59/);
  assert.match(comment[1], /result_status = absent/);
});

test('o CHECK do histórico é localizado em pg_constraint, removido e recriado com nome fixo e os sete valores', () => {
  assert.match(sql, /SELECT conname FROM pg_constraint\s+WHERE conrelid = 'public\.scoresheet_reviews'::regclass\s+AND contype = 'c'/);
  assert.match(sql, /pg_get_constraintdef\(oid\) LIKE '%manual_override%'/);
  assert.match(sql, /EXECUTE format\('ALTER TABLE public\.scoresheet_reviews DROP CONSTRAINT %I', existing_check\);/);
  const recreated = sql.match(/ALTER TABLE public\.scoresheet_reviews ADD CONSTRAINT scoresheet_reviews_action_check\s+CHECK \(action IN \(([^)]+)\)\);/);
  assert.ok(recreated, 'ADD CONSTRAINT scoresheet_reviews_action_check ausente');
  assert.deepEqual(recreated[1].split(',').map((value) => value.trim().replace(/'/g, '')), ACTIONS);
  assert.equal((sql.match(/ADD CONSTRAINT/g) || []).length, 1);
});

test('a migration é só aditiva: sem tabela nova, sem dado mexido e sem mudança de RLS, policy, grant ou scores', () => {
  assert.doesNotMatch(sql, /CREATE (TABLE|INDEX|TRIGGER|POLICY|VIEW|FUNCTION)\b/i);
  assert.doesNotMatch(sql, /\bTRUNCATE\b|\bDELETE\b|\bUPDATE\b|\bINSERT\b/i);
  assert.doesNotMatch(sql, /ALTER COLUMN|\bRENAME\b/i);
  assert.doesNotMatch(sql, /\bGRANT\b|\bREVOKE\b|ROW LEVEL SECURITY|\bPOLICY\b/i);
  assert.doesNotMatch(sql, /DROP (TABLE|COLUMN)/i);
  // Só scoresheets e scoresheet_reviews são tocadas; scores, athletes, registrations e divisions não.
  for (const table of sql.match(/ALTER TABLE\s+[\w.]+/g)) {
    assert.ok(['ALTER TABLE public.scoresheets', 'ALTER TABLE public.scoresheet_reviews'].includes(table.replace(/\s+/g, ' ')), table);
  }
  assert.doesNotMatch(sql, /public\.(scores|athletes|registrations|divisions)\b/);
});

test('o cabeçalho traz ordem de deploy e o rollback com o aviso sobre as linhas absent e a coluna apagada', () => {
  assert.match(migration, /-- Ordem de deploy: depois de 20261017120000_scoresheets\.sql/);
  assert.match(migration, /-- Rollback \(apaga a marca de ausência das súmulas\):/);
  assert.match(migration, /As linhas com action = 'absent' em scoresheet_reviews precisam ser tratadas\n--   antes de restaurar o CHECK antigo/);
  assert.match(migration, /--     DELETE FROM public\.scoresheet_reviews WHERE action = 'absent';/);
  assert.match(migration, /--     ALTER TABLE public\.scoresheet_reviews DROP CONSTRAINT IF EXISTS scoresheet_reviews_action_check;/);
  assert.match(migration, /CHECK \(action IN \('opened', 'submitted', 'returned', 'corrected', 'cancelled', 'manual_override'\)\);/);
  assert.match(migration, /--     ALTER TABLE public\.scoresheets DROP COLUMN IF EXISTS absent;/);
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
    assert.doesNotMatch(readMigration(name), /scoresheets\.absent|ADD COLUMN IF NOT EXISTS absent\b|scoresheet_reviews_action_check/, name);
  }
});
