import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const persistenceRoute = read('../src/app/api/admin/persistence/route.ts');
const appContext = read('../src/context/AppContext.tsx');
const adminPage = read('../src/app/admin/page.tsx');

test('persistence exposes an authorized updateRegistration action over registrations and athletes', () => {
  assert.match(persistenceRoute, /case 'updateRegistration': \{/);
  // Autorização: somente o gestor dono do evento (ou owner) pode editar.
  assert.match(persistenceRoute, /case 'updateRegistration': \{[\s\S]*await ensureEventOwner\(supabaseAdmin, actor, eventId\)/);
  // Atualiza tanto a inscrição quanto o atleta vinculado.
  assert.match(persistenceRoute, /\.from\('registrations'\)\s*\.update\(registrationUpdate\)/);
  assert.match(persistenceRoute, /\.from\('athletes'\)\s*\.update\(athleteUpdate\)/);
});

test('relocating a category preserves the amount already paid', () => {
  // O total_paid não é tocado na relocação — é correção de cadastro, não recobrança.
  assert.match(persistenceRoute, /O valor pago \(total_paid\) é preservado/);
  assert.doesNotMatch(persistenceRoute, /registrationUpdate[\s\S]{0,400}total_paid/);
  // A categoria de destino é validada contra o próprio evento.
  assert.match(persistenceRoute, /\.from\('divisions'\)[\s\S]*\.eq\('event_id', eventId\)/);
});

test('updateRegistration validates the target division and resolves the linked athlete robustly', () => {
  // Resolve por athlete_id quando disponível; senão por nome + categoria anteriores.
  assert.match(persistenceRoute, /if \(registration\.athlete_id\) \{/);
  assert.match(persistenceRoute, /\.ilike\('name', registration\.athlete_name\)/);
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
