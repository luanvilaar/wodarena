import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { importServerModule } from './support/serverModuleHarness.mjs';

// Stories 1.41 e 1.42: card público na aba Detalhes com o mapa interativo do
// Mapbox, links de "Como chegar", campo de coordenadas no painel, CSP e textos
// nos três idiomas. Os componentes reais são renderizados no servidor
// (react-dom/server) e o restante é regressão estática. O Mapbox GL JS não roda
// aqui (precisa de navegador); o desenho final foi conferido no navegador.

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const eventView = read('../src/app/[locale]/event/[id]/EventView.tsx');
const locationCard = read('../src/components/EventLocationCard.tsx');
const eventMap = read('../src/components/EventMap.tsx');
const mapView = read('../src/components/EventMapView.tsx');
const picker = read('../src/components/admin/EventLocationPicker.tsx');
const adminPage = read('../src/app/admin/page.tsx');
const globalsCss = read('../src/app/globals.css');
const nextConfig = read('../next.config.ts');
const securityDoc = read('../docs/security/security-headers.md');
const packageJson = JSON.parse(read('../package.json'));
const messages = {
  'pt-br': JSON.parse(read('../src/messages/pt-br.json')),
  'pt-pt': JSON.parse(read('../src/messages/pt-pt.json')),
  'en-gb': JSON.parse(read('../src/messages/en-gb.json'))
};

const { EventLocationCard } = await importServerModule('components/EventLocationCard.tsx');
const { EventLocationPicker, toCoordinatesInput } = await importServerModule('components/admin/EventLocationPicker.tsx');

const block = (source, pattern) => source.match(pattern)?.[0] || '';
const decode = (value) => value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
const attributeValues = (html, tag, attribute) => [...html.matchAll(new RegExp(`<${tag}\\b[^>]*\\s${attribute}="([^"]*)"`, 'g'))].map((match) => decode(match[1]));
const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const url = new URL(name, dir);
  return statSync(url).isDirectory() ? walk(new URL(`${name}/`, dir)) : [url];
});

const LABELS = Object.fromEntries(Object.entries(messages['pt-br'].Event.map));

// O mapa só aparece com token no navegador; o helper lê a variável a cada chamada.
const TEST_TOKEN = 'pk.tokenFicticioStory142.NaoUsarEmLugarNenhum';
const withMapToken = (token, run) => {
  const previous = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (token === undefined || token === null) delete process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  else process.env.NEXT_PUBLIC_MAPBOX_TOKEN = token;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    else process.env.NEXT_PUBLIC_MAPBOX_TOKEN = previous;
  }
};

const renderCard = (props, token = TEST_TOKEN) => withMapToken(token, () => renderToStaticMarkup(createElement(EventLocationCard, {
  location: 'Arena Beach',
  city: 'João Pessoa',
  state: 'PB',
  labels: LABELS,
  ...props
})));

test('EventView: card só na aba Detalhes, abaixo de "Sobre o Evento", oculto na qualificatória online', () => {
  const detailsTab = block(eventView, /\{activeTab === 'details' && \([\s\S]*?\n {12}\)\}/);
  assert.ok(detailsTab, 'bloco da aba Detalhes');
  assert.match(detailsTab, /tDetails\('heading'\)[\s\S]*\{!isQualifierEvent && \(\s*<EventLocationCard/);
  assert.equal((eventView.match(/<EventLocationCard\b/g) || []).length, 1, 'card renderizado uma única vez');

  const sidebar = eventView.slice(eventView.indexOf('Sidebar Lateral de Detalhes'));
  assert.ok(sidebar.length > 0);
  assert.doesNotMatch(sidebar, /EventLocationCard|EventMap|embed\.waze/);

  assert.match(eventView, /const isQualifierEvent = event\.eventType === 'functional_fitness_qualifier';/);
  assert.match(eventView, /const tMap = useTranslations\('Event\.map'\);/);
  assert.match(detailsTab, /latitude=\{event\.latitude\}\s*longitude=\{event\.longitude\}/);
  assert.doesNotMatch(eventView, /wazeIcon|WazeLogo/, 'a logo do Waze saiu');
  for (const key of Object.keys(LABELS)) {
    assert.match(detailsTab, new RegExp(`${key}: tMap\\('${key}'\\)`), key);
  }
});

test('EventView: cabeçalho e "Local das Baterias" seguem iguais', () => {
  assert.match(eventView, /<MapPin className="h-3\.5 w-3\.5 text-muted shrink-0" \/>\s*<span className="font-semibold text-white">\{event\.location\}<\/span>/);
  assert.match(eventView, /\{event\.eventType === 'functional_fitness_qualifier' \? tDetails\('modalityHeading'\) : tDetails\('venueHeading'\)\}/);
  assert.match(eventView, /\{event\.eventType === 'functional_fitness_qualifier' \? tDetails\('onlineQualifier'\) : event\.location\}/);
});

test('com coordenadas e token: o card tem a região do mapa, sem iframe, sem logo do Waze e sem o token no HTML', () => {
  const html = renderCard({ latitude: -7.1195, longitude: -34.845 });
  assert.match(html, /<div data-event-map="true" role="region" aria-label="Mapa com o local do evento" class="relative h-64 w-full overflow-hidden rounded-lg border border-card-border bg-dark-gray sm:h-80"><\/div>/);
  assert.doesNotMatch(html, /<iframe|embed\.waze|Toque para interagir|Mapa: Waze|<figcaption/);
  assert.doesNotMatch(html, /M13\.218 0C9\.915|#33CCFF/, 'logo do Waze');
  // Antes de o card chegar perto da tela a biblioteca nem foi pedida: só o bloco com altura reservada.
  assert.ok(!html.includes(TEST_TOKEN), 'o token não vai no HTML renderizado no servidor');
  // O mapa vem entre o endereço e "Como chegar".
  assert.ok(html.indexOf('<p ') < html.indexOf('data-event-map') && html.indexOf('data-event-map') < html.indexOf('Como chegar'));
});

test('"Como chegar" com coordenadas: Waze principal só com texto, Google Maps, Apple Maps e Copiar endereço', () => {
  const html = renderCard({ latitude: -7.1195, longitude: -34.845 });
  const links = attributeValues(html, 'a', 'href');
  assert.deepEqual(links, [
    'https://waze.com/ul?ll=-7.1195,-34.845&navigate=yes&zoom=17&utm_source=wodarena',
    'https://www.google.com/maps/dir/?api=1&destination=-7.1195%2C-34.845',
    'https://maps.apple.com/?daddr=-7.1195,-34.845'
  ]);
  const anchors = html.match(/<a\b[^>]*>/g) || [];
  assert.equal(anchors.length, 3);
  for (const anchor of anchors) {
    assert.match(anchor, /target="_blank"/);
    assert.match(anchor, /rel="noopener noreferrer"/);
  }
  assert.match(html, /<a href="https:\/\/waze\.com\/ul[^"]*"[^>]*><span>Waze<\/span><\/a>/, 'botão do Waze só com o texto');
  assert.match(html, />Google Maps<\/a>/);
  assert.match(html, />Apple Maps<\/a>/);
  assert.match(html, /<button type="button"[^>]*>[\s\S]*<span aria-live="polite">Copiar endereço<\/span><\/button>/);
  assert.doesNotMatch(html, /waze:\/\//);
});

test('sem token, sem ponto ou com ponto inválido: sem mapa, só os botões', () => {
  // Sem token no navegador o card segue funcionando só com os botões.
  const withoutToken = renderCard({ latitude: -7.1195, longitude: -34.845 }, null);
  assert.doesNotMatch(withoutToken, /data-event-map/);
  assert.match(withoutToken, /https:\/\/waze\.com\/ul\?ll=-7\.1195,-34\.845/);
  assert.equal(renderCard({ latitude: -7.1195, longitude: -34.845 }, '   ').includes('data-event-map'), false, 'token só com espaços');

  const html = renderCard({ location: 'Arena Beach & Fit', latitude: undefined, longitude: undefined });
  assert.doesNotMatch(html, /data-event-map|<iframe/);
  assert.deepEqual(attributeValues(html, 'a', 'href'), [
    'https://waze.com/ul?q=Arena%20Beach%20%26%20Fit%2C%20Jo%C3%A3o%20Pessoa%2C%20PB&utm_source=wodarena',
    'https://www.google.com/maps/dir/?api=1&destination=Arena%20Beach%20%26%20Fit%2C%20Jo%C3%A3o%20Pessoa%2C%20PB',
    'https://maps.apple.com/?daddr=Arena%20Beach%20%26%20Fit%2C%20Jo%C3%A3o%20Pessoa%2C%20PB'
  ]);
  assert.match(html, /Arena Beach &amp; Fit, João Pessoa, PB/);
  assert.match(html, /Copiar endereço/);

  // Ponto inválido (ou só um dos dois) também não vira mapa.
  for (const point of [{ latitude: 95, longitude: 0 }, { latitude: -7.1, longitude: null }, { latitude: '-7.1', longitude: '-34.8' }]) {
    assert.doesNotMatch(renderCard(point), /data-event-map/, JSON.stringify(point));
  }
  // Sem texto e sem ponto o card não aparece.
  assert.equal(renderCard({ location: '', city: '', state: '' }), '');
  // Zero é ponto válido.
  assert.match(renderCard({ latitude: 0, longitude: 0 }), /data-event-map="true"/);
});

test('endereço do card, "Copiar endereço" e links por texto não repetem Cidade e Estado do Local', () => {
  const html = renderCard({
    location: 'R. Jose de Almeida Noronha, Quadra 155 - Lote 14 - Portal do Sol, João Pessoa - PB, 58046-503',
    city: 'JOAO PESSOA',
    state: 'PB - PARAÍBA',
    latitude: undefined,
    longitude: undefined
  });
  assert.match(html, /<span>R\. Jose de Almeida Noronha, Quadra 155 - Lote 14 - Portal do Sol, João Pessoa - PB, 58046-503<\/span>/);
  assert.doesNotMatch(html, /JOAO PESSOA|PARAÍBA|PARA%C3%8DBA/);
  assert.match(attributeValues(html, 'a', 'href')[0], /^https:\/\/waze\.com\/ul\?q=R\.%20Jose%20de%20Almeida%20Noronha%2C[^&]*503&utm_source=wodarena$/);
});

test('o iframe e a logo do Waze foram removidos (Story 1.42)', () => {
  assert.equal(existsSync(new URL('../src/components/EventMapEmbed.tsx', import.meta.url)), false);
  assert.equal(existsSync(new URL('../src/components/WazeLogo.tsx', import.meta.url)), false);
  assert.doesNotMatch(locationCard, /wazeIcon|WazeLogo|EventMapEmbed|iframe/i);
  assert.doesNotMatch(globalsCss, /data-event-map-activate/);
  for (const url of walk(new URL('../src/', import.meta.url)).filter((file) => /\.(tsx?|json|css)$/.test(file.pathname))) {
    assert.doesNotMatch(readFileSync(url, 'utf8'), /embed\.waze\.com|buildWazeEmbedUrl/, url.pathname);
  }
});

test('componentes: copiar usa a área de transferência e o card entrega o mapa ao EventMap', () => {
  assert.match(locationCard, /await navigator\.clipboard\.writeText\(searchText\);\s*setCopied\(true\);/);
  assert.match(locationCard, /\{coordinates && <EventMap coordinates=\{coordinates\} labels=\{labels\} \/>\}/);
});

test('EventMap: o Mapbox GL JS carrega sob demanda, perto da tela, e só com token', () => {
  assert.match(eventMap, /const EventMapView = dynamic\(\s*\(\) => import\('@\/components\/EventMapView'\)\.then\(\(module\) => module\.EventMapView\),\s*\{ ssr: false \}\s*\);/);
  assert.match(eventMap, /const NEAR_VIEWPORT_MARGIN = '200px';/);
  assert.match(eventMap, /new IntersectionObserver\([\s\S]*\{ rootMargin: NEAR_VIEWPORT_MARGIN \}\)/);
  assert.match(eventMap, /typeof IntersectionObserver === 'undefined'/);
  assert.match(eventMap, /const token = getMapboxPublicToken\(\);/);
  assert.match(eventMap, /if \(!token \|\| unavailable\) return null;/);
  assert.match(eventMap, /\{near && \(\s*<EventMapView/);
  assert.match(eventMap, /onUnavailable=\{\(\) => setUnavailable\(true\)\}/);
  assert.doesNotMatch(eventMap, /from 'mapbox-gl'|useTranslations|next-intl/, 'textos chegam por props');

  const importers = walk(new URL('../src/', import.meta.url))
    .filter((url) => /from 'mapbox-gl'|mapbox-gl\/dist/.test(readFileSync(url, 'utf8')))
    .map((url) => url.pathname.slice(new URL('../src/', import.meta.url).pathname.length));
  assert.deepEqual(importers, ['components/EventMapView.tsx'], 'só o módulo carregado sob demanda importa a biblioteca');
});

test('EventMapView: estilo escuro, zoom 15, marcador da marca, gestos cooperativos e atribuição preservada', () => {
  assert.match(mapView, /import mapboxgl from 'mapbox-gl';\s*import 'mapbox-gl\/dist\/mapbox-gl\.css';/);
  assert.match(mapView, /const MAP_STYLE = 'mapbox:\/\/styles\/mapbox\/dark-v11';/);
  assert.match(mapView, /const MARKER_COLOR = '#fcd535';/);
  assert.match(mapView, /accessToken: token,/);
  assert.match(mapView, /zoom: EVENT_MAP_ZOOM,/);
  assert.match(mapView, /cooperativeGestures: true,/);
  for (const key of ['ScrollZoomBlocker.CtrlMessage', 'ScrollZoomBlocker.CmdMessage', 'TouchPanBlocker.Message']) {
    assert.match(mapView, new RegExp(`'${key}': text\\.`), key);
  }
  assert.match(mapView, /new mapboxgl\.NavigationControl\(\{ showCompass: false \}\)/);
  assert.match(mapView, /marker\.getElement\(\)\.setAttribute\('aria-label', text\.markerLabel\);/);
  assert.match(mapView, /marker\.remove\(\);\s*map\.remove\(\);[\s\S]*?container\.replaceChildren\(\);/);
  assert.match(mapView, /status === 401 \|\| status === 403/);
  assert.match(mapView, /map\.jumpTo\(\{ center: \[coordinates\.longitude, coordinates\.latitude\] \}\);/);
  // O logo e a atribuição do Mapbox e do OpenStreetMap ficam como o Mapbox os desenha.
  assert.doesNotMatch(mapView, /attributionControl|logoPosition|mapbox-logo|mapboxgl-ctrl-logo|mapboxgl-ctrl-attrib/);
  assert.doesNotMatch(mapView, /useTranslations|next-intl/, 'textos chegam por props');
  assert.match(globalsCss, /\[data-event-map\] canvas:focus-visible,\s*\[data-event-map\] \.mapboxgl-canvas-container:focus-visible,\s*\[data-event-map\] \.mapboxgl-ctrl button:focus-visible\s*\{\s*outline-offset:\s*-4px;/);
});

test('painel: campo de coordenadas nos formulários de criação e de edição, com o país do evento', () => {
  assert.match(adminPage, /import \{ EventLocationPicker, toCoordinatesInput \} from '@\/components\/admin\/EventLocationPicker';/);
  assert.equal((adminPage.match(/<EventLocationPicker\b/g) || []).length, 2);
  assert.match(adminPage, /<EventLocationPicker\s+idPrefix="new-event"\s+value=\{eventCoordinates\}\s+onChange=\{setEventCoordinates\}\s+location=\{eventLocation\}\s+city=\{eventCity\}\s+state=\{eventState\}\s+country="BR"\s+inputRef=\{eventCoordinatesRef\}/);
  assert.match(adminPage, /<EventLocationPicker\s+idPrefix="edit-event"\s+value=\{editEventCoordinates\}[\s\S]*?setEditEventCoordinatesChanged\(true\);[\s\S]*?location=\{editEventLocation\}\s+city=\{editEventCity\}\s+state=\{editEventState\}\s+country=\{selectedEventToManage\?\.countryCode \?\? 'BR'\}\s+inputRef=\{editEventCoordinatesRef\}/);
  // Logo depois de Cidade/Estado nos dois formulários.
  assert.match(adminPage, /value=\{eventState\}[\s\S]{0,400}<EventLocationPicker\s+idPrefix="new-event"/);
  assert.match(adminPage, /value=\{editEventState\}[\s\S]{0,400}<EventLocationPicker\s+idPrefix="edit-event"/);
});

test('painel: salvar bloqueia coordenada inválida com aviso e foco; criação só envia com ponto; edição só quando alterado', () => {
  const create = block(adminPage, /const handleCreateEvent = async[\s\S]*?\n {2}\};/);
  assert.match(create, /const mapPoint = parseCoordinatesInput\(eventCoordinates\);\s*if \(!mapPoint\.ok\) \{\s*setAdminNotice\(\{ text: `Revise as coordenadas do local: \$\{mapPoint\.error\}`, tone: 'error' \}\);\s*eventCoordinatesRef\.current\?\.focus\(\);\s*return;/);
  assert.match(create, /\.\.\.\(mapPoint\.coordinates\s*\? \{ latitude: mapPoint\.coordinates\.latitude, longitude: mapPoint\.coordinates\.longitude \}\s*: \{\}\)/);
  assert.match(create, /setEventCoordinates\(''\);/);

  const init = block(adminPage, /const initEventEditForm = \(evt: Event\) => \{[\s\S]*?setHeatDivisionFilterId/);
  assert.match(init, /setEditEventCoordinates\(toCoordinatesInput\(evt\.latitude, evt\.longitude\)\);\s*setEditEventCoordinatesChanged\(false\);/);

  const update = block(adminPage, /const handleUpdateEventInfo = async[\s\S]*?\n {2}\};/);
  assert.match(update, /const mapPoint = parseCoordinatesInput\(editEventCoordinates\);\s*if \(!mapPoint\.ok\) \{[\s\S]*?editEventCoordinatesRef\.current\?\.focus\(\);\s*return;/);
  assert.match(update, /const mapPointUpdate: Pick<Event, 'latitude' \| 'longitude'> = editEventCoordinatesChanged\s*\? \{\s*latitude: mapPoint\.coordinates \? mapPoint\.coordinates\.latitude : null,\s*longitude: mapPoint\.coordinates \? mapPoint\.coordinates\.longitude : null\s*\}\s*: \{\};/);
  assert.match(update, /shirtAddonPrice: shirtSettings\.price,\s*\.\.\.mapPointUpdate\s*\}\);/);
  // selectedEventToManage reflete o ponto salvo.
  assert.match(update, /setSelectedEventToManage\(prev => \{[\s\S]*shirtAddonPrice: shirtSettings\.price,\s*\.\.\.mapPointUpdate\s*\};/);
});

test('picker: rótulo, ajuda, busca, remoção e prévia do mapa do Mapbox', () => {
  const html = withMapToken(TEST_TOKEN, () => renderToStaticMarkup(createElement(EventLocationPicker, {
    idPrefix: 'teste',
    value: '-7.1195, -34.8450',
    onChange: () => {},
    location: 'Arena Beach',
    city: 'João Pessoa',
    state: 'PB',
    country: 'BR'
  })));
  assert.match(html, /<label for="teste-coordinates"[^>]*>Coordenadas \(lat, lng\)<\/label>/);
  assert.match(html, /No Google Maps, clique com o botão direito no local e copie as coordenadas/);
  assert.match(html, /O ponto aparece publicamente na página do evento/);
  assert.match(html, /Buscar pelo endereço/);
  assert.match(html, /Remover ponto/);
  assert.match(html, />Prévia do mapa<\/p>/);
  assert.doesNotMatch(html, /\(Waze\)|<iframe|Toque para interagir/);
  assert.match(html, /<div data-event-map="true" role="region" aria-label="Prévia do mapa com o ponto do evento"/);
  assert.ok(!html.includes(TEST_TOKEN), 'o token não vai no HTML');

  const invalid = withMapToken(TEST_TOKEN, () => renderToStaticMarkup(createElement(EventLocationPicker, {
    idPrefix: 'teste', value: 'https://maps.app.goo.gl/AbC', onChange: () => {}, location: '', city: '', state: ''
  })));
  assert.match(invalid, /aria-invalid="true"/);
  assert.match(invalid, /Links de mapa não são aceitos/);
  assert.match(invalid, /<button type="button" disabled=""[^>]*>[\s\S]*Buscar pelo endereço/);
  assert.match(invalid, /Preencha o Local para buscar pelo endereço\./);
  assert.doesNotMatch(invalid, /data-event-map/);

  const empty = withMapToken(TEST_TOKEN, () => renderToStaticMarkup(createElement(EventLocationPicker, {
    idPrefix: 'teste', value: '', onChange: () => {}, location: 'Arena', city: '', state: ''
  })));
  assert.doesNotMatch(empty, /Remover ponto|data-event-map/);

  // Sem token no navegador a prévia some, e o resto do campo segue igual.
  const withoutToken = withMapToken(undefined, () => renderToStaticMarkup(createElement(EventLocationPicker, {
    idPrefix: 'teste', value: '-7.1195, -34.8450', onChange: () => {}, location: 'Arena', city: '', state: ''
  })));
  assert.doesNotMatch(withoutToken, /data-event-map/);
  assert.match(withoutToken, /Remover ponto/);

  assert.equal(toCoordinatesInput(-7.1195, -34.845), '-7.1195, -34.845');
  assert.equal(toCoordinatesInput(0, 0), '0, 0');
  assert.equal(toCoordinatesInput(null, null), '');
  assert.equal(toCoordinatesInput(undefined, -34.8), '');
  assert.equal(toCoordinatesInput(95, 0), '');
});

test('picker: a busca chama só a rota interna, envia o país e trata 503, 429, 502, vazio e rede', () => {
  assert.match(picker, /fetch\('\/api\/admin\/geocode', \{\s*method: 'POST'/);
  assert.match(picker, /body: JSON\.stringify\(country \? \{ query, country \} : \{ query \}\)/);
  assert.match(picker, /country\?: string;/);
  assert.match(picker, /const query = buildMapSearchText\(\{ location, city, state \}\);/);
  assert.match(picker, /disabled=\{!hasLocation \|\| isSearching\}/);
  assert.match(picker, /unavailable: 'Busca por endereço indisponível; cole as coordenadas\.'/);
  assert.match(picker, /empty: 'Nenhum resultado; ajuste o endereço ou cole as coordenadas\.'/);
  assert.match(picker, /if \(status === 503\) return SEARCH_MESSAGES\.unavailable;/);
  assert.match(picker, /if \(status === 429\) return SEARCH_MESSAGES\.rateLimited;/);
  assert.match(picker, /if \(status === 502\) return SEARCH_MESSAGES\.providerFailure;/);
  assert.match(picker, /setSearch\(\{ status: 'error', message: SEARCH_MESSAGES\.network \}\);/);
  assert.match(picker, /onChange\(formatCoordinates\(candidate\.latitude, candidate\.longitude\)\);/);
  assert.match(picker, /validateEventCoordinates\(\{ latitude, longitude \}\)/);
  assert.doesNotMatch(picker, /https?:\/\//, 'o painel não chama host externo');
});

test('CSP: connect-src ganha só o Mapbox, frame-src volta ao que era e o Waze sai; nenhuma outra diretiva muda', () => {
  const directive = (name) => nextConfig.match(new RegExp(`[\`"]${name} ([^\`"]*)[\`"]`))?.[1] || '';
  assert.deepEqual(directive('frame-src').split(/\s+/), [
    "'self'",
    'https://*.mercadopago.com',
    'https://*.mlstatic.com',
    'https://www.youtube-nocookie.com',
    'https://js.stripe.com',
    'https://hooks.stripe.com'
  ]);
  const connectSrc = directive('connect-src').split(/\s+/);
  assert.deepEqual(connectSrc.filter((value) => /mapbox/i.test(value)), ['https://api.mapbox.com', 'https://events.mapbox.com']);
  assert.ok(connectSrc.includes('https://api.stripe.com') && connectSrc.includes('https://api.mercadopago.com'), 'origens anteriores mantidas');
  assert.doesNotMatch(nextConfig, /waze/i);
  for (const name of ['default-src', 'script-src', 'img-src', 'form-action', 'style-src', 'font-src', 'worker-src']) {
    const value = directive(name);
    assert.ok(value, name);
    assert.doesNotMatch(value, /waze|mapbox/i, name);
  }
  assert.equal(directive('img-src'), "'self' data: blob: https:");
  assert.match(directive('worker-src'), /blob:/, 'o Mapbox GL JS roda num worker criado de um blob');
  assert.match(nextConfig, /"camera=\(\), microphone=\(\), geolocation=\(\), payment=\(\), usb=\(\), accelerometer=\(\), gyroscope=\(\), browsing-topics=\(\)"/);
  assert.match(nextConfig, /env: \{\s*NEXT_PUBLIC_MAPBOX_TOKEN: process\.env\.NEXT_PUBLIC_MAPBOX_TOKEN \|\| process\.env\.MAPBOX_TOKEN \|\| "",\s*\},/);
});

test('docs/security/security-headers.md: frame-src igual ao código e domínios do Mapbox documentados', () => {
  const frameSrcValue = nextConfig.match(/"frame-src ([^"]*)"/)[1];
  const docRow = securityDoc.match(/^\| `frame-src` \| `([^`]*)` \|/m);
  assert.ok(docRow, 'linha de frame-src');
  assert.equal(docRow[1], frameSrcValue);

  const connectRow = securityDoc.match(/^\| `connect-src` \| `([^`]*)` \|/m);
  assert.ok(connectRow, 'linha de connect-src');
  assert.match(connectRow[1], /https:\/\/api\.mapbox\.com https:\/\/events\.mapbox\.com$/);

  assert.doesNotMatch(securityDoc, /embed\.waze\.com/);
  assert.match(securityDoc, /^\| `https:\/\/api\.mapbox\.com` \| connect-src \|/m);
  assert.match(securityDoc, /^\| `https:\/\/events\.mapbox\.com` \| connect-src \|/m);
});

test('i18n: Event.map com as mesmas chaves nos três idiomas, sem valor vazio, e o arquivo inteiro em paridade', () => {
  const keysOf = (object, prefix = '') => Object.entries(object).flatMap(([key, value]) => (
    value && typeof value === 'object' && !Array.isArray(value) ? keysOf(value, `${prefix}${key}.`) : [`${prefix}${key}`]
  )).sort();

  const expected = [
    'appleMaps', 'copied', 'copyAddress', 'directions', 'googleMaps', 'heading',
    'mapLabel', 'markerLabel', 'scrollZoomCmd', 'scrollZoomCtrl', 'touchPan', 'waze'
  ];
  for (const [locale, dictionary] of Object.entries(messages)) {
    assert.deepEqual(keysOf(dictionary.Event.map), expected, locale);
    for (const [key, value] of Object.entries(dictionary.Event.map)) {
      assert.equal(typeof value, 'string', `${locale}.${key}`);
      assert.ok(value.trim(), `${locale}.${key} vazio`);
    }
  }
  assert.deepEqual(keysOf(messages['pt-pt']), keysOf(messages['pt-br']));
  assert.deepEqual(keysOf(messages['en-gb']), keysOf(messages['pt-br']));

  assert.equal(messages['pt-br'].Event.map.copyAddress, 'Copiar endereço');
  assert.equal(messages['pt-pt'].Event.map.copyAddress, 'Copiar morada');
  assert.equal(messages['pt-br'].Event.map.mapLabel, 'Mapa com o local do evento');
  assert.equal(messages['pt-br'].Event.map.touchPan, 'Use dois dedos para mover o mapa');
  assert.equal(messages['en-gb'].Event.map.touchPan, 'Use two fingers to move the map');
  // O namespace inteiro de Event já chega à página pública.
  assert.match(read('../src/app/[locale]/event/[id]/page.tsx'), /getScopedMessages\(\['Event', 'Checkout'\]\)/);
});

test('package.json: só o mapbox-gl entra como dependência nova', () => {
  assert.deepEqual(Object.keys(packageJson.dependencies).sort(), [
    '@supabase/supabase-js', 'lucide-react', 'mapbox-gl', 'next', 'next-intl', 'react', 'react-dom', 'stripe'
  ]);
  assert.match(packageJson.dependencies['mapbox-gl'], /^\^3\./);
  assert.deepEqual(Object.keys(packageJson.devDependencies).sort(), [
    '@tailwindcss/postcss', '@types/node', '@types/react', '@types/react-dom', 'eslint', 'eslint-config-next', 'tailwindcss', 'typescript'
  ]);
  assert.doesNotMatch(JSON.stringify(packageJson), /simple-icons|leaflet|pglite/i);
});
