import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Story 1.126 (decisão D5 de docs/design/painel-proprietario/): status do lead
// editável na linha por uma rota só do proprietário, conversa no WhatsApp, e
// Configurações com a taxa de serviço e a vitrine da home.

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-story-1-126-comercial';

let database = createFakeSupabase();
setActiveSupabaseClient({
  from: (table) => database.client.from(table),
  rpc: (name, args) => database.client.rpc(name, args)
});

const { PATCH } = await importServerModule('app/api/commercial-leads/route.ts');
const { createSessionToken } = await importServerModule('lib/serverSecurity.ts');
const { buildCommercialLeadWhatsAppUrl } = await importServerModule('lib/commercialLeads.ts');
const { OwnerCommercialSection } = await importServerModule('components/owner/OwnerCommercialSection.tsx');
const { OwnerHomeShowcase, isFeaturedHomeEventOffAir } = await importServerModule('components/owner/OwnerHomeShowcase.tsx');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const ownerPage = read('../src/app/owner/page.tsx');

const OWNER = { id: 'owner-1', name: 'Dono', email: 'dono@exemplo.com', role: 'owner' };
const MANAGER = { id: 'org-1', name: 'Gestor', email: 'g@exemplo.com', role: 'manager' };
const patch = (body, user = OWNER) => PATCH(new Request('http://localhost/api/commercial-leads', {
  method: 'PATCH',
  headers: { 'content-type': 'application/json', ...(user ? { cookie: `woda_session=${createSessionToken(user)}` } : {}) },
  body: JSON.stringify(body)
}));

const leadRow = (overrides = {}) => ({
  id: 'lead-1', manager_name: 'Thiago Mendes', phone: '(85) 99999-0101', phone_normalized: '85999990101', event_name: 'Fortaleza Games',
  city: 'Fortaleza', state: 'CE', country: 'BR', country_other: null, lead_status: 'new', accepted_terms: true,
  accepted_at: '2026-11-05T14:20:00.000Z', terms_version: 'v1', source: 'homepage-commercial-interest',
  owner_email_notification_status: 'sent', submitted_at: '2026-11-05T14:20:00.000Z', updated_at: '2026-11-05T14:20:00.000Z',
  ...overrides
});

test('lead status route is owner-only and writes only lead_status', async () => {
  database = createFakeSupabase({ commercial_leads: [leadRow()] });

  assert.equal((await patch({ id: 'lead-1', leadStatus: 'contacted' }, null)).status, 401);
  assert.equal((await patch({ id: 'lead-1', leadStatus: 'contacted' }, MANAGER)).status, 403);
  assert.equal(database.rows('commercial_leads')[0].lead_status, 'new');

  const bad = await patch({ id: 'lead-1', leadStatus: 'won' });
  assert.equal(bad.status, 400);

  const missing = await patch({ id: 'lead-x', leadStatus: 'qualified' });
  assert.equal(missing.status, 404);

  const ok = await patch({ id: 'lead-1', leadStatus: 'qualified' });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.lead.leadStatus, 'qualified');
  assert.equal(body.lead.managerName, 'Thiago Mendes');
  const [row] = database.rows('commercial_leads');
  assert.equal(row.lead_status, 'qualified');
  assert.equal(row.manager_name, 'Thiago Mendes', 'nada além do status muda');
});

test('WhatsApp link adds the country code to local numbers', () => {
  assert.equal(buildCommercialLeadWhatsAppUrl({ phone: '(85) 99999-0101', phoneNormalized: '85999990101', country: 'BR' }), 'https://wa.me/5585999990101');
  assert.equal(buildCommercialLeadWhatsAppUrl({ phone: '+55 85 99999-0101', phoneNormalized: '5585999990101', country: 'BR' }), 'https://wa.me/5585999990101');
  assert.equal(buildCommercialLeadWhatsAppUrl({ phone: '912 000 404', phoneNormalized: '912000404', country: 'PT' }), 'https://wa.me/351912000404');
  assert.equal(buildCommercialLeadWhatsAppUrl({ phone: '123', phoneNormalized: '123', country: 'BR' }), null);
  // DDD 55 (Rio Grande do Sul): local pelo tamanho, mesmo começando como o código do país.
  assert.equal(buildCommercialLeadWhatsAppUrl({ phone: '(55) 99999-0101', phoneNormalized: '55999990101', country: 'BR' }), 'https://wa.me/5555999990101');
});

const lead = (overrides = {}) => ({
  id: 'lead-1', managerName: 'Thiago Mendes', phone: '(85) 99999-0101', phoneNormalized: '85999990101', eventName: 'Fortaleza Games',
  city: 'Fortaleza', state: 'CE', country: 'BR', leadStatus: 'new', acceptedTerms: true, acceptedAt: '2026-11-05T14:20:00.000Z',
  termsVersion: 'v1', source: 'homepage', ownerEmailNotificationStatus: 'sent', submittedAt: '2026-11-05T14:20:00.000Z', ...overrides
});

test('commercial section edits the status in the row and opens the conversation', () => {
  const leads = [lead(), lead({ id: 'lead-2', managerName: 'Larissa Prado', leadStatus: 'contacted', ownerEmailNotificationStatus: 'failed', ownerEmailError: 'Domínio inválido' })];
  const html = renderToStaticMarkup(createElement(OwnerCommercialSection, {
    leads, loading: false, error: '', savingLeadId: null, statusError: '', onStatusChange: () => {}
  }));
  assert.match(html, />Total de leads<\/p><p[^>]*>2</);
  assert.match(html, />Novos<\/p><p[^>]*>1</);
  assert.match(html, />Aviso por e-mail falhou<\/p><p[^>]*>1</);
  assert.match(html, />Contatado<span[^>]*>1</);
  assert.match(html, /id="lead-status-lead-1"/);
  for (const label of ['Novo', 'Contatado', 'Qualificado', 'Descartado']) assert.match(html, new RegExp(`<option value="[a-z]+"[^>]*>${label}</option>`));
  assert.match(html, /href="https:\/\/wa\.me\/5585999990101"/);
  assert.match(html, /Domínio inválido/);

  const empty = renderToStaticMarkup(createElement(OwnerCommercialSection, {
    leads: [], loading: false, error: '', savingLeadId: null, statusError: '', onStatusChange: () => {}
  }));
  assert.match(empty, /Nenhum lead capturado ainda/);
});

test('page changes the lead status optimistically and rolls back on error', () => {
  assert.match(ownerPage, /method: 'PATCH'/);
  assert.match(ownerPage, /setCommercialLeads\(current => current\.map\(item => \(item\.id === lead\.id \? \{ \.\.\.item, leadStatus \} : item\)\)\);/);
  assert.match(ownerPage, /setCommercialLeads\(current => current\.map\(item => \(item\.id === lead\.id \? \{ \.\.\.item, leadStatus: previous \} : item\)\)\);/);
});

const isoDaysFromNow = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const event = (overrides = {}) => ({
  id: 'e1', name: 'Desafio Litoral', date: '20/12/2099', startDate: isoDaysFromNow(30), endDate: isoDaysFromNow(31), status: 'upcoming',
  logoUrl: '', isFeatured: false, organizerId: 'org-1', registrationDeadline: undefined, ...overrides
});

test('settings: fee card says the effect and the home showcase keeps the Story 1.24 rule', () => {
  assert.match(ownerPage, /serviceFeeConfig\.enabled \? 'Desligar taxa' : 'Ligar taxa'\}/);
  assert.match(ownerPage, /Pagamentos criados depois de salvar/);
  assert.match(ownerPage, /Inscrições já pagas nunca mudam\./);

  const offAir = [event({ id: 'past', name: 'Festival Verão', isFeatured: true, startDate: isoDaysFromNow(-20), endDate: isoDaysFromNow(-19) }), event()];
  assert.equal(isFeaturedHomeEventOffAir(offAir), true);
  assert.equal(isFeaturedHomeEventOffAir([event({ isFeatured: true })]), false);

  const html = renderToStaticMarkup(createElement(OwnerHomeShowcase, { events: offAir, setFeaturedHomeEvent: async () => {}, onSaved: () => {} }));
  assert.match(html, /Vitrine da home/);
  assert.match(html, /Este evento encerrou e não aparece mais no carrossel/);
  assert.match(html, /<option value="e1">Desafio Litoral<\/option>/);
  assert.doesNotMatch(html, /<option value="past">/, 'encerrado não é candidato');
});
