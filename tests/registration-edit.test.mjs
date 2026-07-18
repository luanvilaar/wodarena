import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const persistenceRoute = read('../src/app/api/admin/persistence/route.ts');
const appContext = read('../src/context/AppContext.tsx');
const adminPage = read('../src/app/admin/page.tsx');
const leaderboardRelocationMigration = read('../supabase/migrations/20260718120000_sync_leaderboard_on_registration_relocation.sql');

test('persistence exposes an authorized updateRegistration action over registrations and athletes', () => {
  assert.match(persistenceRoute, /case 'updateRegistration': \{/);
  // Autorização: somente o gestor dono do evento (ou owner) pode editar.
  assert.match(persistenceRoute, /case 'updateRegistration': \{[\s\S]*await ensureEventOwner\(supabaseAdmin, actor, eventId\)/);
  // Atualiza inscrição, atleta vinculado e leaderboard pela função transacional.
  assert.match(persistenceRoute, /\.rpc\('admin_update_registration_details'/);
  assert.match(persistenceRoute, /leaderboardEntry/);
});

test('relocating a category preserves the amount already paid', () => {
  // O total_paid não é tocado na relocação — é correção de cadastro, não recobrança.
  assert.match(persistenceRoute, /O valor pago \(total_paid\) e preservado/);
  assert.doesNotMatch(persistenceRoute, /p_total_paid|total_paid\s*=/);
  // A categoria de destino é validada contra o próprio evento.
  assert.match(persistenceRoute, /\.from\('divisions'\)[\s\S]*\.eq\('event_id', eventId\)/);
});

test('updateRegistration validates the target division and resolves the linked athlete robustly', () => {
  // Resolve por athlete_id quando disponível; senão por nome + categoria anteriores na RPC.
  assert.match(leaderboardRelocationMigration, /WHERE id = v_registration\.athlete_id/);
  assert.match(leaderboardRelocationMigration, /WHERE division_id = v_registration\.division_id[\s\S]*name ILIKE v_registration\.athlete_name/);
  // Retorna os dados normalizados (camelCase) para o cliente sincronizar o estado.
  assert.match(persistenceRoute, /registration: \{[\s\S]*athleteName: updatedRegistration\.athlete_name/);
  assert.match(persistenceRoute, /athlete: updatedAthlete \?/);
});

test('AppContext exposes updateRegistrationDetails and syncs both registrations and athletes', () => {
  assert.match(appContext, /export type RegistrationEditInput = \{/);
  assert.match(appContext, /updateRegistrationDetails: \(registrationId: string, eventId: string, data: RegistrationEditInput\) => Promise<void>/);
  assert.match(appContext, /const updateRegistrationDetails = async/);
  assert.match(appContext, /adminPersist\('updateRegistration', \{ registrationId, eventId, data \}\)/);
  assert.match(appContext, /setRegistrations\(prev => prev\.map\(r => \(r\.id === registrationId/);
  assert.match(appContext, /setAthletes\(prev => \{/);
  assert.match(appContext, /const updatedLeaderboardEntry = result\.leaderboardEntry as LeaderboardEntry/);
  assert.match(appContext, /setLeaderboardEntries\(prev => \{/);
  assert.match(appContext, /sameEvent && sameAthlete && sameDivision/);
});

test('database sync moves approved registrations between leaderboard divisions', () => {
  assert.match(leaderboardRelocationMigration, /CREATE OR REPLACE FUNCTION upsert_leaderboard_entry_for_registration\(p_registration_id TEXT\)/);
  assert.match(leaderboardRelocationMigration, /OLD\.payment_status = 'payment_approved'[\s\S]*NEW\.division_id IS DISTINCT FROM OLD\.division_id/);
  assert.match(leaderboardRelocationMigration, /DELETE FROM leaderboard_entries[\s\S]*division_id = OLD\.division_id/);
  assert.match(leaderboardRelocationMigration, /PERFORM upsert_leaderboard_entry_for_registration\(NEW\.id\)/);
  assert.match(leaderboardRelocationMigration, /CREATE OR REPLACE FUNCTION admin_update_registration_details/);
  assert.match(leaderboardRelocationMigration, /'leaderboardEntry'/);
});

test('database reconciliation removes stale entries and backfills approved registrations', () => {
  assert.match(leaderboardRelocationMigration, /DELETE FROM leaderboard_entries le[\s\S]*NOT EXISTS/);
  assert.match(leaderboardRelocationMigration, /SELECT DISTINCT ON \(r\.event_id, r\.division_id, a\.id\)/);
  assert.match(leaderboardRelocationMigration, /r\.payment_status = 'payment_approved'/);
  assert.match(leaderboardRelocationMigration, /ON CONFLICT \(event_id, division_id, athlete_id\)[\s\S]*DO UPDATE SET/);
});

test('registrations tab renders minimal expandable cards instead of a dense table', () => {
  assert.match(adminPage, /const \[expandedRegistrationId, setExpandedRegistrationId\] = useState<string \| null>\(null\)/);
  assert.match(adminPage, /const handleToggleRegistrationExpand = \(registrationId: string\) =>/);
  // Card header é um botão acessível com estado expandido.
  assert.match(adminPage, /onClick=\{\(\) => handleToggleRegistrationExpand\(reg\.id\)\}/);
  assert.match(adminPage, /aria-expanded=\{isExpanded\}/);
  // A antiga tabela de inscrições foi substituída (não há mais cabeçalho "Data Inscrição").
  assert.doesNotMatch(adminPage, /<th className="py-3 px-2">Data Inscrição<\/th>/);
});

test('manager can open and submit the registration edit modal with the requested fields', () => {
  assert.match(adminPage, /const handleOpenEditRegistration = \(registration: Registration\) =>/);
  assert.match(adminPage, /const handleSaveRegistrationEdit = async/);
  assert.match(adminPage, /\{editingRegistration && \(/);
  // Reconstrói o nome composto da equipe a partir do nome-base + integrantes.
  assert.match(adminPage, /const stripTeamSuffix = \(name: string\) =>/);
  assert.match(adminPage, /\$\{trimmedName\} \(\$\{members\.map\(m => m\.name\)\.join\(' \/ '\)\}\)/);
  // Campos solicitados: equipe/atleta, categoria, box, instagram, camisa, integrantes + contato.
  for (const field of ['edit-reg-cat', 'edit-reg-name', 'edit-reg-box', 'edit-reg-email', 'edit-reg-phone', 'edit-reg-instagram', 'edit-reg-shirt', 'edit-member-name-']) {
    assert.match(adminPage, new RegExp(field), `edit modal should contain field ${field}`);
  }
});
