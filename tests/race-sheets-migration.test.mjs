import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

// Story 1.94 (AC1 a AC3): migration das sete tabelas da súmula Fitness Race.
// A execução real foi validada em Postgres em memória (PGlite), fora do
// projeto: todas as migrations em ordem, a nova reaplicada sem erro, os
// índices únicos recusando duplicata e o CHECK de time_source recusando
// "chip". Aqui o contrato do arquivo fica travado contra regressão.

const MIGRATION = '20261030120000_race_sheets.sql';
const PREVIOUS_LAST = '20261028120000_service_fee_payer.sql';
const migrationsDir = new URL('../supabase/migrations/', import.meta.url);
const readMigration = (name) => readFileSync(new URL(name, migrationsDir), 'utf8');
const allMigrations = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();

const migration = readMigration(MIGRATION);
// Sem os comentários: o rollback documentado no cabeçalho cita DROP de propósito.
const sql = migration.replace(/--[^\n]*/g, '');

// Impressão digital das 61 migrations anteriores (nome + conteúdo, LF), tirada
// quando esta migration foi criada. Migration aplicada não se edita: a mudança
// entra em migration nova. Se este teste falhar, veja `git diff -- supabase/migrations`.
const PREVIOUS_MIGRATIONS_COUNT = 61;
const PREVIOUS_MIGRATIONS_SHA256 = 'c5ebbcac2be46f51c22b9ed08b2ec4593267c3b7ef31e64c420d8b4a47e9bcf3';

const TABLES = ['race_rulesets', 'race_runs', 'race_attempts', 'race_attempt_events', 'race_infractions', 'race_decisions', 'race_heat_marks'];

/** Corpo do CREATE TABLE de uma tabela (até o `);` que fecha). */
const tableBody = (table) => {
  const match = sql.match(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table} \\(([\\s\\S]*?)\\n\\);`));
  assert.ok(match, `CREATE TABLE IF NOT EXISTS public.${table} ausente`);
  return match[1];
};

test('a migration existe e vem depois da última migration anterior (service_fee_payer)', () => {
  assert.ok(MIGRATION > PREVIOUS_LAST);
  assert.ok(allMigrations.indexOf(PREVIOUS_LAST) >= 0);
  assert.ok(allMigrations.indexOf(MIGRATION) > allMigrations.indexOf(PREVIOUS_LAST));
});

test('as sete tabelas com IF NOT EXISTS, RLS ligada e REVOKE ALL de PUBLIC, anon e authenticated', () => {
  for (const table of TABLES) {
    tableBody(table);
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`), `RLS de ${table}`);
  }
  assert.equal((sql.match(/CREATE TABLE/g) || []).length, TABLES.length, 'só as sete tabelas');
  assert.equal((sql.match(/CREATE TABLE IF NOT EXISTS/g) || []).length, TABLES.length);
  const revoke = sql.match(/REVOKE ALL ON TABLE([\s\S]*?)FROM PUBLIC, anon, authenticated;/);
  assert.ok(revoke, 'REVOKE ALL ausente');
  assert.deepEqual(revoke[1].split(',').map((item) => item.trim()).sort(), TABLES.map((table) => `public.${table}`).sort());
});

test('sem policy, sem GRANT para anon/authenticated, sem função e sem tocar em tabela existente', () => {
  assert.doesNotMatch(sql, /CREATE POLICY|\bPOLICY\b/i);
  assert.doesNotMatch(sql, /\bGRANT\b/i);
  assert.doesNotMatch(sql, /CREATE (OR REPLACE )?FUNCTION|\bTRIGGER\b|SECURITY DEFINER/i);
  // `ON DELETE` das chaves estrangeiras não é comando: sai antes de procurar DELETE.
  const statements = sql.replace(/ON DELETE (CASCADE|SET NULL)/g, '');
  assert.doesNotMatch(statements, /\bDROP\b|\bDELETE\b|\bUPDATE\b|\bTRUNCATE\b|\bINSERT\b|\bRENAME\b|ALTER COLUMN|ADD COLUMN|ADD CONSTRAINT/i);
  for (const statement of sql.match(/ALTER TABLE\s+[\w.]+/g) || []) {
    assert.ok(TABLES.some((table) => statement.replace(/\s+/g, ' ') === `ALTER TABLE public.${table}`), statement);
  }
  // Tabelas antigas só aparecem como alvo de chave estrangeira.
  for (const table of ['events', 'divisions', 'athletes', 'users', 'scores', 'scoresheets', 'event_judges', 'registrations']) {
    for (const mention of sql.match(new RegExp(`public\\.${table}\\b[^\\n]*`, 'g')) || []) {
      assert.match(sql.slice(Math.max(0, sql.indexOf(mention) - 40), sql.indexOf(mention)), /REFERENCES\s*$/, `public.${table} fora de REFERENCES`);
    }
  }
  assert.match(sql, /CREATE INDEX IF NOT EXISTS|CREATE UNIQUE INDEX IF NOT EXISTS/);
  assert.equal((sql.match(/CREATE (UNIQUE )?INDEX(?! IF NOT EXISTS)/g) || []).length, 0, 'todo índice com IF NOT EXISTS');
});

test('invariantes (AC3): corrida e tentativa ativas únicas, log com (attempt_id, seq) e id do aparelho, source_key, largada, versão', () => {
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS race_runs_one_active_per_athlete\s+ON public\.race_runs \(event_id, athlete_id\) WHERE status <> 'cancelled';/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS race_attempts_one_active_per_station\s+ON public\.race_attempts \(run_id, station_id\) WHERE status <> 'cancelled';/);
  const events = tableBody('race_attempt_events');
  assert.match(events, /PRIMARY KEY \(attempt_id, seq\)/);
  assert.match(events, /UNIQUE \(attempt_id, client_event_id\)/);
  assert.match(events, /seq INTEGER NOT NULL CHECK \(seq >= 0\)/);
  assert.match(events, /device_at TIMESTAMPTZ/);
  assert.match(events, /clock_offset_ms BIGINT/);
  assert.match(tableBody('race_infractions'), /UNIQUE \(run_id, source_key\)/);
  assert.match(tableBody('race_heat_marks'), /PRIMARY KEY \(event_id, heat_id\)/);
  assert.match(tableBody('race_rulesets'), /UNIQUE \(event_id, version\)/);
});

test('status e origem do tempo: time_source só sheet ou manual (sem chip, D8); estados de corrida, tentativa e infração', () => {
  const runs = tableBody('race_runs');
  assert.match(runs, /time_source TEXT CONSTRAINT race_runs_time_source_check CHECK \(time_source IS NULL OR time_source IN \('sheet', 'manual'\)\)/);
  assert.doesNotMatch(migration, /'chip'/);
  assert.match(runs, /CHECK \(status IN \('racing', 'finished', 'dnf', 'disqualified', 'cancelled'\)\)/);
  assert.match(tableBody('race_attempts'), /CHECK \(status IN \('waiting', 'running', 'done_pending_release', 'released', 'exited_incomplete', 'redo', 'cancelled'\)\)/);
  const infractions = tableBody('race_infractions');
  assert.match(infractions, /CHECK \(kind IN \('warning', 'penalty', 'redo', 'dq_proposal'\)\)/);
  assert.match(infractions, /CHECK \(status IN \('pending', 'confirmed', 'revoked', 'cancelled', 'rejected'\)\)/);
  assert.match(infractions, /CHECK \(origin IN \('engine', 'judge', 'manager'\)\)/);
  assert.match(infractions, /decided_at TIMESTAMPTZ/);
  // Revisão do @data-engineer (M3): judge e system previstos; decidir continua sendo do gestor dono ou owner, no servidor.
  assert.match(tableBody('race_decisions'), /actor_role TEXT NOT NULL CONSTRAINT race_decisions_actor_role_check CHECK \(actor_role IN \('judge', 'manager', 'owner', 'system'\)\)/);
  assert.match(tableBody('race_rulesets'), /preset TEXT NOT NULL CONSTRAINT race_rulesets_preset_check CHECK \(preset IN \('2025_26', '2026_27', 'custom'\)\)/);
});

test('revisão do @data-engineer: índices de apoio (M1, L4), CHECKs que vão crescer com nome fixo (L7), JSON e tamanho de texto (L6)', () => {
  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_race_attempts_run_id ON public\.race_attempts \(run_id\);/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_race_runs_athlete_id ON public\.race_runs \(athlete_id\);/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_race_attempts_athlete_id ON public\.race_attempts \(athlete_id\);/);
  const named = {
    race_rulesets: ['race_rulesets_preset_check'],
    race_runs: ['race_runs_status_check', 'race_runs_time_source_check'],
    race_attempts: ['race_attempts_station_kind_check', 'race_attempts_status_check'],
    race_infractions: ['race_infractions_kind_check', 'race_infractions_status_check', 'race_infractions_origin_check', 'race_infractions_label_length', 'race_infractions_note_length'],
    race_decisions: ['race_decisions_action_check', 'race_decisions_actor_role_check', 'race_decisions_reason_length', 'race_decisions_before_check', 'race_decisions_after_check']
  };
  for (const [table, constraints] of Object.entries(named)) {
    for (const name of constraints) assert.match(tableBody(table), new RegExp(`CONSTRAINT ${name} CHECK`), `${table}: ${name}`);
  }
  const decisions = tableBody('race_decisions');
  assert.match(decisions, /before JSONB CONSTRAINT race_decisions_before_check CHECK \(before IS NULL OR jsonb_typeof\(before\) = 'object'\)/);
  assert.match(decisions, /after JSONB CONSTRAINT race_decisions_after_check CHECK \(after IS NULL OR jsonb_typeof\(after\) = 'object'\)/);
  assert.match(decisions, /reason TEXT CONSTRAINT race_decisions_reason_length CHECK \(reason IS NULL OR char_length\(reason\) <= 1000\)/);
  const infractions = tableBody('race_infractions');
  assert.match(infractions, /note TEXT CONSTRAINT race_infractions_note_length CHECK \(note IS NULL OR char_length\(note\) <= 1000\)/);
  assert.match(infractions, /label TEXT NOT NULL DEFAULT '' CONSTRAINT race_infractions_label_length CHECK \(char_length\(label\) <= 200\)/);
  assert.equal(new Set(sql.match(/CONSTRAINT \w+/g)).size, (sql.match(/CONSTRAINT \w+/g) || []).length, 'nomes de constraint sem repetição');
});

test('o cabeçalho traz as stories, a ordem de deploy e o rollback comentado das sete tabelas', () => {
  assert.match(migration, /^-- Súmula Fitness Race, fase F1: banco da corrida \(Story 1\.94; base das\n-- Stories 1\.95 a 1\.99\)\./);
  assert.match(migration, /-- Ordem de deploy: aplicar depois de 20261028120000_service_fee_payer\.sql/);
  assert.match(migration, /-- Rollback \(só se nada foi gravado, porque apaga as corridas e o log\):/);
  for (const table of TABLES) assert.match(migration, new RegExp(`--   DROP TABLE IF EXISTS public\\.${table};`));
});

test('nenhuma migration anterior foi editada nem cita as tabelas novas', () => {
  const previous = allMigrations.filter((name) => name < MIGRATION);
  assert.equal(previous.length, PREVIOUS_MIGRATIONS_COUNT);
  const hash = createHash('sha256');
  for (const name of previous) hash.update(`${name}\n${readMigration(name).replace(/\r\n/g, '\n')}\n`);
  assert.equal(hash.digest('hex'), PREVIOUS_MIGRATIONS_SHA256, 'migration já aplicada foi alterada');
  for (const name of previous) assert.doesNotMatch(readMigration(name), /\brace_(rulesets|runs|attempts|attempt_events|infractions|decisions|heat_marks)\b/, name);
});

test('Functional Fitness intocado: a rota e o acesso da súmula de FF não citam as tabelas nem a rota novas', () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
  for (const file of ['../src/app/api/sheets/route.ts', '../src/lib/serverSheetAccess.ts', '../src/lib/serverScoresheets.ts', '../src/lib/scoresheet.ts']) {
    assert.doesNotMatch(read(file), /race_|race-sheets|serverRaceSheet/, file);
  }
  assert.match(read('../src/lib/serverSheetAccess.ts'), /export const isPresentialEventType = \(eventType: unknown\) => !eventType \|\| eventType === 'functional_fitness';/);
});
