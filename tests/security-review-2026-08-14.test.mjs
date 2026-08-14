import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Testes de regressão para os achados do security review de 2026-08-14
// (SECURITY-PENTEST.md). Cada teste amarra um finding específico — a mesma
// classe de falha não deve reaparecer silenciosamente (spec §38).

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const registrationStartRoute = read('../src/app/api/registrations/start/route.ts');
const persistenceRoute = read('../src/app/api/admin/persistence/route.ts');
const serverCheckout = read('../src/lib/serverCheckout.ts');
const serverSecurity = read('../src/lib/serverSecurity.ts');
const webhookRoute = read('../src/app/api/webhooks/mercadopago/route.ts');
const loginRoute = read('../src/app/api/auth/login/route.ts');
const changePasswordRoute = read('../src/app/api/auth/change-password/route.ts');
const mediaStorage = read('../src/lib/mediaStorage.ts');
const mediaUploadRoute = read('../src/app/api/admin/media/upload/route.ts');
const contestationsRoute = read('../src/app/api/contestations/route.ts');
const contestationDetailRoute = read('../src/app/api/contestations/[id]/route.ts');
const couponUsageLockMigration = read('../supabase/migrations/20260814120000_coupon_usage_limit_lock.sql');
const uniqueEmailMigration = read('../supabase/migrations/20260814121000_registrations_unique_active_email.sql');
const packageJson = read('../package.json');

test('V-01 (CRITICAL): registration payment_status can never be forged by the client', () => {
  assert.doesNotMatch(registrationStartRoute, /initialPaymentStatus/);
  assert.match(registrationStartRoute, /secureSnapshot\.transactionAmount === 0 \? 'payment_approved' : 'payment_pending'/);
  assert.match(registrationStartRoute, /checkRateLimit\(\{[\s\S]*key: `registrations-start:/);
});

test('V-02 (CRITICAL): upsertScores authorization is bound to the workout_id actually written, not a client-supplied eventIds array', () => {
  const upsertScoresBlock = persistenceRoute.match(/case 'upsertScores': \{[\s\S]*?\n {6}\}/)?.[0] || '';
  assert.match(upsertScoresBlock, /workoutIds = \[\.\.\.new Set\(/);
  assert.match(upsertScoresBlock, /from\('workouts'\)[\s\S]*\.in\('id', workoutIds\)/);
  assert.match(upsertScoresBlock, /const eventIds = \[\.\.\.new Set\(\(scoreWorkouts \|\| \[\]\)\.map\(\(workout\) => workout\.event_id\)\)\]/);
  assert.match(upsertScoresBlock, /ensureEventOwner\(supabaseAdmin, actor, eventId\)/);
  assert.doesNotMatch(upsertScoresBlock, /payload\.eventIds/);
});

test('V-03/V-04 (HIGH): createEvent/createDivision always overwrite child event_id with the validated parent, ignoring the payload', () => {
  const createEventBlock = persistenceRoute.match(/case 'createEvent': \{[\s\S]*?\n {6}\}/)?.[0] || '';
  assert.match(createEventBlock, /scopedDivisions = \(divisions as Record<string, unknown>\[\]\)\.map\(\(division\) => \(\{\s*\.\.\.division,\s*event_id: event\.id/);
  assert.match(createEventBlock, /scopedWorkouts = \(workouts as Record<string, unknown>\[\]\)\.map\(\(workout\) => \(\{\s*\.\.\.workout,\s*event_id: event\.id/);
  assert.match(createEventBlock, /from\('divisions'\)\.insert\(scopedDivisions\)/);
  assert.match(createEventBlock, /from\('workouts'\)\.insert\(scopedWorkouts\)/);

  const createDivisionBlock = persistenceRoute.match(/case 'createDivision': \{[\s\S]*?\n {6}\}/)?.[0] || '';
  assert.match(createDivisionBlock, /scopedAutoWorkout = \{ \.\.\.payload\.autoWorkout, event_id: payload\.division\.event_id \}/);
  assert.match(createDivisionBlock, /from\('workouts'\)\.insert\(scopedAutoWorkout\)/);
});

test('V-05 (HIGH): updateEvent/updateDivision/updateWorkout/updateCoupon only apply allowlisted fields, never raw payload.data', () => {
  const extractArrayLiteral = (constName) => persistenceRoute.match(
    new RegExp(`const ${constName} = \\[([\\s\\S]*?)\\] as const;`)
  )?.[1] || '';

  assert.match(persistenceRoute, /const EVENT_UPDATABLE_FIELDS = \[/);
  assert.doesNotMatch(extractArrayLiteral('EVENT_UPDATABLE_FIELDS'), /'organizer_id'/);
  assert.match(persistenceRoute, /const DIVISION_UPDATABLE_FIELDS = \[/);
  assert.doesNotMatch(extractArrayLiteral('DIVISION_UPDATABLE_FIELDS'), /'event_id'/);
  assert.match(persistenceRoute, /const WORKOUT_UPDATABLE_FIELDS = \[/);
  assert.doesNotMatch(extractArrayLiteral('WORKOUT_UPDATABLE_FIELDS'), /'event_id'/);
  assert.match(persistenceRoute, /const COUPON_UPDATABLE_FIELDS = \[/);
  assert.doesNotMatch(extractArrayLiteral('COUPON_UPDATABLE_FIELDS'), /'event_id'/);

  assert.match(persistenceRoute, /const pickAllowedFields = \(input: unknown, allowedKeys: readonly string\[\]\)/);
  assert.match(persistenceRoute, /from\('events'\)\.update\(allowedData\)/);
  assert.match(persistenceRoute, /\.from\('divisions'\)\s*\.update\(allowedData\)/);
  assert.match(persistenceRoute, /\.from\('workouts'\)\s*\.update\(allowedData\)/);
  assert.match(persistenceRoute, /\.from\('coupons'\)\s*\.update\(allowedData\)/);

  // updateWorkout: reatribuir a divisão via allowlist ainda exige que a nova
  // divisão pertença ao mesmo evento da prova.
  const updateWorkoutBlock = persistenceRoute.match(/case 'updateWorkout': \{[\s\S]*?\n {6}\}/)?.[0] || '';
  assert.match(updateWorkoutBlock, /allowedData\.division_id[\s\S]*\.eq\('event_id', workout\.event_id\)/);
});

test('V-06 (MEDIUM): Mercado Pago webhook hard-rejects an invalid signature when the secret is configured, instead of only logging', () => {
  assert.match(webhookRoute, /const webhookSecretConfigured = Boolean\(process\.env\.MERCADOPAGO_WEBHOOK_SECRET\)/);
  assert.match(webhookRoute, /if \(webhookSecretConfigured && !isSignatureValid\) \{[\s\S]*status: 401/);
  assert.doesNotMatch(webhookRoute, /Continuando validacao por canal seguro/);
});

test('V-07 (MEDIUM): registrations/start and admin/persistence are rate limited', () => {
  assert.match(registrationStartRoute, /checkRateLimit\(\{[\s\S]*key: `registrations-start:\$\{getClientIp\(request\)\}`/);
  assert.match(persistenceRoute, /checkRateLimit\(\{[\s\S]*key: `admin-persistence:\$\{actor\.id\}`/);
});

test('V-08 (MEDIUM): coupon usage_count increment never exceeds usage_limit under concurrent approvals', () => {
  assert.match(couponUsageLockMigration, /CREATE OR REPLACE FUNCTION apply_coupon_usage/);
  assert.match(couponUsageLockMigration, /AND \(COALESCE\(usage_limit, 0\) = 0 OR COALESCE\(usage_count, 0\) < usage_limit\)/);
});

test('V-09 (MEDIUM): checkout enforces division slots_limit and event ticket_slots capacity server-side', () => {
  assert.match(serverCheckout, /divisionSlotsLimit > 0 && \(divisionRegistrationCount \|\| 0\) >= divisionSlotsLimit/);
  assert.match(serverCheckout, /eventTicketSlots > 0 && \(eventRegistrationCount \|\| 0\) >= eventTicketSlots/);
  assert.match(serverCheckout, /Esta categoria atingiu o limite de vagas\./);
  assert.match(serverCheckout, /Este evento atingiu o limite de vagas\./);
});

test('V-10 (MEDIUM): raw Postgres/Supabase error messages never reach the client', () => {
  assert.match(serverSecurity, /export const safeErrorMessage = \(err: unknown, fallback: string\) =>/);
  assert.match(serverSecurity, /err instanceof Error && !\('code' in err\)/);
  assert.match(persistenceRoute, /error: safeErrorMessage\(err, 'Erro ao persistir dados\.'\)/);
  assert.match(contestationsRoute, /safeErrorMessage\(err,/);
  assert.match(contestationDetailRoute, /safeErrorMessage\(err,/);
  assert.doesNotMatch(registrationStartRoute, /statusDetail: userError\.message/);
  assert.doesNotMatch(registrationStartRoute, /code: userError\.code/);
});

test('V-11 (LOW): login burns the same scrypt cost for unknown emails, closing the timing side-channel', () => {
  assert.match(loginRoute, /const DUMMY_PASSWORD_HASH = hashPassword\('wodarena-login-timing-decoy'\)/);
  const notFoundBlock = loginRoute.match(/if \(userError \|\| !user\) \{[\s\S]*?\n {4}\}/)?.[0] || '';
  assert.match(notFoundBlock, /verifyPassword\(String\(password\), DUMMY_PASSWORD_HASH\)/);
});

test('V-13 (MEDIUM): next is upgraded past the known high-severity advisories', () => {
  const nextVersion = packageJson.match(/"next":\s*"([^"]+)"/)?.[1];
  assert.ok(nextVersion, 'next dependency not found in package.json');
  const [major, minor, patch] = nextVersion.split('.').map(Number);
  assert.ok(
    major > 16 || (major === 16 && minor > 3) || (major === 16 && minor === 3 && patch >= 1),
    `next@${nextVersion} is older than the patched 16.3.1`
  );
});

test('V-15 (LOW): a database-level unique index closes the check-then-act race on duplicate active registrations', () => {
  assert.match(uniqueEmailMigration, /CREATE UNIQUE INDEX IF NOT EXISTS registrations_event_email_active_unique/);
  assert.match(uniqueEmailMigration, /ON registrations \(event_id, lower\(athlete_email\)\)/);
  assert.match(uniqueEmailMigration, /WHERE payment_status <> 'payment_cancelled'/);
  assert.match(registrationStartRoute, /regError\?\.code === '23505'/);
});

test('V-17 (LOW): change-password is rate limited', () => {
  assert.match(changePasswordRoute, /checkRateLimit\(\{[\s\S]*key: `change-password:/);
});

test('V-19 (LOW): incrementCouponUsage escapes LIKE/ILIKE metacharacters before matching a coupon code', () => {
  assert.match(persistenceRoute, /const escapeLikePattern = \(value: string\) => value\.replace\(\/\[\\\\%_\]\/g/);
  assert.match(persistenceRoute, /\.ilike\('code', escapeLikePattern\(asTrimmed\(payload\.code\)\)\)/);
});

test('V-16 (LOW hardening): media upload validates real magic bytes against the declared Content-Type', () => {
  assert.match(mediaStorage, /export const matchesDeclaredImageType = \(bytes: Uint8Array, contentType: string\): boolean =>/);
  assert.match(mediaUploadRoute, /matchesDeclaredImageType\(bytes, file\.type\)/);
});
