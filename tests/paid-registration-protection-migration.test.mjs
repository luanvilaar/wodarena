import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

// Story 1.40 (AC4, AC5): gatilho que protege campos de valor e titularidade de
// inscrições com pagamento. A execução real foi validada em Postgres em memória
// (PGlite), fora do projeto; aqui o contrato do arquivo fica travado contra
// regressão.

const MIGRATION = '20261014120000_protect_paid_registrations.sql';
const TRIGGER = 'trg_registrations_protect_paid_fields';
const PROTECTED_FIELDS = [
  'event_id',
  'user_id',
  'athlete_id',
  'ticket_price',
  'quantity',
  'total_paid',
  'shirt_addon_count',
  'shirt_addon_amount'
];
// Gravações legítimas das rotas de pagamento, webhooks, cancelamento, reembolso
// e edição pelo gestor: o gatilho não pode compará-las.
const FREE_FIELDS = [
  'payment_status',
  'payment_id',
  'payment_method',
  'payment_status_detail',
  'payment_error_message',
  'amount_collected',
  'service_fee_percent',
  'service_fee_amount',
  'application_fee_charged',
  'refund_status',
  'refund_amount',
  'cancellation_reason',
  'cancelled_at',
  'division_id',
  'ticket_type',
  'athlete_name',
  'athlete_email',
  'athlete_phone',
  'box',
  'gender',
  'coupon_code',
  'coupon_counted',
  'updated_at'
];

const migrationsDir = new URL('../supabase/migrations/', import.meta.url);
const readMigration = (name) => readFileSync(new URL(name, migrationsDir), 'utf8');
const allMigrations = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();

const migration = readMigration(MIGRATION);
// Sem os comentários: o cabeçalho cita DROP, UPDATE e DELETE de propósito.
const sql = migration.replace(/--[^\n]*/g, '');
const functionBody = sql.match(/CREATE OR REPLACE FUNCTION public\.protect_paid_registration_fields\(\)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/)?.[1] || '';

// Impressão digital das 52 migrations anteriores (nome + conteúdo, LF), tirada
// quando esta migration foi criada. Migration aplicada não se edita: a mudança
// entra em migration nova. Se este teste falhar, veja `git diff -- supabase/migrations`.
const PREVIOUS_MIGRATIONS_COUNT = 52;
const PREVIOUS_MIGRATIONS_SHA256 = '7143e263eac28f63d90046d038444bc9b2e9f238b3f459305401fef61a189334';

test('cria a função do gatilho sem SECURITY DEFINER, com search_path fixo e EXECUTE fora do alcance da API', () => {
  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION public\.protect_paid_registration_fields\(\)\s+RETURNS TRIGGER\s+LANGUAGE plpgsql\s+SET search_path = pg_catalog, pg_temp\s+AS \$\$/
  );
  assert.ok(functionBody.length > 0, 'corpo da função não encontrado');
  assert.doesNotMatch(sql, /SECURITY DEFINER/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.protect_paid_registration_fields\(\) FROM PUBLIC, anon, authenticated;/);
  assert.doesNotMatch(sql, /\bGRANT\b/i);
});

test('gatilho BEFORE UPDATE por linha em public.registrations, sem INSERT nem DELETE', () => {
  const triggers = sql.match(/CREATE TRIGGER[\s\S]*?;/g) || [];
  assert.equal(triggers.length, 1);
  assert.match(
    triggers[0],
    new RegExp(`^CREATE TRIGGER ${TRIGGER}\\s+BEFORE UPDATE ON public\\.registrations\\s+FOR EACH ROW\\s+EXECUTE FUNCTION public\\.protect_paid_registration_fields\\(\\);$`)
  );
  assert.doesNotMatch(triggers[0], /\b(INSERT|DELETE|TRUNCATE)\b|UPDATE OF/i);
});

test('a lista de campos protegidos é exatamente a do contrato, na ordem', () => {
  const compared = [...functionBody.matchAll(/NEW\.(\w+) IS DISTINCT FROM OLD\.(\w+)/g)];
  for (const [, left, right] of compared) assert.equal(left, right);
  assert.deepEqual(compared.map(([, field]) => field), PROTECTED_FIELDS);

  const reported = [...functionBody.matchAll(/v_field := '(\w+)';/g)].map(([, field]) => field);
  assert.deepEqual(reported, PROTECTED_FIELDS);

  for (const field of FREE_FIELDS) {
    assert.doesNotMatch(functionBody, new RegExp(`NEW\\.${field}\\b`), `${field} não pode ser comparado`);
  }
});

test('protege inscrição com payment_id ou status aprovado/em análise, exceto cancelada (NULL-safe)', () => {
  assert.match(
    functionBody,
    /v_has_payment := OLD\.payment_id IS NOT NULL\s+OR COALESCE\(OLD\.payment_status IN \('payment_approved', 'payment_in_review'\), false\);/
  );
  assert.match(
    functionBody,
    /IF NOT v_has_payment OR OLD\.payment_status IS NOT DISTINCT FROM 'payment_cancelled' THEN\s+RETURN NEW;\s+END IF;/
  );
  assert.doesNotMatch(functionBody, /payment_pending|payment_failed/);
});

test('athlete_id vazio pode ser preenchido; trocar ou esvaziar continua barrado e user_id não tem exceção', () => {
  assert.match(
    functionBody,
    /ELSIF NEW\.athlete_id IS DISTINCT FROM OLD\.athlete_id AND OLD\.athlete_id IS NOT NULL THEN/
  );
  assert.match(functionBody, /ELSIF NEW\.user_id IS DISTINCT FROM OLD\.user_id THEN\s+v_field := 'user_id';/);
  // Nenhuma consulta nem gravação em tabela: a regra só compara OLD e NEW.
  assert.doesNotMatch(functionBody, /\b(SELECT|PERFORM)\b|\bINSERT\s+INTO\b|\bUPDATE\s+(public\.)?\w+\s+SET\b|\bDELETE\s+FROM\b/i);
});

test('erro com SQLSTATE 23514 e mensagem paid_registration_protected: <campo>', () => {
  assert.match(
    functionBody,
    /RAISE EXCEPTION 'paid_registration_protected: %', v_field\s+USING ERRCODE = 'check_violation',/
  );
  assert.match(functionBody, /COLUMN = v_field,\s+CONSTRAINT = TG_NAME;/);
});

test('saída documentada para DBA: variável de transação app.allow_paid_registration_edit = on', () => {
  assert.match(
    functionBody,
    /IF current_setting\('app\.allow_paid_registration_edit', true\) = 'on' THEN\s+RETURN NEW;\s+END IF;/
  );
  assert.equal(functionBody.match(/app\.allow_paid_registration_edit/g).length, 1);
  assert.match(migration, /-- Correção manual por DBA \(saída explícita\)/);
  assert.match(migration, /--\s+SELECT set_config\('app\.allow_paid_registration_edit', 'on', true\);/);
  assert.match(sql, /COMMENT ON FUNCTION public\.protect_paid_registration_fields\(\) IS\s+'[^;]*set_config\(''app\.allow_paid_registration_edit'', ''on'', true\)/);
  assert.match(sql, new RegExp(`COMMENT ON TRIGGER ${TRIGGER} ON public\\.registrations IS\\s+'`));
});

test('a migration é idempotente e para antes de criar algo se as colunas protegidas não existirem', () => {
  assert.equal((sql.match(/CREATE OR REPLACE FUNCTION/g) || []).length, 1);
  assert.doesNotMatch(sql, /CREATE FUNCTION/);
  assert.ok(
    sql.indexOf(`DROP TRIGGER IF EXISTS ${TRIGGER} ON public.registrations;`) < sql.indexOf(`CREATE TRIGGER ${TRIGGER}`),
    'DROP TRIGGER IF EXISTS precisa vir antes do CREATE TRIGGER'
  );
  const guard = sql.match(/DO \$\$([\s\S]*?)\$\$;/)?.[1] || '';
  assert.ok(sql.indexOf('DO $$') < sql.indexOf('CREATE OR REPLACE FUNCTION'), 'pré-condição precisa vir primeiro');
  for (const column of [...PROTECTED_FIELDS, 'payment_id', 'payment_status']) {
    assert.match(guard, new RegExp(`'${column}'`), column);
  }
  assert.match(guard, /\) <> 10 THEN\s+RAISE EXCEPTION 'protect_paid_registrations: aplique antes 20261013120000_event_optional_shirt\.sql';/);
});

test('a migration não altera dados nem estrutura existente', () => {
  assert.deepEqual(sql.match(/\bDROP\b[^;]*;/gi), [`DROP TRIGGER IF EXISTS ${TRIGGER} ON public.registrations;`]);
  assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(sql, /\bUPDATE\s+(public\.)?\w+\s+SET\b/i);
  assert.doesNotMatch(sql, /\bINSERT\s+INTO\b/i);
  assert.doesNotMatch(sql, /\bALTER\s+(TABLE|FUNCTION)\b/i);
  assert.doesNotMatch(sql, /CREATE (TABLE|INDEX|POLICY|VIEW)\b/i);
  assert.doesNotMatch(sql, /ROW LEVEL SECURITY|\bPOLICY\b/i);
  assert.match(migration, /-- Ordem de deploy: aplicar as migrations em ordem de nome \(20261013120000/);
  assert.match(migration, /-- Rollback \(em nova migration\):/);
});

test('nenhuma migration anterior foi editada nem já define este gatilho', () => {
  const previous = allMigrations.filter((name) => name < MIGRATION);
  assert.equal(previous.length, PREVIOUS_MIGRATIONS_COUNT);

  const hash = createHash('sha256');
  for (const name of previous) {
    hash.update(`${name}\n${readMigration(name).replace(/\r\n/g, '\n')}\n`);
  }
  assert.equal(hash.digest('hex'), PREVIOUS_MIGRATIONS_SHA256, 'migration já aplicada foi alterada');

  for (const name of previous) {
    assert.doesNotMatch(readMigration(name), /protect_paid_registration_fields|trg_registrations_protect_paid_fields|allow_paid_registration_edit/, name);
  }
});

test('as gravações em registrations feitas pelo banco seguem compatíveis com o gatilho', () => {
  const latestDefinition = (fn) => {
    const definitions = allMigrations.filter((name) => new RegExp(`CREATE OR REPLACE FUNCTION ${fn}\\(`).test(readMigration(name)));
    assert.ok(definitions.length > 0, fn);
    const source = readMigration(definitions.at(-1));
    const start = source.indexOf(`CREATE OR REPLACE FUNCTION ${fn}(`);
    return source.slice(start, source.indexOf('$$;', source.indexOf('$$', start) + 2));
  };
  const registrationUpdates = (body) => [...body.matchAll(/UPDATE registrations\s+SET([\s\S]*?)\bWHERE\b([\s\S]*?)(?:RETURNING|;)/g)];

  // Edição pelo gestor: nunca toca valor/titular; athlete_id só é gravado quando está vazio.
  const adminUpdates = registrationUpdates(latestDefinition('admin_update_registration_details'));
  assert.equal(adminUpdates.length, 3);
  for (const [, setClause, whereClause] of adminUpdates) {
    for (const field of PROTECTED_FIELDS.filter((name) => name !== 'athlete_id')) {
      assert.doesNotMatch(setClause, new RegExp(`\\b${field}\\s*=`), field);
    }
    if (/\bathlete_id\s*=/.test(setClause)) {
      assert.match(whereClause, /AND athlete_id IS NULL/);
    }
  }

  // Contabilização de cupom: só marca coupon_counted.
  const couponUpdates = registrationUpdates(latestDefinition('apply_coupon_usage'));
  assert.equal(couponUpdates.length, 1);
  assert.match(couponUpdates[0][1], /^\s*coupon_counted = true\s*$/);
});
