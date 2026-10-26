import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Stories 1.73 a 1.76: um comprovante só (pôster 1B, docs/design/comprovante/) no
// sucesso da inscrição, no painel e no e-mail, com um e-mail por inscrição.
// A parte do servidor roda de verdade (pôster, e-mail e rota da imagem) contra um
// banco em memória e o Resend simulado no fetch; a parte do navegador é conferida
// no código-fonte, como nos demais testes de regressão estática.

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-story-1-75';
process.env.RESEND_API_KEY = 're_test_story_1_76';

let database = createFakeSupabase();
setActiveSupabaseClient({
  from: (table) => database.client.from(table),
  rpc: (name, args) => database.client.rpc(name, args)
});

const poster = await importServerModule('lib/registrationPoster.ts');
const { renderRegistrationPoster } = await importServerModule('lib/registrationPosterImage.tsx');
const { sendRegistrationEmail } = await importServerModule('lib/resend.ts');
const { GET: getPoster } = await importServerModule('app/api/registrations/[id]/poster/route.ts');
const { createRegistrationAccessToken } = await importServerModule('lib/serverSecurity.ts');
const { triggerRegistrationApprovedEmail } = await importServerModule('lib/serverCheckout.ts');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const registerModal = read('../src/components/RegisterModal.tsx');
const pixModal = read('../src/components/PixPaymentModal.tsx');
const voucher = read('../src/components/RegistrationVoucher.tsx');
const eventView = read('../src/app/[locale]/event/[id]/EventView.tsx');
const startRoute = read('../src/app/api/registrations/start/route.ts');
const serverCheckout = read('../src/lib/serverCheckout.ts');
const emailRoute = read('../src/app/api/checkout/email/route.ts');
const posterRoute = read('../src/app/api/registrations/[id]/poster/route.ts');
const nextConfig = read('../next.config.ts');
const messages = Object.fromEntries(['pt-br', 'pt-pt', 'en-gb'].map((locale) => [
  locale,
  JSON.parse(read(`../src/messages/${locale}.json`))
]));

const EVENT = {
  id: 'evt-1-75',
  name: 'Throwdown Beira-Mar 2026',
  date: '15/11/2026',
  startDate: '2026-11-15',
  endDate: '2026-11-15',
  instagram: 'https://instagram.com/throwdownbeiramar?igsh=abc',
  defaultLocale: 'pt-br'
};

const pngSize = (bytes) => {
  const buffer = Buffer.from(bytes);
  assert.equal(buffer.subarray(1, 4).toString('latin1'), 'PNG', 'assinatura PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
};

// ---------------------------------------------------------------------------
// Pôster 1B: regras puras
// ---------------------------------------------------------------------------

test('splitPosterName: pessoa vira primeiro e último nome; equipe quebra o nome do time em até duas linhas', () => {
  assert.deepEqual(poster.splitPosterName('Marina Costa', false), ['Marina', 'Costa']);
  assert.deepEqual(poster.splitPosterName('Maria Eduarda Albuquerque Vasconcelos', false), ['Maria', 'Vasconcelos']);
  assert.deepEqual(poster.splitPosterName('Madonna', false), ['Madonna']);
  assert.deepEqual(poster.splitPosterName('Maré Alta', true), ['Maré', 'Alta']);
  assert.deepEqual(poster.splitPosterName('Os Imparáveis do Box Central', true), ['Os Imparáveis', 'do Box Central']);
  assert.deepEqual(poster.splitPosterName('   ', false), ['']);
  // Linha longa demais é cortada com reticências em vez de estourar a imagem.
  const [line] = poster.splitPosterName('Pneumoultramicroscopicossilicovulcanoconiótico', false);
  assert.equal(line.length, 20);
  assert.ok(line.endsWith('…'));
});

test('stripTeamSuffix e posterNameFontSize: o corpo cabe a linha mais longa entre o piso e o teto', () => {
  assert.equal(poster.stripTeamSuffix('Maré Alta (Ana Lima / Bruno Reis)'), 'Maré Alta');
  assert.equal(poster.stripTeamSuffix('Marina Costa'), 'Marina Costa');
  const bounds = { max: 330, min: 130 };
  assert.equal(poster.posterNameFontSize(['Ana', 'Lu'], 952, bounds), 330, 'nome curto fica no teto');
  assert.equal(poster.posterNameFontSize(['Vasconcelos'], 952, bounds), Math.floor(952 / 5.5));
  assert.equal(poster.posterNameFontSize(['A'.repeat(20)], 952, bounds), 130, 'nome longo para no piso');
});

test('toInstagramHandle e getEventInitials normalizam o que o gestor digitou', () => {
  assert.equal(poster.toInstagramHandle('@throwdownbeiramar'), '@throwdownbeiramar');
  assert.equal(poster.toInstagramHandle('https://www.instagram.com/throwdownbeiramar/?igsh=1'), '@throwdownbeiramar');
  assert.equal(poster.toInstagramHandle('  '), '');
  assert.equal(poster.toInstagramHandle(undefined), '');
  assert.equal(poster.getEventInitials('Throwdown Beira-Mar 2026'), 'TB');
  assert.equal(poster.getEventInitials('CN GAMES'), 'CG');
  assert.equal(poster.getEventInitials('---'), 'WA');
});

test('getPaymentMethodKind e isPosterEligible: só aprovado ganha a frente', () => {
  assert.equal(poster.getPaymentMethodKind('free'), 'free');
  assert.equal(poster.getPaymentMethodKind('pix'), 'pix');
  for (const card of ['visa', 'master', 'elo', 'credit_card', 'debit_card']) {
    assert.equal(poster.getPaymentMethodKind(card), 'card', card);
  }
  assert.equal(poster.getPaymentMethodKind('mercadopago_preference'), 'other');
  assert.equal(poster.getPaymentMethodKind(''), null);
  assert.equal(poster.isPosterEligible({ paymentStatus: 'payment_approved' }), true);
  assert.equal(poster.isPosterEligible({}), true, 'sem status gravado conta como aprovada, como no comprovante');
  for (const status of ['payment_pending', 'payment_in_review', 'payment_failed', 'payment_cancelled']) {
    assert.equal(poster.isPosterEligible({ paymentStatus: status }), false, status);
  }
});

test('buildPosterModel: dados do servidor, idioma da inscrição e equipe', () => {
  const person = poster.buildPosterModel({
    registration: { athleteName: 'Marina Costa', ticketType: 'RX Feminino', box: 'Box Exemplo' },
    athlete: { isTeam: false },
    event: EVENT
  });
  assert.deepEqual(person.lines, ['Marina', 'Costa']);
  assert.deepEqual(person.ghostTop, ['Marina', 'Marina']);
  assert.deepEqual(person.ghostBottom, ['Costa', 'Costa']);
  assert.equal(person.confirmedLabel, 'Inscrição confirmada');
  assert.equal(person.dateLabel, '15 nov 2026', 'datas estruturadas, no idioma da inscrição');
  assert.equal(person.instagramHandle, '@throwdownbeiramar');
  assert.equal(person.eventInitials, 'TB');

  const independent = poster.buildPosterModel({
    registration: { athleteName: 'Marina Costa', ticketType: 'RX', box: '', locale: 'en-gb' },
    athlete: { isTeam: false },
    event: { ...EVENT, startDate: undefined, endDate: undefined }
  });
  assert.equal(independent.confirmedLabel, 'Registration confirmed');
  assert.equal(independent.box, 'Independent');
  assert.equal(independent.dateLabel, '15/11/2026', 'sem datas estruturadas, vale o texto do gestor');

  const team = poster.buildPosterModel({
    registration: { athleteName: 'Maré Alta (Ana Lima / Bruno Reis)', ticketType: 'Times Scaled', box: 'Box Exemplo' },
    athlete: { isTeam: true, teamMembers: [{ name: 'Ana Lima', instagram: '' }, { name: 'Bruno Reis', instagram: '' }] },
    event: EVENT
  });
  assert.deepEqual(team.lines, ['Maré', 'Alta']);
  assert.deepEqual(team.members, ['Ana Lima', 'Bruno Reis']);
  assert.equal(team.confirmedLabel, 'Equipe confirmada');
  assert.equal(poster.resolvePosterLocale('xx'), 'pt-br');
});

test('o pôster não carrega dado pessoal além de nome, categoria, box e evento', () => {
  const model = poster.buildPosterModel({
    registration: {
      athleteName: 'Marina Costa', ticketType: 'RX', box: 'Box', athleteEmail: 'marina@example.com', athletePhone: '85999990000',
      totalPaid: 180, id: 'reg-3f9c2a71-8b4e-4d2a-9c11-6e0f5a7b2d34'
    },
    athlete: { isTeam: false, email: 'marina@example.com', phone: '85999990000', birthDate: '1995-05-05' },
    event: EVENT
  });
  const serialized = JSON.stringify(model);
  for (const secret of ['marina@example.com', '85999990000', '1995-05-05', '180', 'reg-3f9c2a71']) {
    assert.ok(!serialized.includes(secret), `não pode conter ${secret}`);
  }
});

// ---------------------------------------------------------------------------
// Pôster 1B: imagem de verdade
// ---------------------------------------------------------------------------

test('renderRegistrationPoster gera PNG no tamanho de cada formato, com nome longo e equipe', async () => {
  const people = [
    { athleteName: 'Marina Costa', ticketType: 'RX Feminino', box: 'Box Exemplo', athlete: { isTeam: false } },
    {
      athleteName: 'Maria Eduarda Albuquerque Vasconcelos', ticketType: 'Scaled Masters 40+ Feminino', box: 'CrossFit Box Muito Longo Do Bairro',
      athlete: { isTeam: false }
    },
    {
      athleteName: 'Team Maré Alta (Ana / Bruno / Carla / Davi)', ticketType: 'Times Scaled', box: 'Box Exemplo',
      athlete: { isTeam: true, teamMembers: ['Ana', 'Bruno', 'Carla', 'Davi'].map((name) => ({ name, instagram: '' })) }
    }
  ];
  for (const person of people) {
    const model = poster.buildPosterModel({ registration: person, athlete: person.athlete, event: EVENT });
    const story = await renderRegistrationPoster(model, 'story');
    assert.equal(story.headers.get('content-type'), 'image/png');
    assert.deepEqual(pngSize(await story.arrayBuffer()), { width: 1080, height: 1920 });
    const email = await renderRegistrationPoster(model, 'email');
    assert.deepEqual(pngSize(await email.arrayBuffer()), { width: 1200, height: 600 });
  }
});

test('logo do evento só é buscado no armazenamento do próprio Supabase', async (t) => {
  const fetched = [];
  t.mock.method(globalThis, 'fetch', async (input) => {
    fetched.push(String(input));
    return new Response(null, { status: 404 });
  });
  const model = poster.buildPosterModel({
    registration: { athleteName: 'Marina Costa', ticketType: 'RX', box: 'Box' },
    athlete: { isTeam: false },
    event: EVENT
  });
  await renderRegistrationPoster(model, 'email', 'https://intranet.interna.test/logo.png');
  await renderRegistrationPoster(model, 'email', 'http://supabase.test.invalid/storage/logo.png');
  assert.deepEqual(fetched, [], 'host de terceiros e http nunca são chamados pelo servidor');
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://projeto.supabase.test';
  try {
    await renderRegistrationPoster(model, 'email', 'https://projeto.supabase.test/storage/v1/object/public/event-media/logo.png');
    assert.deepEqual(fetched, ['https://projeto.supabase.test/storage/v1/object/public/event-media/logo.png']);
  } finally {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  }
});

// ---------------------------------------------------------------------------
// E-mail de confirmação
// ---------------------------------------------------------------------------

const registrationRow = (overrides = {}) => ({
  id: 'reg-3f9c2a71-8b4e-4d2a-9c11-6e0f5a7b2d34',
  eventId: EVENT.id,
  divisionId: 'div-rx',
  athleteName: 'Marina Costa',
  athleteEmail: 'marina@example.com',
  athletePhone: '85999990000',
  box: 'Box Exemplo',
  gender: 'female',
  ticketType: 'RX Feminino',
  ticketPrice: 150,
  quantity: 1,
  totalPaid: 180,
  createdAt: '2026-10-26T14:32:00.000Z',
  paymentStatus: 'payment_approved',
  paymentMethod: 'pix',
  ...overrides
});

const fullEvent = (overrides = {}) => ({
  ...EVENT,
  logoUrl: '',
  bannerUrl: '',
  location: 'Arena Beira-Mar',
  city: 'Fortaleza',
  state: 'CE',
  currency: 'BRL',
  website: 'throwdownbeiramar.com.br',
  eventType: 'functional_fitness',
  ...overrides
});

const athleteFor = (overrides = {}) => ({
  id: 'ath-1', name: 'Marina Costa', email: 'marina@example.com', phone: '85999990000', isTeam: false, shirtSize: 'M', ...overrides
});

const captureEmails = (t) => {
  const sent = [];
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    assert.equal(String(input), 'https://api.resend.com/emails');
    sent.push({ headers: init.headers, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ id: `email-${sent.length}` }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return sent;
};

test('e-mail aprovado: cabeçalho é o pôster anexado, campos na ordem do verso, sem CPF', async (t) => {
  const sent = captureEmails(t);
  const result = await sendRegistrationEmail(registrationRow(), athleteFor(), fullEvent(), 'pt-br', { idempotencyKey: 'registration-confirmed/reg-1' });
  assert.equal(result.success, true);

  const [{ headers, body }] = sent;
  assert.equal(headers['Idempotency-Key'], 'registration-confirmed/reg-1');
  assert.equal(body.subject, 'Inscrição Confirmada - Throwdown Beira-Mar 2026');
  assert.equal(body.attachments.length, 1);
  const [attachment] = body.attachments;
  assert.equal(attachment.content_id, 'registration-poster');
  assert.equal(attachment.content_type, 'image/png');
  assert.deepEqual(pngSize(Buffer.from(attachment.content, 'base64')), { width: 1200, height: 600 });
  assert.match(body.html, /<img src="cid:registration-poster"/);

  const html = body.html;
  const order = ['ID da Inscrição', 'Competição', 'Categoria / Divisão', 'Atleta / Equipe', 'Box / Afiliado', 'Data do Evento', 'Local', 'Cidade / Estado', 'Total Pago', 'Forma de Pagamento', 'Status do Pagamento']
    .map((label) => html.indexOf(`>${label}<`));
  assert.ok(order.every((position) => position > 0), 'todos os campos presentes');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'mesma ordem do verso do comprovante');
  assert.match(html, /15 nov 2026/);
  assert.match(html, /Pix/);
  assert.doesNotMatch(html, /CPF|NIF|Tax ID/);
  assert.match(html, /\/admin"/, 'botão leva à área do atleta');
});

test('segunda via não manda chave de idempotência: cada pedido do gestor envia de novo', async (t) => {
  const sent = captureEmails(t);
  await sendRegistrationEmail(registrationRow(), athleteFor(), fullEvent(), 'pt-br');
  await sendRegistrationEmail(registrationRow(), athleteFor(), fullEvent(), 'pt-br');
  assert.equal(sent.length, 2);
  for (const { headers } of sent) assert.equal('Idempotency-Key' in headers, false);
});

test('e-mail escapa todo texto digitado (evento, atleta, box, categoria, local, integrantes)', async (t) => {
  const sent = captureEmails(t);
  const evil = '<img src=x onerror=alert(1)>';
  await sendRegistrationEmail(
    registrationRow({ athleteName: `Ana ${evil}`, box: `Box ${evil}`, ticketType: `RX ${evil}` }),
    athleteFor({ isTeam: true, teamMembers: [{ name: `Bia ${evil}`, instagram: '', shirtSize: 'M' }] }),
    fullEvent({ name: `Evento ${evil}`, location: `Arena ${evil}`, date: `Data ${evil}`, startDate: undefined, endDate: undefined }),
    'pt-br'
  );
  const { html } = sent[0].body;
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('e-mail de inscrição não aprovada sai sem a frente e com o cabeçalho de texto', async (t) => {
  const sent = captureEmails(t);
  await sendRegistrationEmail(registrationRow({ paymentStatus: 'payment_pending' }), athleteFor(), fullEvent(), 'pt-br');
  const { body } = sent[0];
  assert.equal(body.attachments, undefined);
  assert.doesNotMatch(body.html, /cid:registration-poster/);
  assert.match(body.html, /Inscrição Registrada/);
  assert.match(body.html, /Throwdown Beira-Mar 2026/);
});

test('e-mail em en-gb usa o mesmo desenho com textos do idioma', async (t) => {
  const sent = captureEmails(t);
  await sendRegistrationEmail(registrationRow({ paymentMethod: 'visa', locale: 'en-gb' }), athleteFor(), fullEvent({ currency: 'GBP' }), 'en-gb');
  const { body } = sent[0];
  assert.equal(body.subject, 'Registration Confirmed - Throwdown Beira-Mar 2026');
  assert.match(body.html, />Payment Method</);
  assert.match(body.html, />Card</);
  assert.match(body.html, /Open my registration/);
});

// ---------------------------------------------------------------------------
// Rota da imagem
// ---------------------------------------------------------------------------

const REG_ID = 'reg-3f9c2a71-8b4e-4d2a-9c11-6e0f5a7b2d34';
const OTHER_USER = 'user-outra';

const seedPosterDatabase = (registrationOverrides = {}) => createFakeSupabase({
  events: [{
    id: EVENT.id, name: EVENT.name, logo_url: '', banner_url: '', status: 'upcoming', location: 'Arena Beira-Mar', date: EVENT.date,
    start_date: EVENT.startDate, end_date: EVENT.endDate, time: '08:00', city: 'Fortaleza', state: 'CE', description: '', organizer_id: 'mgr-1',
    sponsors: [], format: 'individual', ticket_price: 150, ticket_slots: 100, is_ticketing_active: true, rules: '', instagram: '@throwdownbeiramar',
    website: '', event_type: 'functional_fitness', currency: 'BRL', default_locale: 'pt-br', shirt_mode: 'included', shirt_addon_price: 0
  }],
  users: [{ id: 'mgr-1', name: 'Gestor', email: 'gestor@example.com', role: 'manager' }],
  athletes: [{ id: 'ath-1', name: 'Marina Costa', email: 'marina@example.com', phone: '85999990000', division_id: 'div-rx', is_team: false, team_members: '[]' }],
  registrations: [{
    id: REG_ID, event_id: EVENT.id, division_id: 'div-rx', user_id: 'user-marina', athlete_id: 'ath-1', athlete_name: 'Marina Costa',
    athlete_email: 'marina@example.com', athlete_phone: '85999990000', box: 'Box Exemplo', gender: 'female', ticket_type: 'RX Feminino',
    ticket_price: 150, quantity: 1, total_paid: 180, currency: 'BRL', locale: 'pt-br', payment_status: 'payment_approved', payment_method: 'pix',
    created_at: '2026-10-26T14:32:00.000Z', ...registrationOverrides
  }]
});

const posterRequest = (query = '') => getPoster(
  new Request(`http://localhost/api/registrations/${REG_ID}/poster${query}`),
  { params: Promise.resolve({ id: REG_ID }) }
);

const tokenFor = () => createRegistrationAccessToken({ registrationId: REG_ID, eventId: EVENT.id, userId: 'user-marina' });

test('rota da imagem: com o token da inscrição devolve o PNG, sem cache compartilhado', async (t) => {
  t.mock.method(console, 'error', () => {});
  database = seedPosterDatabase();
  const story = await posterRequest(`?access_token=${encodeURIComponent(tokenFor())}`);
  assert.equal(story.status, 200);
  assert.equal(story.headers.get('content-type'), 'image/png');
  assert.equal(story.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(pngSize(await story.arrayBuffer()), { width: 1080, height: 1920 });

  const email = await posterRequest(`?format=email&access_token=${encodeURIComponent(tokenFor())}`);
  assert.deepEqual(pngSize(await email.arrayBuffer()), { width: 1200, height: 600 });
});

test('rota da imagem: sem token ou com token de outra inscrição é negada; pendente não tem frente', async (t) => {
  t.mock.method(console, 'error', () => {});
  database = seedPosterDatabase();
  assert.equal((await posterRequest()).status, 403);
  const foreign = createRegistrationAccessToken({ registrationId: 'reg-outra', eventId: EVENT.id, userId: OTHER_USER });
  assert.equal((await posterRequest(`?access_token=${encodeURIComponent(foreign)}`)).status, 403);

  database = seedPosterDatabase({ payment_status: 'payment_pending' });
  const pending = await posterRequest(`?access_token=${encodeURIComponent(tokenFor())}`);
  assert.equal(pending.status, 403);
  assert.match((await pending.json()).error, /após a confirmação do pagamento/);

  database = seedPosterDatabase();
  const missing = await getPoster(
    new Request('http://localhost/api/registrations/reg-inexistente/poster'),
    { params: Promise.resolve({ id: 'reg-inexistente' }) }
  );
  assert.equal(missing.status, 404);
});

test('rota da imagem: a inscrição aprovada de outro atleta não aparece com a sessão de um terceiro', async () => {
  assert.match(posterRoute, /assertRegistrationAccess\(supabaseAdmin, request,/);
  assert.match(posterRoute, /isPosterEligible\(loaded\.registration\)/);
  assert.match(posterRoute, /checkRateLimit\(/);
  assert.match(posterRoute, /export const runtime = 'nodejs'/);
});

test('e-mail disparado pelo servidor traz a forma de pagamento, as datas do evento e a chave de idempotência', async (t) => {
  const sent = captureEmails(t);
  database = seedPosterDatabase();
  const result = await triggerRegistrationApprovedEmail(database.client, REG_ID);
  assert.equal(result.success, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].headers['Idempotency-Key'], `registration-confirmed/${REG_ID}`);
  assert.equal(sent[0].body.to, 'marina@example.com');
  assert.match(sent[0].body.html, />Forma de Pagamento<[\s\S]*?Pix/);
  assert.match(sent[0].body.html, /15 nov 2026/, 'datas estruturadas do evento, como no comprovante do app');
  assert.equal(sent[0].body.attachments.length, 1);

  database = seedPosterDatabase();
  const missing = await triggerRegistrationApprovedEmail(database.client, 'reg-inexistente');
  assert.equal(missing.success, false);
  assert.equal(sent.length, 1, 'inscrição inexistente não envia nada');
});

// ---------------------------------------------------------------------------
// Fluxo do navegador e do servidor (Stories 1.73 e 1.76)
// ---------------------------------------------------------------------------

test('um comprovante só: o modal abre o comprovante único e o ticket antigo saiu', () => {
  assert.match(registerModal, /import \{ RegistrationVoucher \} from '@\/components\/RegistrationVoucher'/);
  assert.match(registerModal, /if \(confirmedVoucher\) \{\s*return \(\s*<RegistrationVoucher/);
  assert.match(registerModal, /const onSuccess = useCallback\(\(registration: Registration, athlete: Athlete, cpf: string\) => \{\s*setConfirmedVoucher\(\{ registration, athlete \}\);\s*onSuccessProp\?\.\(registration, athlete, cpf\);/);
  assert.match(registerModal, /setIsSuccess\(false\);\s*setConfirmedVoucher\(null\);/, 'reabrir o modal limpa o comprovante');
  for (const gone of [/TICKET DIGITAL/, /WODA-REG-OK/, /secureTicketId/, /ticketBadge/]) {
    assert.doesNotMatch(registerModal, gone, String(gone));
  }
  // O título do painel de sucesso sem comprovante ficava branco sobre branco.
  assert.doesNotMatch(registerModal, /text-white uppercase">\{t\('successTitle'\)\}/);
  // A página do evento não abre um segundo comprovante a partir do mesmo sucesso.
  assert.doesNotMatch(eventView, /onSuccess=\{/);
  assert.match(eventView, /<RegisterModal\s+event=\{event\}\s+isOpen=\{isRegisterOpen\}\s+onClose=\{\(\) => setIsRegisterOpen\(false\)\}\s*\/>/);
});

test('o e-mail de confirmação sai só do servidor, uma vez por inscrição', () => {
  assert.doesNotMatch(registerModal, /\/api\/checkout\/email/);
  assert.doesNotMatch(pixModal, /\/api\/checkout\/email/);
  assert.match(serverCheckout, /idempotencyKey: `registration-confirmed\/\$\{registrationId\}`/);
  assert.match(startRoute, /await applyCouponUsageForApprovedRegistration\(supabaseAdmin, regId\);\s*\/\/[^\n]*\n\s*await triggerRegistrationApprovedEmail\(supabaseAdmin, regId\)/);
  assert.doesNotMatch(emailRoute, /idempotencyKey/, 'segunda via sempre envia');
  assert.doesNotMatch(emailRoute, /cpf/i, 'o CPF não viaja mais no pedido do e-mail');
  assert.match(emailRoute, /registration\.paymentStatus !== 'payment_approved'/);
});

test('retorno do cartão: o comprovante só abre com o status confirmado pelo servidor', () => {
  assert.match(eventView, /fetch\(`\/api\/checkout\/status\?\$\{statusParams\.toString\(\)\}`\)/);
  assert.match(eventView, /verified\?\.status === 'approved' && verified\.registrationData && verified\.athleteProfile/);
  assert.doesNotMatch(eventView, /mercadopago_preference/);
});

test('comprovante: frente com a imagem do servidor, verso completo, sem CPF nem impressão', () => {
  assert.match(voucher, /\/api\/registrations\/\$\{encodeURIComponent\(registration\.id\)\}\/poster\?format=story/);
  assert.match(voucher, /access_token=\$\{encodeURIComponent\(registration\.accessToken\)\}/);
  assert.match(voucher, /const hasFront = isPosterEligible\(registration\);/);
  assert.match(voucher, /const \[tab, setTab\] = useState<VoucherTab>\(hasFront \? 'front' : 'back'\);/);
  assert.match(voucher, /role="tablist"/);
  assert.match(voucher, /navigator\.canShare/);
  assert.match(voucher, /AbortError/, 'fechar a folha de compartilhamento não é erro');
  assert.match(voucher, /URL\.revokeObjectURL\(objectUrl\)/);
  assert.doesNotMatch(voucher, /window\.print|cpf|getMaskedCPF|2026-06-04/i);
  assert.match(voucher, /\{formattedIssueDate && <VoucherInfo/, 'sem data de criação não inventa emissão');
  assert.match(nextConfig, /outputFileTracingIncludes:\s*\{\s*"\/api\/\*\*\/\*": \["\.\/src\/assets\/fonts\/\*\.ttf"\]/);
});

test('textos do comprovante existem nos três idiomas e as chaves usadas estão todas lá', () => {
  const used = [...voucher.matchAll(/\bt\('([A-Za-z]+)'/g)].map((match) => match[1]);
  assert.ok(used.length > 20);
  for (const [locale, dictionary] of Object.entries(messages)) {
    for (const key of used) assert.ok(key in dictionary.Voucher, `${locale}: Voucher.${key}`);
    for (const key of ['cpfLabel', 'print', 'officialProof']) assert.ok(!(key in dictionary.Voucher), `${locale}: ${key} saiu`);
    assert.doesNotMatch(dictionary.Checkout.successDescription, /print|ticket|captura|screenshot/i, locale);
  }
  const keys = Object.fromEntries(Object.entries(messages).map(([locale, dictionary]) => [locale, Object.keys(dictionary.Voucher).sort()]));
  assert.deepEqual(keys['pt-pt'], keys['pt-br']);
  assert.deepEqual(keys['en-gb'], keys['pt-br']);
});
