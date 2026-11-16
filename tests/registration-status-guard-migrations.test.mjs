import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

// Stories 1.139 (trava de status de inscrição aprovada) e 1.140 (histórico de
// status). A execução real foi validada em Postgres em memória (PGlite), fora
// do projeto; aqui o contrato dos arquivos fica travado contra regressão.

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const GUARD = '20261116120000_protect_approved_registration_status.sql';
const HISTORY = '20261116130000_registration_status_events.sql';
const guard = read(`../supabase/migrations/${GUARD}`);
const history = read(`../supabase/migrations/${HISTORY}`);
const cli = read('../bin/registrations.mjs');

// Corpo da função, sem os comentários de cabeçalho.
const functionBody = (sql, name) => {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}()`);
  const end = sql.indexOf('$$;', start);
  assert.ok(start > 0 && end > start, name);
  return sql.slice(start, end);
};

test('as duas migrations vêm depois da última migration existente, na ordem do trava → histórico', () => {
  const files = readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter((name) => name.endsWith('.sql')).sort();
  assert.deepEqual(files.slice(-2), [GUARD, HISTORY]);
});

test('1.139: só sai de aprovada por cancelamento do gestor ou pelo próprio pagamento que aprovou', () => {
  const body = functionBody(guard, 'protect_approved_registration_status');
  assert.match(body, /IF OLD\.payment_status IS DISTINCT FROM 'payment_approved'\s+OR NEW\.payment_status IS NOT DISTINCT FROM 'payment_approved' THEN\s+RETURN NEW;/);
  assert.match(body, /NEW\.payment_status = 'payment_cancelled'\s+AND NULLIF\(btrim\(NEW\.cancelled_by\), ''\) IS NOT NULL THEN\s+RETURN NEW;/);
  assert.match(body, /OLD\.payment_id IS NOT NULL\s+AND NEW\.payment_id IS NOT DISTINCT FROM OLD\.payment_id/);
  assert.match(body, /NEW\.payment_status = 'payment_cancelled' AND NEW\.payment_status_detail IN \('refunded', 'charged_back'\)/);
  assert.match(body, /OR NEW\.payment_status = 'payment_in_review'/);
  assert.match(body, /RAISE EXCEPTION 'approved_registration_status_protected: %'/);
  assert.match(body, /ERRCODE = 'check_violation'/);
});

test('1.139: saída do DBA local à transação, função sem privilégio próprio e gatilho só na coluna de status', () => {
  const body = functionBody(guard, 'protect_approved_registration_status');
  assert.match(body, /current_setting\('app\.allow_registration_status_change', true\) = 'on'/);
  assert.match(body, /SET search_path = pg_catalog, pg_temp/);
  assert.doesNotMatch(body, /SECURITY DEFINER/);
  assert.match(guard, /REVOKE ALL ON FUNCTION public\.protect_approved_registration_status\(\) FROM PUBLIC, anon, authenticated;/);
  assert.match(guard, /DROP TRIGGER IF EXISTS trg_registrations_protect_approved_status ON public\.registrations;\s+CREATE TRIGGER trg_registrations_protect_approved_status\s+BEFORE UPDATE OF payment_status ON public\.registrations\s+FOR EACH ROW/);
});

test('1.139: a migration não altera dados nem cria tabela, policy ou grant', () => {
  assert.doesNotMatch(guard, /^\s*(UPDATE|INSERT|DELETE|ALTER TABLE|CREATE TABLE|CREATE POLICY|GRANT)\b/im);
  assert.match(guard, /Ordem de deploy: aplicar DEPOIS de publicar o código da Story 1\.137/);
});

test('1.140: tabela de histórico fechada (RLS sem policy, sem acesso de anon/authenticated) e sem chave estrangeira', () => {
  assert.match(history, /CREATE TABLE IF NOT EXISTS public\.registration_status_events \(/);
  for (const column of ['registration_id TEXT NOT NULL', 'event_id TEXT', 'old_status TEXT', 'new_status TEXT', 'old_payment_id TEXT', 'new_payment_id TEXT', 'old_status_detail TEXT', 'new_status_detail TEXT', 'old_cancelled_by TEXT', 'new_cancelled_by TEXT', 'changed_at TIMESTAMPTZ NOT NULL DEFAULT now()']) {
    assert.ok(history.includes(column), column);
  }
  assert.doesNotMatch(history, /REFERENCES/);
  assert.match(history, /ALTER TABLE public\.registration_status_events ENABLE ROW LEVEL SECURITY;/);
  assert.match(history, /REVOKE ALL ON TABLE public\.registration_status_events FROM anon, authenticated;/);
  assert.doesNotMatch(history, /CREATE POLICY|GRANT /);
});

test('1.140: o gatilho grava a criação e as mudanças de status, pagamento, detalhe e autor do cancelamento', () => {
  const body = functionBody(history, 'log_registration_status_change');
  assert.match(body, /SECURITY DEFINER/);
  assert.match(body, /SET search_path = public, pg_catalog, pg_temp/);
  assert.match(body, /IF TG_OP = 'INSERT' THEN/);
  for (const column of ['payment_status', 'payment_id', 'payment_status_detail', 'cancelled_by']) {
    assert.match(body, new RegExp(`NEW\\.${column} IS DISTINCT FROM OLD\\.${column}`), column);
  }
  assert.match(body, /RETURN NULL;/);
  assert.match(history, /REVOKE ALL ON FUNCTION public\.log_registration_status_change\(\) FROM PUBLIC, anon, authenticated;/);
  assert.match(history, /CREATE TRIGGER trg_registrations_log_status_change\s+AFTER INSERT OR UPDATE ON public\.registrations\s+FOR EACH ROW/);
});

test('1.140: a CLI de inscrições lê o histórico por inscrição ou por evento', () => {
  assert.match(cli, /npm run registrations:cli -- history --registration REG_ID/);
  assert.match(cli, /\.from\('registration_status_events'\)/);
  assert.match(cli, /query\.eq\('registration_id', args\.registration\) : query\.eq\('event_id', args\.event\)/);
  assert.match(cli, /if \(command === 'history'\)/);
});
