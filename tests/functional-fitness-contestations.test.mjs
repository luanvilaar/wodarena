import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const types = read('../src/types/index.ts');
const helper = read('../src/lib/contestations.ts');
const context = read('../src/context/AppContext.tsx');
const bootstrap = read('../src/app/api/app/bootstrap/route.ts');
const contestationsRoute = read('../src/app/api/contestations/route.ts');
const contestationStatusRoute = read('../src/app/api/contestations/[id]/route.ts');
const resend = read('../src/lib/resend.ts');
const migration = read('../supabase/migrations/20260617113000_functional_fitness_contestations.sql');
const adminPage = read('../src/app/admin/page.tsx');
const cli = read('../bin/contestations.mjs');
const packageJson = read('../package.json');

test('shared model exposes contestation entity and credit helpers', () => {
  assert.match(types, /export type ContestationStatus = 'under_review' \| 'approved' \| 'rejected'/);
  assert.match(types, /export interface Contestation/);
  assert.match(types, /creditRefunded: boolean/);
  assert.match(helper, /export const CONTESTATION_CREDITS_LIMIT = 2/);
  assert.match(helper, /calculateContestationCredits/);
  assert.match(helper, /available = Math\.max\(0, CONTESTATION_CREDITS_LIMIT - used \+ refunded\)/);
});

test('migration creates contestations table with credit tracking and statuses', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS contestations/);
  assert.match(migration, /status TEXT NOT NULL DEFAULT 'under_review'/);
  assert.match(migration, /CHECK \(status IN \('under_review', 'approved', 'rejected'\)\)/);
  assert.match(migration, /credit_consumed BOOLEAN NOT NULL DEFAULT TRUE/);
  assert.match(migration, /credit_refunded BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_contestations_event_id/);
  assert.match(migration, /CREATE TRIGGER trg_contestations_updated_at/);
});

test('bootstrap and context carry contestations with role isolation', () => {
  assert.match(bootstrap, /contestationsResult/);
  assert.match(bootstrap, /contestations: \(contestationsResult\.data \|\| \[\]\)\.filter\(contestation => eventIds\.has\(contestation\.event_id\)\)/);
  assert.match(bootstrap, /filter\(contestation => contestation\.userId === session\.id\)/);
  assert.match(context, /contestations: Contestation\[]/);
  assert.match(context, /const \[contestations, setContestations\] = useState<Contestation\[]>\(\[]\)/);
  assert.match(context, /const dbContestations = payload\.contestations/);
  assert.match(context, /setContestations\(dbContestations\.map\(mapContestationFromDb\)\)/);
});

test('athlete contestation route validates ownership, event type, credits and official heat', () => {
  assert.match(contestationsRoute, /requireSession\(request, \['athlete'\]\)/);
  assert.match(contestationsRoute, /Contestação disponível apenas para eventos de Functional Fitness/);
  assert.match(contestationsRoute, /Contestação disponível apenas para inscrições com pagamento aprovado/);
  assert.match(contestationsRoute, /findWorkoutHeat\(scheduleItems, workoutId, heatId\)/);
  assert.match(contestationsRoute, /calculateContestationCredits\(existingContestations\)/);
  assert.match(contestationsRoute, /Todos os créditos de contestação já foram utilizados para esta inscrição/);
  assert.match(contestationsRoute, /status: 'under_review'/);
  assert.match(contestationsRoute, /message: CONTESTATION_SUCCESS_MESSAGE/);
});

test('status update route allows refund only on approved decision and sends email', () => {
  assert.match(contestationStatusRoute, /requireSession\(request, \['manager', 'owner'\]\)/);
  assert.match(contestationStatusRoute, /body\.creditRefunded === true && status !== 'approved'/);
  assert.match(contestationStatusRoute, /credit_refunded: creditRefunded/);
  assert.match(contestationStatusRoute, /sendContestationStatusEmail/);
  assert.match(resend, /export async function sendContestationStatusEmail/);
  assert.match(resend, /getContestationStatusLabel/);
  assert.match(resend, /Atualizacao da contestacao/);
});

test('admin page renders athlete contestation flow and manager review surface', () => {
  assert.match(adminPage, /contestations, coupons, currentUser/);
  assert.match(adminPage, /Contestacao de Provas/);
  assert.match(adminPage, /Contestar Prova/);
  assert.match(adminPage, /1\. Selecao da Prova/);
  assert.match(adminPage, /2\. Formulario de Contestacao/);
  assert.match(adminPage, /Historico das contestacoes/);
  assert.match(adminPage, /Contestacoes/);
  assert.match(adminPage, /Salvar decisao/);
  assert.match(adminPage, /renderAbaContestations/);
});

test('cli entrypoint supports operational contestation flows', () => {
  assert.match(packageJson, /"contestations:cli": "node bin\/contestations\.mjs"/);
  assert.match(cli, /npm run contestations:cli -- list --event EVENT_ID/);
  assert.match(cli, /const CONTESTATION_CREDITS_LIMIT = 2/);
  assert.match(cli, /if \(command === 'list'\)/);
  assert.match(cli, /if \(command === 'create'\)/);
  assert.match(cli, /if \(command === 'update-status'\)/);
  assert.match(cli, /Contestacao disponivel apenas para eventos de Functional Fitness/);
  assert.match(cli, /A devolucao de credito so pode ocorrer em contestacao deferida/);
});
