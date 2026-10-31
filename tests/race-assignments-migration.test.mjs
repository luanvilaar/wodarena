import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

// Story 1.104 (AC1, AC3): migration da escala de judges por estação do
// Fitness Race (race_judge_assignments) e da gravação atômica do escopo
// (race_save_judge_assignments). A execução real foi validada em Postgres em
// memória (PGlite), fora do projeto: todas as migrations em ordem, a nova
// reaplicada sem erro, RLS ligada sem policy, o índice único recusando o
// mesmo par no mesmo escopo (inclusive no padrão, heat_id nulo), o CHECK
// recusando heat_id vazio e chave fora do formato, a função substituindo o
// escopo, sem regravar o que fica (reenvio idempotente), apagando judge que
// saiu do evento e desfazendo tudo quando uma linha falha. Aqui o contrato do
// arquivo fica travado contra regressão.

const MIGRATION = '20261101120000_race_judge_assignments.sql';
const PREVIOUS_LAST = '20261031120000_race_publication.sql';
const migrationsDir = new URL('../supabase/migrations/', import.meta.url);
const readMigration = (name) => readFileSync(new URL(name, migrationsDir), 'utf8');
const allMigrations = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();

const migration = readMigration(MIGRATION);
// Sem os comentários: o rollback documentado no cabeçalho cita DROP de propósito.
const sql = migration.replace(/--[^\n]*/g, '');

// Impressão digital das 65 migrations anteriores (nome + conteúdo, LF), tirada
// quando esta migration foi criada. Migration aplicada não se edita.
const PREVIOUS_MIGRATIONS_COUNT = 65;
const PREVIOUS_MIGRATIONS_SHA256 = '2cf38e1453a6176f34bc9e149a1ac4c44b8bee568d7b0fd744685091bc7e0027';

const tableBody = () => {
  const match = sql.match(/CREATE TABLE IF NOT EXISTS public\.race_judge_assignments \(([\s\S]*?)\n\);/);
  assert.ok(match, 'CREATE TABLE IF NOT EXISTS public.race_judge_assignments ausente');
  return match[1];
};

/** Corpo da função (entre os $$), onde ficam o DELETE e o INSERT do escopo. */
const functionBody = () => {
  const match = sql.match(/CREATE OR REPLACE FUNCTION public\.race_save_judge_assignments\([\s\S]*?AS \$\$([\s\S]*?)\$\$;/);
  assert.ok(match, 'função race_save_judge_assignments ausente');
  return match[1];
};

test('a migration existe e vem depois da última anterior (race_publication)', () => {
  assert.ok(MIGRATION > PREVIOUS_LAST);
  assert.ok(allMigrations.indexOf(PREVIOUS_LAST) >= 0);
  assert.ok(allMigrations.indexOf(MIGRATION) > allMigrations.indexOf(PREVIOUS_LAST));
});

test('AC1: tabela com IF NOT EXISTS, colunas, FKs com ON DELETE CASCADE, RLS ligada e REVOKE ALL', () => {
  const body = tableBody();
  assert.equal((sql.match(/CREATE TABLE/g) || []).length, 1, 'só uma tabela');
  assert.match(body, /event_id TEXT NOT NULL REFERENCES public\.events\(id\) ON DELETE CASCADE/);
  assert.match(body, /judge_user_id TEXT NOT NULL REFERENCES public\.users\(id\) ON DELETE CASCADE/);
  assert.match(body, /station_key TEXT NOT NULL CONSTRAINT race_judge_assignments_station_key_check CHECK \(station_key ~ '\^\[a-z0-9-\]\{1,120\}\$'\)/);
  assert.match(body, /heat_id TEXT CONSTRAINT race_judge_assignments_heat_id_check CHECK \(heat_id IS NULL OR length\(heat_id\) BETWEEN 1 AND 120\)/);
  assert.match(body, /created_by_user_id TEXT REFERENCES public\.users\(id\) ON DELETE SET NULL/);
  assert.match(body, /created_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/);
  assert.match(sql, /ALTER TABLE public\.race_judge_assignments ENABLE ROW LEVEL SECURITY;/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.race_judge_assignments FROM PUBLIC, anon, authenticated;/);
});

test('AC1: índice único com COALESCE(heat_id, \'\') e todo índice com IF NOT EXISTS', () => {
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS race_judge_assignments_scope_key\s+ON public\.race_judge_assignments \(event_id, judge_user_id, station_key, COALESCE\(heat_id, ''\)\);/);
  assert.equal((sql.match(/CREATE (UNIQUE )?INDEX(?! IF NOT EXISTS)/g) || []).length, 0);
});

test('sem policy; grants só para service_role; função SECURITY DEFINER com search_path fixo e REVOKE', () => {
  assert.doesNotMatch(sql, /CREATE POLICY|\bPOLICY\b/i);
  assert.doesNotMatch(sql, /GRANT[^;]*\bTO\b[^;]*\b(anon|authenticated|PUBLIC)\b[^;]*;/, 'nenhum GRANT para anon/authenticated/PUBLIC');
  const grants = sql.match(/GRANT [^;]*;/g) || [];
  assert.deepEqual(grants, ['GRANT EXECUTE ON FUNCTION public.race_save_judge_assignments(TEXT, TEXT, TEXT, JSONB) TO service_role;']);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.race_save_judge_assignments\(TEXT, TEXT, TEXT, JSONB\) FROM PUBLIC, anon, authenticated;/);
  assert.match(sql, /SECURITY DEFINER\s+SET search_path = public/);
  assert.equal((sql.match(/CREATE OR REPLACE FUNCTION/g) || []).length, 1, 'só a função nova');
  assert.doesNotMatch(sql, /\bTRIGGER\b/i);
  // Nenhuma função race_* existente é redefinida (Story 1.95 e F1 intocadas).
  assert.doesNotMatch(sql, /FUNCTION public\.race_(assign_judge|remove_judge|create_and_assign_judge|start_heat|rulesets_guard_locked)\b/);
});

test('AC3: a função grava o escopo numa transação, só com judge de event_judges, e apaga judge que saiu do evento', () => {
  const body = functionBody();
  assert.match(body, /RAISE EXCEPTION 'race_event_required'/);
  assert.match(body, /pg_advisory_xact_lock\(hashtext\('race_judge_assignments:' \|\| p_event_id\)\)/);
  assert.match(body, /a\.heat_id IS NOT DISTINCT FROM p_heat_id/);
  assert.match(body, /NOT EXISTS \(\s*SELECT 1 FROM event_judges ej WHERE ej\.event_id = a\.event_id AND ej\.judge_user_id = a\.judge_user_id\s*\)/);
  assert.match(body, /JOIN event_judges ej ON ej\.event_id = p_event_id AND ej\.judge_user_id = r\.item->>'judge_user_id'/);
  assert.match(body, /ON CONFLICT DO NOTHING;/);
});

test('sem DROP, UPDATE, TRUNCATE nem ALTER de tabela existente; DELETE e INSERT só dentro da função e só na tabela nova', () => {
  const outside = sql.replace(functionBody(), '').replace(/ON DELETE (CASCADE|SET NULL)/g, '');
  assert.doesNotMatch(outside, /\bDROP\b|\bDELETE\b|\bUPDATE\b|\bTRUNCATE\b|\bINSERT\b|\bRENAME\b|ALTER COLUMN|ADD COLUMN|ADD CONSTRAINT/i);
  const body = functionBody();
  assert.doesNotMatch(body, /\bDROP\b|\bUPDATE\b|\bTRUNCATE\b/i);
  for (const statement of body.match(/\b(DELETE FROM|INSERT INTO)\s+\w+/g) || []) {
    assert.match(statement, /race_judge_assignments$/, statement);
  }
  for (const statement of sql.match(/ALTER TABLE\s+[\w.]+/g) || []) {
    assert.equal(statement.replace(/\s+/g, ' '), 'ALTER TABLE public.race_judge_assignments', statement);
  }
});

test('cabeçalho com as stories, a ordem de deploy e o rollback comentado', () => {
  assert.match(migration, /^-- Súmula Fitness Race, fase F2: escala de judges por estação, para o evento\n-- todo e por onda \(Story 1\.104;/);
  assert.match(migration, /-- Ordem de deploy: aplicar depois de 20261031120000_race_publication\.sql/);
  assert.match(migration, /-- Rollback \(apaga a escala gravada\):/);
  assert.match(migration, /--   DROP FUNCTION IF EXISTS public\.race_save_judge_assignments\(TEXT, TEXT, TEXT, JSONB\);/);
  assert.match(migration, /--   DROP TABLE IF EXISTS public\.race_judge_assignments;/);
});

test('nenhuma migration anterior foi editada nem cita a tabela nova', () => {
  const previous = allMigrations.filter((name) => name < MIGRATION);
  assert.equal(previous.length, PREVIOUS_MIGRATIONS_COUNT);
  const hash = createHash('sha256');
  for (const name of previous) hash.update(`${name}\n${readMigration(name).replace(/\r\n/g, '\n')}\n`);
  assert.equal(hash.digest('hex'), PREVIOUS_MIGRATIONS_SHA256, 'migration já aplicada foi alterada');
  for (const name of previous) assert.doesNotMatch(readMigration(name), /race_judge_assignments|race_save_judge_assignments/, name);
});
