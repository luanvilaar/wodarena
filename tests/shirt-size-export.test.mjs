import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const types = read('../src/types/index.ts');
const context = read('../src/context/AppContext.tsx');
const registerModal = read('../src/components/RegisterModal.tsx');
const admin = read('../src/app/admin/page.tsx');
const startRoute = read('../src/app/api/registrations/start/route.ts');
const bootstrapRoute = read('../src/app/api/app/bootstrap/route.ts');
const webhookRoute = read('../src/app/api/webhooks/mercadopago/route.ts');
const emailRoute = read('../src/app/api/checkout/email/route.ts');
const migration = read('../supabase/migrations/20260607234500_athlete_shirt_size.sql');

test('registration form collects shirt size instead of athlete photo', () => {
  assert.match(types, /shirtSize\?: ShirtSize \| string/);
  assert.match(registerModal, /Tamanho da camisa \*/);
  assert.match(registerModal, /participants\.\$\{index\}\.shirtSize/);
  assert.match(registerModal, /!participant\.shirtSize/);
  assert.doesNotMatch(registerModal, /Foto do atleta \(opcional\)/);
  assert.doesNotMatch(registerModal, /Instagram da equipe/);
  assert.doesNotMatch(registerModal, /\bPP\b/);
  assert.doesNotMatch(registerModal, /\bXG\b/);
  assert.doesNotMatch(registerModal, /\bXXG\b/);
});

test('shirt size is persisted in athlete storage and checkout recovery flows', () => {
  assert.match(migration, /ALTER TABLE athletes ADD COLUMN IF NOT EXISTS shirt_size TEXT/);
  assert.match(context, /shirtSize: a\.shirt_size/);
  assert.match(context, /const PRIVATE_BOOTSTRAP_ENDPOINT = '\/api\/app\/bootstrap'/);
  assert.match(context, /const PUBLIC_BOOTSTRAP_ENDPOINT = '\/api\/app\/bootstrap\/public'/);
  assert.match(context, /const response = await fetch\(PRIVATE_BOOTSTRAP_ENDPOINT\)/);
  assert.match(bootstrapRoute, /supabaseAdmin\.from\('athletes'\)/);
  assert.match(context, /shirtSize: m\.shirtSize/);
  assert.match(startRoute, /shirt_size: safeAthleteProfile\.shirtSize/);
  assert.match(startRoute, /shirt_size: safeAthleteProfile\.shirtSize \|\| null/);
  assert.match(webhookRoute, /shirtSize: dbAthlete\?\.shirt_size/);
  assert.match(emailRoute, /shirtSize: dbAthlete\?\.shirt_size/);
});

test('manager panel exports shirt data in an Excel-compatible file', () => {
  assert.match(admin, /Exportar Camisas/);
  assert.match(admin, /FileSpreadsheet/);
  assert.match(admin, /application\/vnd\.ms-excel/);
  assert.match(admin, /\.xls`/);
  assert.match(admin, /Tamanho da Camisa/);
  assert.match(admin, /member\.shirtSize/);
  assert.match(admin, /athleteInfo\?\.shirtSize/);
  assert.match(admin, /const SHIRT_SIZE_OPTIONS = \['P', 'M', 'G', 'GG'\]/);
  assert.doesNotMatch(admin, /\bPP\b/);
  assert.doesNotMatch(admin, /\bXG\b/);
  assert.doesNotMatch(admin, /\bXXG\b/);
});
