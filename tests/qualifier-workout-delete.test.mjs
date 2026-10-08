import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Story 1.37: prova de Qualifier travada só com resultado ativo e exclusão de
// prova com submissões pelo gestor organizador.

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const migration = read('../supabase/migrations/20261008120000_qualifier_workout_active_lock_and_delete.sql');
const persistenceRoute = read('../src/app/api/admin/persistence/route.ts');
const resend = read('../src/lib/resend.ts');
const appContext = read('../src/context/AppContext.tsx');
const adminPage = read('../src/app/admin/page.tsx');
const cli = read('../bin/qualifier.mjs');
const workoutEditSource = read('../src/lib/workoutEdit.ts');
const workoutEditCompiled = ts.transpileModule(workoutEditSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
const {
  getWorkoutDeleteConfirmationText,
  hasQualifierWorkoutSubmissions,
  isQualifierWorkoutLocked
} = await import(`data:text/javascript;base64,${Buffer.from(workoutEditCompiled).toString('base64')}`);

const functionBlock = (name) => migration.match(new RegExp(`CREATE OR REPLACE FUNCTION ${name}\\([\\s\\S]*?\\n\\$\\$;`))?.[0] || '';

const RPC_ERROR_CODES = [
  'qualifier_workout_delete_not_allowed',
  'qualifier_workout_delete_confirmation_invalid',
  'qualifier_workout_delete_justification_required',
  'qualifier_manager_access_expired',
  'qualifier_workout_not_found',
  'qualifier_event_not_found',
  'qualifier_event_required'
];

test('a workout is locked only by submissions with a result in play', () => {
  assert.equal(isQualifierWorkoutLocked({ submissionCount: 1, activeCount: 0, reviewedCount: 0 }), false);
  assert.equal(isQualifierWorkoutLocked({ submissionCount: 2, activeCount: 1, reviewedCount: 0 }), true);
  assert.equal(hasQualifierWorkoutSubmissions({ submissionCount: 1, activeCount: 0, reviewedCount: 0 }), true);
  assert.equal(hasQualifierWorkoutSubmissions({ submissionCount: 0, activeCount: 0, reviewedCount: 0 }), false);
  assert.equal(hasQualifierWorkoutSubmissions(undefined), false);
});

test('the delete confirmation is the workout code, or the name when the code is empty', () => {
  assert.equal(getWorkoutDeleteConfirmationText({ code: ' PROVA 1 ', name: 'Cardio Burn' }), 'PROVA 1');
  assert.equal(getWorkoutDeleteConfirmationText({ code: '', name: ' Cardio Burn ' }), 'Cardio Burn');
  assert.match(functionBlock('qualifier_delete_workout'), /COALESCE\(NULLIF\(trim\(v_workout\.code\), ''\), trim\(v_workout\.name\)\)/);
});

test('the workout trigger keeps identity locked but relaxes the rules while only resubmissions are pending', () => {
  const block = functionBlock('qualifier_protect_workout_after_submission');
  assert.match(block, /TG_OP = 'DELETE'[\s\S]*EXISTS \(SELECT 1 FROM score_submissions WHERE workout_id = OLD\.id\)[\s\S]*qualifier_workout_has_submissions/);
  assert.match(block, /NEW\.event_id IS DISTINCT FROM OLD\.event_id[\s\S]*status <> 'awaiting_resubmission'[\s\S]*NEW\.division_id IS DISTINCT FROM OLD\.division_id/);
  assert.match(block, /NEW\.submission_closes_at < OLD\.submission_closes_at[\s\S]*qualifier_workout_deadline_extend_only/);
  assert.match(block, /ARRAY\['amrap', 'reps', 'maxweight', 'distance', 'points'\]/);
  assert.match(block, /status IN \('validated', 'penalized', 'rejected'\)[\s\S]*qualifier_workout_type_locked_reviewed/);
  assert.doesNotMatch(migration, /DROP TRIGGER|CREATE TRIGGER/);
});

test('history immutability only opens for DELETE inside the event or workout purge transaction', () => {
  for (const [functionName, errorName] of [
    ['qualifier_prevent_review_mutation', 'qualifier_review_history_is_immutable'],
    ['qualifier_prevent_submission_version_mutation', 'qualifier_submission_version_history_is_immutable']
  ]) {
    const block = functionBlock(functionName);
    assert.match(block, /TG_OP = 'DELETE'/);
    assert.match(block, /current_setting\('app\.qualifier_event_purge', true\) = 'on'/);
    assert.match(block, /current_setting\('app\.qualifier_workout_purge', true\) = 'on'/);
    assert.match(block, new RegExp(`RAISE EXCEPTION '${errorName}'`));
  }
});

test('qualifier_delete_workout is organizer-only, confirmed, justified and removes everything in one transaction', () => {
  const block = functionBlock('qualifier_delete_workout');
  assert.match(block, /SECURITY DEFINER\nSET search_path = pg_catalog, public, pg_temp/);
  assert.match(block, /v_actor\.role IS DISTINCT FROM 'manager'[\s\S]*?qualifier_workout_delete_not_allowed/);
  assert.match(block, /v_event\.organizer_id IS DISTINCT FROM v_actor\.id[\s\S]*?qualifier_workout_delete_not_allowed/);
  assert.match(block, /service_valid_until < timezone\('America\/Fortaleza', NOW\(\)\)::DATE[\s\S]*?qualifier_manager_access_expired/);
  assert.match(block, /FROM workouts\s+WHERE id = p_workout_id AND event_id = v_event\.id\s+FOR UPDATE/);
  assert.match(block, /qualifier_workout_delete_confirmation_invalid/);
  assert.match(block, /length\(p_justification\) > 2000[\s\S]*?qualifier_workout_delete_justification_required/);
  assert.match(block, /PERFORM 1 FROM score_submissions WHERE workout_id = v_workout\.id FOR UPDATE/);
  assert.match(block, new RegExp([
    "set_config\\('app\\.qualifier_workout_purge', 'on', true\\)",
    'DELETE FROM contestations',
    'DELETE FROM score_submission_reviews',
    'DELETE FROM score_submission_versions',
    'DELETE FROM scores WHERE workout_id = v_workout\\.id',
    'DELETE FROM score_submissions WHERE id = ANY \\(v_submission_ids\\)',
    "set_config\\('app\\.qualifier_workout_purge', 'off', true\\)",
    'INSERT INTO qualifier_workout_deletions',
    'DELETE FROM workouts WHERE id = v_workout\\.id'
  ].join('[\\s\\S]*')));
  assert.match(block, /'registrationIds', to_jsonb\(v_registration_ids\)/);
  assert.doesNotMatch(migration, /EXCEPTION WHEN OTHERS/);
  assert.match(migration, /REVOKE ALL ON FUNCTION qualifier_delete_workout\(TEXT, TEXT, TEXT, TEXT, TEXT\) FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION qualifier_delete_workout\(TEXT, TEXT, TEXT, TEXT, TEXT\) TO service_role/);
});

test('the deletion audit is private to the server and follows the event purge', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS qualifier_workout_deletions \(/);
  assert.match(migration, /event_id TEXT NOT NULL REFERENCES events\(id\) ON DELETE CASCADE/);
  assert.match(migration, /removed_submissions JSONB NOT NULL/);
  assert.match(migration, /ALTER TABLE qualifier_workout_deletions ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE qualifier_workout_deletions FROM PUBLIC, anon, authenticated/);
});

test('the persistence route sends qualifier workouts with submissions to the organizer-only deletion', () => {
  const deleteBlock = persistenceRoute.match(/case 'deleteWorkout': \{[\s\S]*?\n {6}\}/)?.[0] || '';
  assert.match(deleteBlock, /isQualifierEvent\(event\.event_type\)[\s\S]*loadQualifierWorkoutLocks\(supabaseAdmin, \[payload\.workoutId\]\)[\s\S]*hasQualifierWorkoutSubmissions\([\s\S]*deleteQualifierWorkoutWithSubmissions\(/);
  // Provas sem submissões seguem a exclusão simples de sempre.
  assert.match(deleteBlock, /from\('workouts'\)\.delete\(\)\.eq\('id', payload\.workoutId\)[\s\S]*qualifierWorkoutLockErrorResponse\(error\)/);

  const helper = persistenceRoute.match(/const deleteQualifierWorkoutWithSubmissions = async \([\s\S]*?\n\};/)?.[0] || '';
  assert.match(helper, /actor\.role !== 'manager' \|\| event\.organizer_id !== actor\.id[\s\S]*?status: 403/);
  // Painel com travas desatualizadas (confirmação simples): pede a confirmação reforçada.
  assert.match(helper, /if \(!confirmation && !justification\) \{[\s\S]*?qualifier_workout_delete_confirmation_required[\s\S]*?status: 409/);
  assert.match(helper, /rpc\('qualifier_delete_workout', \{[\s\S]*p_actor_id: actor\.id[\s\S]*p_confirmation: confirmation[\s\S]*p_justification: justification/);
  assert.match(helper, /qualifierWorkoutDeleteErrorResponse\(error\)[\s\S]*notifyAthletesOfDeletedWorkout\(/);
  assert.match(persistenceRoute, /sendQualifierWorkoutDeletedEmails\(\{ recipients, \.\.\.details \}\)/);

  for (const code of RPC_ERROR_CODES) {
    assert.match(migration, new RegExp(`RAISE EXCEPTION '${code}'`));
    assert.match(persistenceRoute, new RegExp(`${code}: \\{ error: `));
  }
});

test('lock state counts active results separately from all submissions', () => {
  const loader = persistenceRoute.match(/const loadQualifierWorkoutLocks = async [\s\S]*?\n\};/)?.[0] || '';
  assert.match(loader, /\.neq\('status', 'awaiting_resubmission'\)/);
  assert.match(loader, /submissionCount: submissions\.count \?\? 0/);
  assert.match(loader, /activeCount: active\.count \?\? 0/);
  assert.match(workoutEditSource, /isQualifierWorkoutLocked = \(lock\?: QualifierWorkoutLock \| null\) => Boolean\(lock && lock\.activeCount > 0\)/);
});

test('athletes get one e-mail each, sent in Resend batches, with the escaped reason', () => {
  const sender = resend.match(/export async function sendQualifierWorkoutDeletedEmails[\s\S]*?\n\}\n/)?.[0] || '';
  assert.match(resend, /const RESEND_BATCH_LIMIT = 100;/);
  assert.match(sender, /https:\/\/api\.resend\.com\/emails\/batch/);
  assert.match(sender, /const buildEmail = \(recipient: \{ to: string; athleteName: string \}\) => \(\{[\s\S]*?to: recipient\.to/);
  assert.match(sender, /await sendGroup\(index, Math\.min\(index \+ RESEND_BATCH_LIMIT, params\.recipients\.length\), 'lote'\)/);
  assert.doesNotMatch(sender, /failed \+= chunk\.length/);
  // Nada de validação permissiva: o isolamento do inválido é feito por bisseção.
  assert.doesNotMatch(sender, /x-batch-validation/i);
  assert.match(resend, /const safeJustification = escapeHtml\(params\.justification \|\| ''\);[\s\S]*<h1>Prova removida<\/h1>/);
  assert.match(resend, /envie um novo vídeo e resultado/);
});

test('the admin opens a strong confirmation before deleting a qualifier workout with submissions', () => {
  assert.match(adminPage, /onClick=\{\(\) => requestDeleteWorkout\(wod\)\}/);
  assert.doesNotMatch(adminPage, /disabled=\{isQualifierWorkoutLocked\(qualifierWorkoutLocks\[wod\.id\]\)\}/);
  assert.doesNotMatch(adminPage, /Provas que já receberam submissões não podem ser excluídas/);
  assert.match(adminPage, /const requestDeleteWorkout = \(workout: Workout\) => \{\n\s+if \(hasQualifierWorkoutSubmissions\(qualifierWorkoutLocks\[workout\.id\]\)\)/);

  assert.match(adminPage, /aria-labelledby="delete-workout-title"/);
  assert.match(adminPage, /Todos os resultados desta prova serão perdidos/);
  assert.match(adminPage, /que enviar novamente/);
  assert.match(adminPage, /checked=\{deleteWorkoutAcknowledged\}/);
  assert.match(adminPage, /id="delete-workout-justification"/);
  assert.match(adminPage, /const confirmationText = getWorkoutDeleteConfirmationText\(workoutPendingDeletion\);/);
  assert.match(adminPage, /&& deleteWorkoutAcknowledged\n\s+&& justification\.length > 0[\s\S]*?&& deleteWorkoutConfirmation\.trim\(\) === confirmationText;/);
  assert.match(adminPage, /deleteWorkout\(selectedEventToManage\.id, workout\.id, \{\n\s+confirmation: deleteWorkoutConfirmation\.trim\(\),\n\s+justification: deleteWorkoutJustification\.trim\(\)\n\s+\}\)/);
  assert.match(adminPage, /editingLock\?\.activeCount/);
  // Recusa do servidor recarrega as travas (submissão pode ter chegado depois do carregamento).
  assert.match(adminPage, /\}, \[activeEventTab, selectedQualifierEventId, qualifierLocksVersion\]\);/);
  assert.ok((adminPage.match(/setQualifierLocksVersion\(version => version \+ 1\)/g) || []).length >= 3);

  assert.match(appContext, /qualifierConfirmation\?: QualifierWorkoutDeleteConfirmation\n\s+\) => Promise<QualifierWorkoutDeleteResult \| null>;/);
  assert.match(appContext, /adminPersist\('deleteWorkout', \{ eventId, workoutId, \.\.\.qualifierConfirmation \}\)/);
});

test('the qualifier CLI deletes a workout through the same RPC (CLI First)', () => {
  assert.match(cli, /if \(area === 'workout'\) return workout\(supabase, command, args\);/);
  assert.match(cli, /requireArgs\(args, \['actor', 'event', 'workout', 'confirm', 'justification'\]\)/);
  assert.match(cli, /rpc\('qualifier_delete_workout', \{[\s\S]*p_confirmation: String\(args\.confirm\)\.trim\(\)/);
  assert.match(cli, /workout delete --actor MANAGER_ID --event EVENT_ID --workout WORKOUT_ID --confirm/);
});

// Follow-up da revisão QA da Story 1.37: busca das inscrições em lotes e
// bisseção do lote recusado pelo Resend para isolar o e-mail inválido.

// Os testes rodam o código real; só os intervalos são encurtados no fonte
// carregado (produção continua com 500 ms entre requisições e até 5 s no 429).
const loadResendSender = async ({ intervalMs = 0 } = {}) => {
  assert.match(resend, /const RESEND_REQUEST_INTERVAL_MS = 500;/);
  assert.match(resend, /const RESEND_RATE_LIMIT_RETRY_MAX_MS = 5000;/);
  const source = resend
    .replace(/^import .*$/gm, '')
    .replace('const RESEND_REQUEST_INTERVAL_MS = 500;', `const RESEND_REQUEST_INTERVAL_MS = ${intervalMs};`)
    .replace('const RESEND_RATE_LIMIT_RETRY_MAX_MS = 5000;', 'const RESEND_RATE_LIMIT_RETRY_MAX_MS = 0;');
  const compiled = ts.transpileModule(
    `const getContestationStatusLabel = (value) => String(value);\nconst toBcp47 = () => 'pt-BR';\n${source}`,
    { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }
  ).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
};

const withResendFetch = async (handler, run) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.RESEND_API_KEY;
  const originalError = console.error;
  const calls = [];
  const logs = [];
  process.env.RESEND_API_KEY = 're_test';
  console.error = (...args) => { logs.push(args.map(String).join(' ')); };
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body, at: Date.now() });
    return handler(url, body);
  };
  try {
    return await run(calls, logs);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
  }
};

const jsonResponse = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const athletes = (count, invalidIndexes = []) => Array.from({ length: count }, (_, index) => (
  invalidIndexes.includes(index)
    ? { to: `invalido${index}`, athleteName: `Atleta ${index}` }
    : { to: `atleta${index}@example.com`, athleteName: `Atleta ${index}` }
));

// Simula a validação do Resend: o lote inteiro é recusado se qualquer item for
// inválido, e a mensagem de erro repete o endereço recusado.
const validatingResend = (url, body) => {
  const invalid = body.find(email => !String(email.to).includes('@'));
  return invalid
    ? jsonResponse(422, { name: 'validation_error', message: `Invalid \`to\` field: ${invalid.to}` })
    : jsonResponse(200, { data: body.map((_, index) => ({ id: `email-${index}` })) });
};

const acceptedAddresses = (calls, responses) => {
  const accepted = [];
  for (let index = 0; index < calls.length; index += 1) {
    if (responses[index]) accepted.push(...calls[index].body.map(email => email.to));
  }
  return accepted;
};

const recordingResend = (handler) => {
  const responses = [];
  const wrapped = async (url, body) => {
    const response = await handler(url, body);
    responses.push(response.ok);
    return response;
  };
  return { wrapped, responses };
};

const sendDeletionNotice = (sender, recipients) => sender({ recipients, eventName: 'Evento', workoutName: 'Prova 1', justification: 'Motivo' });

const assertNoAddressInLogs = (logs) => {
  for (const line of logs) assert.doesNotMatch(line, /invalido|@example\.com/);
};

test('one invalid address in a batch of 100 is isolated by bisection with far fewer than 100 requests', async () => {
  const { sendQualifierWorkoutDeletedEmails } = await loadResendSender();
  const recipients = athletes(100, [37]);
  const { wrapped, responses } = recordingResend(validatingResend);

  await withResendFetch(wrapped, async (calls, logs) => {
    const result = await sendDeletionNotice(sendQualifierWorkoutDeletedEmails, recipients);
    assert.deepEqual(result, { sent: 99, failed: 1, failedRecipientIndexes: [37] });
    // Tudo via /emails/batch; o primeiro é o lote inteiro.
    assert.ok(calls.every(call => call.url === 'https://api.resend.com/emails/batch'));
    assert.equal(calls[0].body.length, 100);
    // Bisseção: ~2·log2(100) requisições, não uma por atleta.
    assert.equal(calls.length, 13);
    assert.ok(calls.length <= 2 * Math.ceil(Math.log2(100)) + 1);
    // Cada atleta válido recebe exatamente um e-mail.
    const accepted = acceptedAddresses(calls, responses);
    assert.equal(accepted.length, 99);
    assert.equal(new Set(accepted).size, 99);
    assert.ok(!accepted.includes('invalido37'));
    // E-mails de atleta nunca vão para log, nem quando o Resend os repete no erro.
    assert.ok(logs.length > 0);
    assertNoAddressInLogs(logs);
  });
});

test('two invalid addresses far apart are both isolated and everyone else is notified once', async () => {
  const { sendQualifierWorkoutDeletedEmails } = await loadResendSender();
  const recipients = athletes(100, [3, 88]);
  const { wrapped, responses } = recordingResend(validatingResend);

  await withResendFetch(wrapped, async (calls, logs) => {
    const result = await sendDeletionNotice(sendQualifierWorkoutDeletedEmails, recipients);
    assert.deepEqual(result, { sent: 98, failed: 2, failedRecipientIndexes: [3, 88] });
    assert.ok(calls.length < 30, `requisições: ${calls.length}`);
    const accepted = acceptedAddresses(calls, responses);
    assert.equal(accepted.length, 98);
    assert.equal(new Set(accepted).size, 98);
    assertNoAddressInLogs(logs);
  });
});

test('valid batches go out in one request each: 150 athletes become batches of 100 and 50', async () => {
  const { sendQualifierWorkoutDeletedEmails } = await loadResendSender();

  await withResendFetch(validatingResend, async (calls) => {
    const result = await sendDeletionNotice(sendQualifierWorkoutDeletedEmails, athletes(150));
    assert.deepEqual(result, { sent: 150, failed: 0, failedRecipientIndexes: [] });
    assert.deepEqual(calls.map(call => call.body.length), [100, 50]);
  });

  await withResendFetch(validatingResend, async (calls) => {
    const result = await sendDeletionNotice(sendQualifierWorkoutDeletedEmails, athletes(1));
    assert.deepEqual(result, { sent: 1, failed: 0, failedRecipientIndexes: [] });
    assert.equal(calls.length, 1);
  });

  // Inválido no segundo lote: o primeiro sai inteiro e a posição devolvida é a de params.recipients.
  await withResendFetch(validatingResend, async (calls, logs) => {
    const result = await sendDeletionNotice(sendQualifierWorkoutDeletedEmails, athletes(150, [120]));
    assert.deepEqual(result, { sent: 149, failed: 1, failedRecipientIndexes: [120] });
    assert.deepEqual(calls.slice(0, 2).map(call => call.body.length), [100, 50]);
    assertNoAddressInLogs(logs);
  });
});

test('a rate-limited request is retried once and a repeated 429 does not loop', async () => {
  const { sendQualifierWorkoutDeletedEmails } = await loadResendSender();
  let attempts = 0;
  await withResendFetch((url, body) => {
    attempts += 1;
    return attempts === 1 ? jsonResponse(429, { name: 'rate_limit_exceeded' }) : validatingResend(url, body);
  }, async (calls) => {
    const result = await sendDeletionNotice(sendQualifierWorkoutDeletedEmails, athletes(100));
    assert.deepEqual(result, { sent: 100, failed: 0, failedRecipientIndexes: [] });
    assert.deepEqual(calls.map(call => call.body.length), [100, 100]);
  });

  // 429 persistente: cada grupo tenta duas vezes e a bisseção termina com todos como falha.
  await withResendFetch(() => jsonResponse(429, { name: 'rate_limit_exceeded' }), async (calls) => {
    const result = await sendDeletionNotice(sendQualifierWorkoutDeletedEmails, athletes(3));
    assert.deepEqual(result, { sent: 0, failed: 3, failedRecipientIndexes: [0, 1, 2] });
    // Grupos [0,3) [0,1) [1,3) [1,2) [2,3), duas tentativas cada.
    assert.equal(calls.length, 10);
  });
});

test('server and network errors still bisect to the end without looping', async () => {
  const { sendQualifierWorkoutDeletedEmails } = await loadResendSender();

  await withResendFetch(() => jsonResponse(500, { name: 'internal_server_error' }), async (calls, logs) => {
    const result = await sendDeletionNotice(sendQualifierWorkoutDeletedEmails, athletes(100));
    assert.equal(result.sent, 0);
    assert.equal(result.failed, 100);
    assert.deepEqual(result.failedRecipientIndexes, Array.from({ length: 100 }, (_, index) => index));
    assert.equal(calls.length, 2 * 100 - 1);
    assertNoAddressInLogs(logs);
  });

  await withResendFetch(() => { throw new TypeError('fetch failed'); }, async (calls, logs) => {
    const result = await sendDeletionNotice(sendQualifierWorkoutDeletedEmails, athletes(4));
    assert.deepEqual(result, { sent: 0, failed: 4, failedRecipientIndexes: [0, 1, 2, 3] });
    assert.equal(calls.length, 2 * 4 - 1);
    assertNoAddressInLogs(logs);
  });
});

test('a refused key stops sending and marks everything pending as failed', async () => {
  const { sendQualifierWorkoutDeletedEmails } = await loadResendSender();

  // Recusa logo no primeiro lote: o segundo lote nem é enviado.
  await withResendFetch(() => jsonResponse(401, { name: 'invalid_api_key' }), async (calls) => {
    const result = await sendDeletionNotice(sendQualifierWorkoutDeletedEmails, athletes(150));
    assert.equal(result.sent, 0);
    assert.equal(result.failed, 150);
    assert.deepEqual(result.failedRecipientIndexes, Array.from({ length: 150 }, (_, index) => index));
    assert.equal(calls.length, 1);
  });

  // Recusa no meio da bisseção: a metade já aceita conta como enviada, o resto pendente como falha.
  let attempts = 0;
  await withResendFetch((url, body) => {
    attempts += 1;
    return attempts === 4 ? jsonResponse(403, { name: 'restricted_api_key' }) : validatingResend(url, body);
  }, async (calls) => {
    const result = await sendDeletionNotice(sendQualifierWorkoutDeletedEmails, athletes(100, [60]));
    // [0,100) recusado → [0,50) aceito → [50,100) recusado → [50,75) 403 → [75,100) sem envio.
    assert.equal(result.sent, 50);
    assert.equal(result.failed, 50);
    assert.deepEqual(result.failedRecipientIndexes, Array.from({ length: 50 }, (_, index) => 50 + index));
    assert.equal(calls.length, 4);
  });
});

test('requests are spaced by the Resend interval, except the first one', async () => {
  const intervalMs = 40;
  const { sendQualifierWorkoutDeletedEmails } = await loadResendSender({ intervalMs });

  await withResendFetch(validatingResend, async (calls) => {
    const startedAt = Date.now();
    const result = await sendDeletionNotice(sendQualifierWorkoutDeletedEmails, athletes(8, [5]));
    assert.deepEqual(result, { sent: 7, failed: 1, failedRecipientIndexes: [5] });
    assert.ok(calls[0].at - startedAt < intervalMs, 'o primeiro lote sai sem espera');
    for (let index = 1; index < calls.length; index += 1) {
      // Margem de 5 ms para a granularidade dos timers.
      assert.ok(calls[index].at - calls[index - 1].at >= intervalMs - 5, `espaçamento ${calls[index].at - calls[index - 1].at} ms`);
    }
  });
});

test('registrations for the deletion notice are fetched in chunks and failures count as not notified', () => {
  const notify = persistenceRoute.match(/const notifyAthletesOfDeletedWorkout = async \([\s\S]*?\n\};/)?.[0] || '';
  assert.match(persistenceRoute, /const REGISTRATION_LOOKUP_CHUNK_SIZE = 100;/);
  assert.match(notify, /for \(let index = 0; index < registrationIds\.length; index \+= REGISTRATION_LOOKUP_CHUNK_SIZE\) \{\n\s+const chunk = registrationIds\.slice\(index, index \+ REGISTRATION_LOOKUP_CHUNK_SIZE\);/);
  assert.match(notify, /\.select\('id, athlete_email, athlete_name'\)\n\s+\.in\('id', chunk\);/);
  assert.doesNotMatch(notify, /\.in\('id', registrationIds\)/);
  // Lote que falha não zera os demais.
  assert.match(notify, /\} catch \(error\) \{[\s\S]*?lookupFailed \+= chunk\.length;/);
  assert.match(notify, /lookupFailed \+= chunk\.filter\(id => !found\.has\(id\)\)\.length;/);
  // Quem não recebeu: só o nome, vindo das posições que o Resend devolveu como falha.
  assert.match(notify, /result\.failedRecipientIndexes[\s\S]*?unnotifiedAthleteNames\.push\(recipient\.athleteName\)/);
  assert.doesNotMatch(notify, /console\.error\([^)]*(recipient\.to|athlete_email|email\b)/);

  const helper = persistenceRoute.match(/const deleteQualifierWorkoutWithSubmissions = async \([\s\S]*?\n\};/)?.[0] || '';
  assert.match(helper, /athletesNotified,\n\s+unnotifiedAthleteNames\n\s+\};/);
  assert.doesNotMatch(helper, /email/i);
  assert.match(workoutEditSource, /unnotifiedAthleteNames: string\[\];/);
  assert.match(appContext, /unnotifiedAthleteNames: Array\.isArray\(data\.unnotifiedAthleteNames\) \? data\.unnotifiedAthleteNames\.map\(String\) : \[\]/);
});

test('the admin notice names the athletes left without the deletion e-mail', () => {
  assert.match(adminPage, /const unnotifiedNames = result\?\.unnotifiedAthleteNames \?\? \[\];/);
  assert.match(adminPage, /Sem aviso: \$\{unnotifiedNames\.join\(', '\)\}\./);
  assert.match(adminPage, /const unidentified = Math\.max\(0, affected - notified - unnotifiedNames\.length\);/);
  assert.match(adminPage, /avise os demais manualmente\.\$\{unnotifiedDetails \? ` \$\{unnotifiedDetails\}` : ''\}/);
});
