import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createFakeSupabase } from './support/fakeSupabase.mjs';
import { importServerModule, setActiveSupabaseClient } from './support/serverModuleHarness.mjs';

// Stories 1.153 a 1.155: bandeira do estado no leaderboard. A regra de qual
// bandeira mostrar e do que gravar é pura e testada por comportamento; a rota de
// inscrição roda contra um banco em memória; o resto é regressão estática do
// que o desenho aprovado (docs/design/bandeiras-uf) exige.

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const block = (source, pattern) => source.match(pattern)?.[0] || '';

process.env.SUPABASE_URL = 'http://supabase.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.WODA_SESSION_SECRET = 'segredo-de-teste-story-1-153';
process.env.MERCADOPAGO_CLIENT_ID = 'mp-client-de-teste';
delete process.env.MERCADOPAGO_PLATFORM_USER_ID;

const flags = await importServerModule('lib/ufFlags.ts');
const { POST: startRegistration } = await importServerModule('app/api/registrations/start/route.ts');
const { UfFlag } = await importServerModule('components/UfFlag.tsx');
const { toUf, BRAZIL_UFS } = await importServerModule('lib/eventPlace.ts');
const serverCheckout = await importServerModule('lib/serverCheckout.ts');

const {
  BR_UFS, normalizeUf, normalizeStateForStorage, resolveAthleteFlag, ufFlagSrc, getUfName, isBrazilEventCountry
} = flags;

// ---------------------------------------------------------------------------
// Regra pura
// ---------------------------------------------------------------------------

test('as 27 UFs são únicas e cada uma tem nome e arquivo de bandeira', () => {
  assert.equal(BR_UFS.length, 27);
  assert.equal(new Set(BR_UFS.map((item) => item.uf)).size, 27);
  assert.equal(new Set(BR_UFS.map((item) => item.name)).size, 27);
  for (const { uf, name } of BR_UFS) {
    assert.match(uf, /^[A-Z]{2}$/);
    assert.equal(getUfName(uf), name);
    assert.equal(ufFlagSrc(uf), `/flags/br/${uf.toLowerCase()}.svg`);
  }
});

test('normalizeUf aceita sigla ou nome por extenso, sem depender de caixa, acento ou espaço', () => {
  for (const raw of ['ce', 'CE', ' ce ', 'Ceará', 'ceara', 'CEARÁ']) assert.equal(normalizeUf(raw), 'CE', raw);
  assert.equal(normalizeUf('São  Paulo'), 'SP');
  assert.equal(normalizeUf('sao paulo'), 'SP');
  assert.equal(normalizeUf('rio grande do norte'), 'RN');
  assert.equal(normalizeUf('Rio Grande do Sul'), 'RS');
  assert.equal(normalizeUf('Distrito Federal'), 'DF');
  assert.equal(normalizeUf('Espírito Santo'), 'ES');
});

test('normalizeUf nunca chuta: valor que não é UF vira null', () => {
  for (const raw of ['XX', 'BR', 'C', 'USA', 'Lisboa', 'Estado do Ceará', '', '   ', '12', null, undefined, 42, {}]) {
    assert.equal(normalizeUf(raw), null, String(raw));
  }
});

test('normalizeUf recusa sigla com lixo junto: dígito, pontuação ou parênteses não viram bandeira', () => {
  for (const raw of ['ce1', '2ce', 'SP2', 'PA-2025', '(CE)', 'ce.', 'CE/Ceará', 'PB - PARAÍBA', 'C E']) {
    assert.equal(normalizeUf(raw), null, raw);
  }
  // O leitor tolerante do texto livre do gestor continua em eventPlace.ts.
  assert.equal(toUf('PB - PARAÍBA'), 'PB');
});

test('há uma tabela de UFs só: eventPlace deriva de ufFlags', () => {
  assert.deepEqual([...BRAZIL_UFS], BR_UFS.map((item) => item.uf).sort());
  for (const { uf, name } of BR_UFS) {
    assert.equal(toUf(name), uf, name);
    assert.equal(toUf(uf), uf, uf);
  }
  const eventPlaceSource = read('../src/lib/eventPlace.ts');
  assert.match(eventPlaceSource, /import \{ BR_UFS, foldUfText \} from '@\/lib\/ufFlags';/);
  assert.doesNotMatch(eventPlaceSource, /acre: 'AC'|amapa: 'AP'/);
});

test('resolveAthleteFlag: só atleta individual, país BR, evento brasileiro e UF válida', () => {
  const ok = resolveAthleteFlag({ country: 'BR', state: 'ceará' }, 'BR');
  assert.deepEqual(ok, { uf: 'CE', name: 'Ceará' });
  // Sem país do atleta ou do evento, vale o padrão BR (eventos antigos não têm country_code).
  assert.equal(resolveAthleteFlag({ state: 'SP' })?.uf, 'SP');
  assert.equal(resolveAthleteFlag({ country: '', state: 'SP' }, '')?.uf, 'SP');

  // D4: equipe nunca tem bandeira, mesmo com estado válido.
  assert.equal(resolveAthleteFlag({ country: 'BR', state: 'CE', isTeam: true }, 'BR'), null);
  // PA existe no Brasil (Pará) e nos EUA (Pensilvânia): atleta US não ganha a bandeira do Pará.
  assert.equal(resolveAthleteFlag({ country: 'US', state: 'PA' }, 'BR'), null);
  // Evento em Portugal ou no Reino Unido: o campo é texto livre e nunca vira bandeira.
  assert.equal(resolveAthleteFlag({ country: 'BR', state: 'PA' }, 'PT'), null);
  assert.equal(resolveAthleteFlag({ country: 'BR', state: 'AL' }, 'GB'), null);
  // Sem estado ou com valor inválido: sem bandeira e sem erro.
  assert.equal(resolveAthleteFlag({ country: 'BR' }, 'BR'), null);
  assert.equal(resolveAthleteFlag({ country: 'BR', state: 'XX' }, 'BR'), null);
});

test('normalizeStateForStorage: UF no Brasil, texto livre fora dele', () => {
  assert.equal(normalizeStateForStorage('ceará', 'BR'), 'CE');
  assert.equal(normalizeStateForStorage('ce', undefined), 'CE');
  assert.equal(normalizeStateForStorage('XX', 'BR'), null);
  assert.equal(normalizeStateForStorage(undefined, 'BR'), null);
  assert.equal(normalizeStateForStorage(' Lisboa ', 'PT'), 'Lisboa');
  assert.equal(normalizeStateForStorage('   ', 'PT'), null);
  assert.equal(normalizeStateForStorage('x'.repeat(200), 'GB').length, 60);
  assert.equal(isBrazilEventCountry('BR'), true);
  assert.equal(isBrazilEventCountry(undefined), true);
  assert.equal(isBrazilEventCountry('PT'), false);
});

// ---------------------------------------------------------------------------
// Rota de inscrição: o que chega ao banco
// ---------------------------------------------------------------------------

const MANAGER_ID = 'mgr-1-154';

const buildSeed = (countryCode, athletes = []) => ({
  events: [{
    id: 'evt-1-154',
    name: 'Desafio 1.154',
    status: 'upcoming',
    date: '2099-06-01',
    registration_deadline: null,
    is_ticketing_active: true,
    ticket_price: 150,
    ticket_slots: 100,
    shirt_mode: 'included',
    shirt_addon_price: 0,
    organizer_id: MANAGER_ID,
    ...(countryCode ? { country_code: countryCode } : {})
  }],
  divisions: [{
    id: 'div-rx', event_id: 'evt-1-154', name: 'RX', price: 150, slots_limit: 0, is_active: true, type: 'individual', category: 'female'
  }],
  users: [{ id: MANAGER_ID, name: 'Gestor', email: 'gestor@example.com', role: 'manager', organization: 'Box', service_valid_until: '2099-12-31' }],
  users_secrets: [],
  athletes,
  registrations: [],
  coupons: [],
  mercadopago_accounts: [{
    user_id: MANAGER_ID, status: 'connected', expires_at: '2099-01-01T00:00:00.000Z', mercadopago_user_id: '123456',
    oauth_client_id: 'mp-client-de-teste', oauth_verified_at: '2026-01-01T00:00:00.000Z', public_key: 'TEST-public-key'
  }],
  mercadopago_secrets: [{ user_id: MANAGER_ID, access_token: 'TEST-access-token', refresh_token: 'TEST-refresh-token' }],
  platform_settings: [{ id: true, service_fee_enabled: true, service_fee_percent: 10 }]
});

let requestCount = 0;
const startWithState = async (countryCode, state, email, athletes = []) => {
  const database = createFakeSupabase(buildSeed(countryCode, athletes));
  setActiveSupabaseClient(database.client);
  requestCount += 1;
  const response = await startRegistration(new Request('http://localhost/api/registrations/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `203.0.113.${requestCount}` },
    body: JSON.stringify({
      registrationData: {
        eventId: 'evt-1-154', divisionId: 'div-rx', athleteName: 'Bia Lima', athleteEmail: email, athletePhone: '85988887777',
        box: 'Box Bia', gender: 'female', ticketType: 'RX', ticketPrice: 150, quantity: 1, totalPaid: 150
      },
      athleteProfile: {
        name: 'Bia Lima', box: 'Box Bia', country: 'BR', divisionId: 'div-rx', birthDate: '1995-05-05', city: 'Fortaleza', state,
        photoUrl: '', shirtSize: 'M', email, phone: '85988887777', gender: 'female', instagram: 'bia', isTeam: false, teamMembers: []
      },
      password: 'segredo1',
      passwordConfirmation: 'segredo1',
      paymentMethod: 'pix'
    })
  }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return database.rows('athletes').find((athlete) => athlete.email === email);
};

test('a inscrição grava a UF mesmo quando o navegador manda o nome por extenso ou em minúsculas', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'log', () => {});
  assert.equal((await startWithState('BR', 'ceará', 'a1@example.com')).state, 'CE');
  assert.equal((await startWithState('BR', 'sp', 'a2@example.com')).state, 'SP');
  // Evento antigo, sem country_code, é brasileiro.
  assert.equal((await startWithState(undefined, 'Rio de Janeiro', 'a3@example.com')).state, 'RJ');
});

test('a inscrição não grava valor que não é UF em evento brasileiro', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'log', () => {});
  const athlete = await startWithState('BR', 'XX', 'b1@example.com');
  assert.ok(athlete.state === null || athlete.state === undefined, `state: ${athlete.state}`);
});

test('evento fora do Brasil segue com texto livre (Distrito) e não vira UF', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'log', () => {});
  const athlete = await startWithState('PT', 'Lisboa', 'c1@example.com');
  assert.equal(athlete.state, 'Lisboa');
  // "PA" num evento português é uma sigla de distrito, não o Pará: grava como veio e o leaderboard não mostra bandeira.
  const pa = await startWithState('PT', 'PA', 'c2@example.com');
  assert.equal(pa.state, 'PA');
  assert.equal(resolveAthleteFlag({ country: pa.country, state: pa.state }, 'PT'), null);
});

const existingAthlete = (email, state) => ({
  id: 'ath-4f1d2c3b-6e7a-4b8c-9d0e-1f2a3b4c5d6e', name: 'Bia Lima', box: 'Box Bia', country: 'BR', division_id: 'div-rx',
  email, phone: '85988887777', shirt_size: 'M', is_team: false, team_members: '[]', state
});

test('atleta que já existe (PIX expirado, cadastro anterior à bandeira) tem a UF gravada ao escolher o estado', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'log', () => {});
  const email = 'd1@example.com';
  assert.equal((await startWithState('BR', 'ceará', email, [existingAthlete(email, null)])).state, 'CE');
  const kept = await startWithState('BR', '', 'd2@example.com', [existingAthlete('d2@example.com', 'SP')]);
  assert.equal(kept.state, 'SP', 'sem estado novo, o que já estava gravado fica');
  const replaced = await startWithState('BR', 'RJ', 'd3@example.com', [existingAthlete('d3@example.com', 'SP')]);
  assert.equal(replaced.state, 'RJ', 'estado escolhido agora vale');
  const junk = await startWithState('BR', 'XX', 'd4@example.com', [existingAthlete('d4@example.com', 'SP')]);
  assert.equal(junk.state, 'SP', 'valor que não é UF nunca apaga o estado existente');
});

const managerInput = (email, state) => ({
  eventId: 'evt-1-154', divisionId: 'div-rx', athleteName: 'Carla Melo', athleteEmail: email,
  athletePhone: '85911112222', gender: 'female', shirtSize: 'G', state
});

const registerAsManager = async (countryCode, athletes, input) => {
  const database = createFakeSupabase(buildSeed(countryCode, athletes));
  setActiveSupabaseClient(database.client);
  await serverCheckout.createManagerRegistration(database.client, input);
  return database.rows('athletes').find((athlete) => athlete.email === input.athleteEmail);
};

test('inscrição manual do gestor grava a UF normalizada, em atleta novo e existente', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'log', () => {});
  assert.equal((await registerAsManager('BR', [], managerInput('m1@example.com', 'ceará'))).state, 'CE');
  assert.equal((await registerAsManager('BR', [existingAthlete('m2@example.com', null)], managerInput('m2@example.com', 'sp'))).state, 'SP');
  assert.equal((await registerAsManager('BR', [existingAthlete('m3@example.com', 'SP')], managerInput('m3@example.com', undefined))).state, 'SP');
  const invalid = await registerAsManager('BR', [], managerInput('m4@example.com', 'XX'));
  assert.ok(invalid.state === null || invalid.state === undefined);
  assert.equal((await registerAsManager('PT', [], managerInput('m5@example.com', 'Lisboa'))).state, 'Lisboa');
});

// ---------------------------------------------------------------------------
// Regressão estática
// ---------------------------------------------------------------------------

test('os 27 arquivos de bandeira existem, são SVG limpos e têm aviso de origem e licença', () => {
  const dir = new URL('../public/flags/br/', import.meta.url);
  const files = readdirSync(dir).sort();
  assert.deepEqual(files, BR_UFS.map((item) => `${item.uf.toLowerCase()}.svg`).sort());
  for (const file of files) {
    const svg = readFileSync(new URL(file, dir), 'utf8');
    assert.match(svg, /^<svg [^>]*viewBox="0 0 300 200"/, file);
    assert.doesNotMatch(svg, /<script|onload=|onerror=|href=|<image|foreignObject|javascript:/i, file);
  }
  const notice = read('../public/flags/NOTICE');
  assert.match(notice, /pierrelapalu\/icones-bandeiras-br-uf/);
  assert.match(notice, /CC0/);
});

const ufFlag = read('../src/components/UfFlag.tsx');

test('UfFlag é uma imagem decorativa de tamanho fixo (18, 24 e 36 px), nunca SVG inline', () => {
  assert.match(ufFlag, /sm: \{ width: 18, height: 12 \}/);
  assert.match(ufFlag, /md: \{ width: 24, height: 16 \}/);
  assert.match(ufFlag, /lg: \{ width: 36, height: 24 \}/);
  assert.match(ufFlag, /<img\s/);
  assert.match(ufFlag, /alt=""/);
  assert.match(ufFlag, /aria-hidden="true"/);
  assert.match(ufFlag, /src=\{ufFlagSrc\(uf\)\}/);
  assert.doesNotMatch(ufFlag, /dangerouslySetInnerHTML|<svg/);
  // Carrega na hora: as bandeiras da primeira tela do ranking não podem aparecer atrasadas.
  assert.doesNotMatch(ufFlag, /loading="lazy"/);
});

test('UfFlag renderizado: imagem de tamanho fixo, decorativa, com o nome do estado só no title', () => {
  const sizes = { sm: [18, 12], md: [24, 16], lg: [36, 24] };
  for (const [size, [width, height]] of Object.entries(sizes)) {
    // O React 19 pode antecipar a imagem com um <link rel="preload">; o que importa é o <img>.
    const html = renderToStaticMarkup(createElement(UfFlag, { uf: 'CE', size })).match(/<img [^>]*>/)?.[0] ?? '';
    assert.match(html, /^<img /);
    assert.match(html, /src="\/flags\/br\/ce\.svg"/);
    assert.match(html, new RegExp(`width="${width}" height="${height}"`));
    assert.match(html, /alt=""/);
    assert.match(html, /aria-hidden="true"/);
    assert.match(html, /title="Ceará"/);
  }
  // Tamanho padrão: 24 × 16 (a bandeira do desktop).
  assert.match(renderToStaticMarkup(createElement(UfFlag, { uf: 'SP' })), /width="24" height="16"/);
  // Toda UF aponta para um arquivo que existe.
  for (const { uf } of BR_UFS) {
    const src = renderToStaticMarkup(createElement(UfFlag, { uf })).match(/src="([^"]+)"/)[1];
    assert.equal(existsSync(new URL(`../public${src}`, import.meta.url)), true, src);
  }
});

const leaderboard = read('../src/components/Leaderboard.tsx');
const participantCell = leaderboard.slice(
  leaderboard.indexOf('const LeaderboardParticipantCell'),
  leaderboard.indexOf('const LeaderboardParticipantHeader')
);

test('o leaderboard calcula as bandeiras da categoria uma vez e passa às quatro células', () => {
  assert.match(leaderboard, /import \{ resolveAthleteFlag, type AthleteFlag \} from '@\/lib\/ufFlags';/);
  assert.match(leaderboard, /const flagsByAthleteId = useMemo\(/);
  assert.match(leaderboard, /resolveAthleteFlag\(row\.athlete, event\.countryCode\)/);
  assert.match(leaderboard, /const hasAnyFlag = flagsByAthleteId\.size > 0;/);
  const cells = leaderboard.match(/<LeaderboardParticipantCell\b[\s\S]*?\/>/g) || [];
  assert.equal(cells.length, 4);
  for (const cell of cells) assert.match(cell, /flag=\{flagsByAthleteId\.get\(row\.athlete\.id\) \?\? null\}/);
  // Só as células de desktop reservam a faixa da bandeira (D3).
  assert.equal(cells.filter((cell) => /showFlagSlot=\{hasAnyFlag\}/.test(cell)).length, 2);
  assert.equal(cells.filter((cell) => /^\s*compact$/m.test(cell)).length, 2);
});

test('célula do participante: bandeira de 24 px antes do nome no desktop, 18 px sob a colocação no celular (D3)', () => {
  assert.ok(participantCell.length > 0);
  assert.match(participantCell, /min-h-16 grid-cols-\[2\.5rem_1\.5rem_1fr\] gap-x-3 pl-2 pr-4/);
  assert.match(participantCell, /min-h-16 grid-cols-\[2\.5rem_1fr\] gap-x-3\.5 pl-2 pr-4/);
  assert.match(participantCell, /min-h-14 grid-cols-\[1\.375rem_1fr\] gap-x-2 pl-1 pr-2/);
  assert.match(participantCell, /const hasFlagSlot = !compact && showFlagSlot;/);
  assert.match(participantCell, /\{compact && flag && <UfFlag uf=\{flag\.uf\} size="sm" \/>\}/);
  assert.match(participantCell, /<UfFlag uf=\{flag\.uf\} size="md" \/> : <span aria-hidden="true" className="block h-4 w-6" \/>/);
  // A sigla acompanha o país: "BR · CE".
  assert.match(participantCell, /\{flag \? `\$\{athlete\.country\} · \$\{flag\.uf\}` : athlete\.country\}/);
  // O estado entra no rótulo do botão: a imagem nunca é a única forma de ler o estado.
  assert.match(participantCell, /flag \? t\('openProfileWithStateAria', \{ name: displayName, state: flag\.name \}\) : t\('openProfileAria', \{ name: displayName \}\)/);
  // Story 1.36: colocação em número simples, sem círculo nem cor de pódio.
  assert.doesNotMatch(participantCell, /rounded-full/);
  assert.match(participantCell, /text-right font-number font-bold/);
});

test('o perfil do atleta mostra a bandeira ao lado de "Cidade / UF" com o nome do estado; equipe não (D4)', () => {
  const profile = block(leaderboard, /const AthleteLocationLine = [\s\S]*?\n\};/);
  assert.ok(profile, 'AthleteLocationLine deve existir');
  assert.match(profile, /<UfFlag uf=\{flag\.uf\} size="lg" \/>/);
  // Com bandeira, a linha imprime a sigla normalizada: "Ceará" cadastrado não vira "Ceará · Ceará".
  assert.match(profile, /\$\{flag \? flag\.uf : athlete\.state \|\| ''\}/);
  assert.match(profile, /`\$\{cityLine\} · \$\{flag\.name\}`/);
  assert.match(profile, /t\('locationNotInformed'\)/);
  assert.match(leaderboard, /<AthleteLocationLine athlete=\{selectedAthleteForProfile\} flag=\{flagsByAthleteId\.get\(selectedAthleteForProfile\.id\) \?\? null\} \/>/);
  assert.doesNotMatch(leaderboard, /const profileFlag = /);
  const team = leaderboard.slice(leaderboard.indexOf('selectedTeamForProfile &&'));
  assert.doesNotMatch(team, /UfFlag/);
});

const registerModal = read('../src/components/RegisterModal.tsx');

test('o formulário pede o estado em seletor de UF: obrigatório no Race, opcional no resto, texto livre fora do Brasil', () => {
  assert.match(registerModal, /import \{ isBrazilEventCountry \} from '@\/lib\/ufFlags';/);
  assert.match(registerModal, /const isBrazilEvent = isBrazilEventCountry\(event\.countryCode\);/);
  assert.match(registerModal, /import \{ UfSelect \} from '@\/components\/UfSelect';/);
  const selects = registerModal.match(/<UfSelect\s[\s\S]*?\/>/g) || [];
  assert.equal(selects.length, 2);
  const [required, optional] = selects;
  assert.match(required, /\brequired\b/);
  assert.doesNotMatch(optional, /\brequired\b/);
  for (const select of selects) {
    assert.match(select, /id=\{`athlete-\$\{index\}-state`\}/);
    assert.match(select, /value=\{participant\.state\}/);
    assert.match(select, /onChange=\{\(uf\) => updateParticipant\(index, 'state', uf\)\}/);
  }
  assert.match(required, /placeholder=\{t\('stateBirthPlaceholder'\)\}/);
  // A lista de UFs e o valor normalizado moram num componente só.
  const ufSelect = read('../src/components/UfSelect.tsx');
  assert.match(ufSelect, /value=\{normalizeUf\(value\) \?\? ''\}/);
  assert.match(ufSelect, /BR_UFS\.map\(\(item\) =>/);
  assert.match(ufSelect, /\{item\.uf\} · \{item\.name\}/);
  assert.doesNotMatch(registerModal, /BR_UFS|<select\s+id=\{`athlete-\$\{index\}-state`\}/);
  assert.match(registerModal, /t\('stateBirthLabelRequired'\)/);
  assert.match(registerModal, /t\('stateBirthLabelOptional'\)/);
  // Opcional só no Functional Fitness e no Qualifier, em evento brasileiro e para atleta individual.
  assert.match(registerModal, /\{!isFitnessRacing && isBrazilEvent && !isTeamCategory && \(/);
  // Aviso de que a bandeira fica pública (D6).
  assert.match(registerModal, /\{isBrazilEvent && !isTeamCategory && \(\s*<p className="text-\[11px\] leading-snug text-muted">\{t\('stateBirthFlagNotice'\)\}<\/p>/);
  // Fora do Brasil, o texto livre do "Distrito" continua.
  assert.match(registerModal, /<input\s+id=\{`athlete-\$\{index\}-state`\}[\s\S]*?type="text"[\s\S]*?t\('stateUfPlaceholder'\)/);
  // O Race continua exigindo o estado.
  assert.match(registerModal, /if \(isFitnessRacing\) return !participant\.birthDate \|\| !participant\.city \|\| !participant\.state;/);
  // A normalização fica no servidor; o handleSubmit segue enviando o valor do campo.
  assert.match(registerModal, /state: primaryParticipant\.state,/);
  assert.doesNotMatch(block(registerModal, /const handleSubmit = useCallback\([\s\S]*?\n  \}, \[/), /normalizeUf|isBrazilEvent/);
});

test('o servidor normaliza o estado no snapshot da inscrição e na inscrição manual do gestor', () => {
  const checkout = read('../src/lib/serverCheckout.ts');
  assert.match(checkout, /import \{ normalizeStateForStorage \} from '@\/lib\/ufFlags';/);
  assert.match(checkout, /shirt_addon_price, time_zone, country_code'/);
  assert.match(checkout, /const eventCountryCode = asString\(event\.country_code\) \|\| undefined;/);
  assert.match(checkout, /state: normalizeStateForStorage\(clientAthleteProfile\.state, eventCountryCode\) \?\? undefined/);
  // A rota grava o estado que saiu do snapshot, nunca o do corpo da requisição.
  const route = read('../src/app/api/registrations/start/route.ts');
  assert.match(route, /state: safeAthleteProfile\.state \|\| null,/);
  // Atleta que já existe: a UF escolhida agora é gravada, e sem escolha o estado antigo fica.
  assert.match(route, /\.\.\.\(safeAthleteProfile\.state \? \{ state: safeAthleteProfile\.state \} : \{\}\)/);
  assert.match(checkout, /const safeState = normalizeStateForStorage\(input\.state, secureSnapshot\.eventCountryCode\);/);
  assert.match(checkout, /\.\.\.\(safeState \? \{ state: safeState \} : \{\}\)/);
  assert.match(checkout, /state: safeState,/);
});

test('textos novos nos três idiomas, com os mesmos argumentos', () => {
  const KEYS = [
    ['Leaderboard', 'openProfileWithStateAria'],
    ['Checkout', 'stateBirthLabelRequired'],
    ['Checkout', 'stateBirthLabelOptional'],
    ['Checkout', 'stateBirthPlaceholder'],
    ['Checkout', 'stateBirthFlagNotice']
  ];
  const args = (text) => [...new Set(text.match(/\{\w+\}/g) || [])].sort();
  for (const [namespace, key] of KEYS) {
    const values = ['pt-br', 'pt-pt', 'en-gb'].map((locale) => JSON.parse(read(`../src/messages/${locale}.json`))[namespace][key]);
    for (const value of values) assert.ok(typeof value === 'string' && value.length > 0, `${namespace}.${key}`);
    assert.deepEqual(args(values[1]), args(values[0]), `${namespace}.${key} pt-pt`);
    assert.deepEqual(args(values[2]), args(values[0]), `${namespace}.${key} en-gb`);
  }
  const ptBr = JSON.parse(read('../src/messages/pt-br.json'));
  assert.match(ptBr.Checkout.stateBirthLabelRequired, /nascimento/);
  assert.deepEqual(args(ptBr.Leaderboard.openProfileWithStateAria), ['{name}', '{state}']);
});

test('política de privacidade e PRODUCT.md dizem que a bandeira do estado fica pública (D6)', () => {
  const terms = read('../src/app/[locale]/termos/page.tsx');
  assert.match(terms, /a bandeira desse estado\) serão exibidas publicamente nos Leaderboards/);
  const product = read('../PRODUCT.md');
  assert.match(product, /localização \(cidade e estado\)/);
  assert.match(product, /Story 1\.153/);
  assert.doesNotMatch(product, /além do nome sanitizado e do box\./);
});

test('a maquete aprovada e as decisões estão no repositório', () => {
  assert.equal(existsSync(new URL('../docs/design/bandeiras-uf/maquete.html', import.meta.url)), true);
  const readme = read('../docs/design/bandeiras-uf/README.md');
  for (const decision of ['D1', 'D2', 'D3', 'D4', 'D5', 'D6']) assert.match(readme, new RegExp(`\\| ${decision} \\|`));
});
