import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import test from 'node:test';

import {
  EVENT_MAP_ZOOM,
  buildAppleMapsDirectionsUrl,
  buildGoogleMapsDirectionsUrl,
  buildMapSearchText,
  buildWazeDirectionsUrl,
  formatCoordinate,
  formatCoordinates,
  parseCoordinatesInput,
  validateEventCoordinates
} from '../src/lib/eventMap.ts';

// Stories 1.41 (AC2) e 1.42 (AC5, AC8): o módulo puro é a fonte única da
// verdade para ler o campo de coordenadas, validar o ponto gravado, montar o
// texto do endereço e as URLs de rota.

const eventMapSource = readFileSync(new URL('../src/lib/eventMap.ts', import.meta.url), 'utf8');

const point = (latitude, longitude) => ({ ok: true, coordinates: { latitude, longitude } });

const LINK_ERROR = /Links de mapa não são aceitos\. No Google Maps, clique com o botão direito no local e copie as coordenadas/;
const FORMAT_ERROR = /Formato não reconhecido\. No Google Maps, clique com o botão direito/;
const DECIMAL_COMMA_ERROR = /Use ponto como separador decimal/;
const TWO_NUMBERS_ERROR = /Informe dois números, latitude e longitude, separados por vírgula/;
const LATITUDE_RANGE_ERROR = /latitude \(primeiro número\) precisa estar entre -90 e 90/;
const LONGITUDE_RANGE_ERROR = /longitude \(segundo número\) precisa estar entre -180 e 180/;

const assertParseError = (input, pattern) => {
  const result = parseCoordinatesInput(input);
  assert.equal(result.ok, false, `deveria recusar: ${JSON.stringify(input)}`);
  assert.match(result.error, pattern, JSON.stringify(input));
};

test('eventMap é um módulo puro: sem imports, sem enum e sem alias', () => {
  assert.doesNotMatch(eventMapSource, /^\s*import\s/m);
  assert.doesNotMatch(eventMapSource, /\benum\b/);
  assert.doesNotMatch(eventMapSource, /from '@\//);
  assert.doesNotMatch(eventMapSource, /\bnamespace\b|\bdeclare\b/);
});

test('parseCoordinatesInput aceita o formato que o Google Maps copia', () => {
  assert.deepEqual(parseCoordinatesInput('-7.1195, -34.8450'), point(-7.1195, -34.845));
  assert.deepEqual(parseCoordinatesInput('-7.1195,-34.8450'), point(-7.1195, -34.845));
  assert.deepEqual(parseCoordinatesInput('  -7.1195 ,   -34.8450  '), point(-7.1195, -34.845));
  assert.deepEqual(parseCoordinatesInput('+7.1195, +34.8450'), point(7.1195, 34.845));
  assert.deepEqual(parseCoordinatesInput('-7, -34'), point(-7, -34));
  assert.deepEqual(parseCoordinatesInput('-23.550520, -46.633308'), point(-23.55052, -46.633308));
});

test('parseCoordinatesInput aceita zero e os limites das faixas', () => {
  assert.deepEqual(parseCoordinatesInput('0, 0'), point(0, 0));
  assert.deepEqual(parseCoordinatesInput('-0, -0.0'), point(0, 0));
  assert.ok(Object.is(parseCoordinatesInput('-0, -0').coordinates.latitude, 0), '-0 vira 0');
  assert.deepEqual(parseCoordinatesInput('90, 180'), point(90, 180));
  assert.deepEqual(parseCoordinatesInput('-90, -180'), point(-90, -180));
});

test('parseCoordinatesInput: texto vazio é "sem ponto", não erro', () => {
  for (const empty of ['', '   ', '\t', undefined, null]) {
    assert.deepEqual(parseCoordinatesInput(empty), { ok: true, coordinates: null }, JSON.stringify(empty));
  }
});

test('parseCoordinatesInput recusa faixas fora de -90..90 e -180..180', () => {
  assertParseError('90.0001, 0', LATITUDE_RANGE_ERROR);
  assertParseError('-90.5, 0', LATITUDE_RANGE_ERROR);
  assertParseError('0, 180.5', LONGITUDE_RANGE_ERROR);
  assertParseError('0, -180.0001', LONGITUDE_RANGE_ERROR);
  assertParseError('999, 0', LATITUDE_RANGE_ERROR);
  // Ordem invertida (longitude antes) com longitude acima de 90 cai na faixa da latitude.
  assertParseError('-134.8450, -7.1195', LATITUDE_RANGE_ERROR);
});

test('parseCoordinatesInput recusa NaN, Infinity, exponencial e hexadecimal', () => {
  for (const input of ['NaN, 0', '0, NaN', 'Infinity, 0', '-Infinity, 0', '1e1, 2', '0, 1E-7', '0x10, 2']) {
    assertParseError(input, FORMAT_ERROR);
  }
  // Separador numérico do JavaScript também não passa (vira três números).
  assertParseError('1_0, 2', TWO_NUMBERS_ERROR);
});

test('parseCoordinatesInput recusa vírgula decimal com mensagem que diz o que fazer', () => {
  assertParseError('-7,1195, -34,8450', DECIMAL_COMMA_ERROR);
  assertParseError('-7,1195 -34,8450', DECIMAL_COMMA_ERROR);
  assertParseError('-7,1195; -34,8450', DECIMAL_COMMA_ERROR);
});

test('parseCoordinatesInput recusa mais ou menos de dois números', () => {
  assertParseError('-7.1195', TWO_NUMBERS_ERROR);
  assertParseError('-7.1195, -34.8450, 12', TWO_NUMBERS_ERROR);
  assertParseError('1, 2, 3, 4, 5', TWO_NUMBERS_ERROR);
  assertParseError(',', TWO_NUMBERS_ERROR);
});

test('parseCoordinatesInput recusa texto livre', () => {
  assertParseError('Arena Beach, João Pessoa', FORMAT_ERROR);
  assertParseError('lat -7.1195 lng -34.8450', FORMAT_ERROR);
  assertParseError('-7.1195° S, 34.8450° W', FORMAT_ERROR);
});

test('parseCoordinatesInput recusa links curtos e longos de mapa (nunca resolve)', () => {
  for (const link of [
    'https://maps.app.goo.gl/AbCdEf123',
    'maps.app.goo.gl/AbCdEf123',
    'https://goo.gl/maps/AbCdEf123',
    'goo.gl/maps/AbCdEf123',
    'https://waze.com/ul?ll=-7.1195,-34.8450&navigate=yes',
    'waze.com/ul?ll=-7.1195,-34.8450',
    'https://www.google.com/maps/place/@-7.1195,-34.8450,17z',
    'https://maps.apple.com/?ll=-7.1195,-34.8450',
    'www.google.com/maps?q=-7.1195,-34.8450',
    'http://127.0.0.1/-7.1195,-34.8450'
  ]) {
    assertParseError(link, LINK_ERROR);
  }
});

test('validateEventCoordinates aceita só number finito ou null, ambos-ou-nenhum, com zero válido', () => {
  assert.deepEqual(validateEventCoordinates({ latitude: -7.1195, longitude: -34.845 }), point(-7.1195, -34.845));
  assert.deepEqual(validateEventCoordinates({ latitude: 0, longitude: 0 }), point(0, 0));
  assert.deepEqual(validateEventCoordinates({ latitude: 90, longitude: -180 }), point(90, -180));
  assert.deepEqual(validateEventCoordinates({ latitude: null, longitude: null }), { ok: true, coordinates: null });

  const invalid = [
    [{ latitude: -7.1, longitude: null }, /juntas/],
    [{ latitude: null, longitude: -34.8 }, /juntas/],
    [{ latitude: -7.1, longitude: undefined }, /juntas/],
    [{ latitude: undefined, longitude: undefined }, /juntas/],
    [{ latitude: '-7.1', longitude: -34.8 }, /números válidos/],
    [{ latitude: -7.1, longitude: '-34.8' }, /números válidos/],
    [{ latitude: Number.NaN, longitude: 0 }, /números válidos/],
    [{ latitude: Number.POSITIVE_INFINITY, longitude: 0 }, /números válidos/],
    [{ latitude: true, longitude: 0 }, /números válidos/],
    [{ latitude: [1], longitude: 0 }, /números válidos/],
    [{ latitude: { value: 1 }, longitude: 0 }, /números válidos/],
    [{ latitude: 90.0001, longitude: 0 }, LATITUDE_RANGE_ERROR],
    [{ latitude: 0, longitude: -180.5 }, LONGITUDE_RANGE_ERROR]
  ];
  for (const [input, pattern] of invalid) {
    const result = validateEventCoordinates(input);
    assert.equal(result.ok, false, JSON.stringify(input));
    assert.match(result.error, pattern, JSON.stringify(input));
  }
});

test('formatCoordinates usa até 6 casas decimais e nunca notação exponencial', () => {
  assert.equal(formatCoordinates(-7.1195, -34.845), '-7.1195, -34.845');
  assert.equal(formatCoordinates(-7.119512345678, -34.845098765432), '-7.119512, -34.845099');
  assert.equal(formatCoordinates(0, 0), '0, 0');
  assert.equal(formatCoordinates(-0, -0), '0, 0');
  assert.equal(formatCoordinate(0.0000001), '0');
  assert.equal(formatCoordinate(-0.0000001), '0');
  assert.equal(formatCoordinate(0.000001), '0.000001');
  assert.equal(formatCoordinate(-0.0000012), '-0.000001');
  assert.equal(formatCoordinate(179.9999999), '180');
  for (const value of [1e-7, 5e-7, 1e-6, 1.5e-6, -3e-7, 123.0000001]) {
    assert.doesNotMatch(formatCoordinate(value), /e/i, String(value));
  }
  // O texto formatado volta pelo parser sem perda.
  assert.deepEqual(parseCoordinatesInput(formatCoordinates(-7.119512, -34.845099)), point(-7.119512, -34.845099));
});

test('buildMapSearchText junta Local, Cidade e Estado não vazios com ", "', () => {
  assert.equal(buildMapSearchText({ location: ' Arena Beach ', city: 'João Pessoa', state: 'PB' }), 'Arena Beach, João Pessoa, PB');
  assert.equal(buildMapSearchText({ location: 'Arena Beach', city: '  ', state: 'PB' }), 'Arena Beach, PB');
  assert.equal(buildMapSearchText({ location: 'Arena Beach' }), 'Arena Beach');
  assert.equal(buildMapSearchText({ location: '', city: '', state: '' }), '');
  assert.equal(buildMapSearchText({ location: null, city: 42, state: undefined }), '');
});

test('o zoom do mapa é 15 e o módulo não monta mais URL de iframe do Waze', () => {
  assert.equal(EVENT_MAP_ZOOM, 15);
  assert.doesNotMatch(eventMapSource, /embed\.waze\.com|buildWazeEmbedUrl|WAZE_EMBED/);
});

test('buildMapSearchText não repete Cidade e Estado que o Local já traz (acento, caixa e sigla)', () => {
  // O caso real do evento: o Local já termina em "João Pessoa - PB, 58046-503".
  const location = 'R. Jose de Almeida Noronha, Quadra 155 - Lote 14 - Portal do Sol, João Pessoa - PB, 58046-503';
  assert.equal(buildMapSearchText({ location, city: 'JOAO PESSOA', state: 'PB - PARAÍBA' }), location);
  assert.equal(buildMapSearchText({ location, city: 'João Pessoa', state: 'PB' }), location);

  // O que falta é acrescentado, na ordem Local, Cidade, Estado.
  assert.equal(buildMapSearchText({ location: 'Arena Beach, Av. Principal', city: 'Joao Pessoa', state: 'PB - PARAÍBA' }), 'Arena Beach, Av. Principal, Joao Pessoa, PB - PARAÍBA');
  assert.equal(buildMapSearchText({ location: 'Arena Beach - Natal', city: 'Natal', state: 'RN' }), 'Arena Beach - Natal, RN');
  assert.equal(buildMapSearchText({ location: '', city: 'Natal', state: 'RN' }), 'Natal, RN');

  // Palavras inteiras: "Natal" não conta como presente em "Natalino".
  assert.equal(buildMapSearchText({ location: 'Arena Natalino', city: 'Natal', state: '' }), 'Arena Natalino, Natal');
  // Cidade de várias palavras só conta se as palavras vierem juntas e na ordem.
  assert.equal(buildMapSearchText({ location: 'Pessoa de João Arena', city: 'João Pessoa' }), 'Pessoa de João Arena, João Pessoa');
  // A sigla do Estado só vale quando o Estado vem como "SIGLA - NOME".
  assert.equal(buildMapSearchText({ location: 'Arena PB Fit', city: '', state: 'Paraíba' }), 'Arena PB Fit, Paraíba');
});

test('links de "Como chegar" com coordenadas', () => {
  const target = { coordinates: { latitude: -7.1195, longitude: -34.845 }, searchText: 'Arena Beach, João Pessoa, PB' };
  assert.equal(buildWazeDirectionsUrl(target), 'https://waze.com/ul?ll=-7.1195,-34.845&navigate=yes&zoom=17&utm_source=wodarena');
  assert.equal(buildGoogleMapsDirectionsUrl(target), 'https://www.google.com/maps/dir/?api=1&destination=-7.1195%2C-34.845');
  assert.equal(buildAppleMapsDirectionsUrl(target), 'https://maps.apple.com/?daddr=-7.1195,-34.845');

  const tiny = { coordinates: { latitude: 0.0000001, longitude: 6e-7 } };
  for (const url of [buildWazeDirectionsUrl(tiny), buildGoogleMapsDirectionsUrl(tiny), buildAppleMapsDirectionsUrl(tiny)]) {
    assert.doesNotMatch(url, /\de-?\d/i, url);
  }
  assert.equal(buildWazeDirectionsUrl(tiny), 'https://waze.com/ul?ll=0,0.000001&navigate=yes&zoom=17&utm_source=wodarena');
});

test('links de "Como chegar" sem coordenadas usam o texto codificado', () => {
  const target = { coordinates: null, searchText: 'Arena Beach & Fit #2?, João Pessoa, PB' };
  const encoded = 'Arena%20Beach%20%26%20Fit%20%232%3F%2C%20Jo%C3%A3o%20Pessoa%2C%20PB';
  assert.equal(buildWazeDirectionsUrl(target), `https://waze.com/ul?q=${encoded}&utm_source=wodarena`);
  assert.equal(buildGoogleMapsDirectionsUrl(target), `https://www.google.com/maps/dir/?api=1&destination=${encoded}`);
  assert.equal(buildAppleMapsDirectionsUrl(target), `https://maps.apple.com/?daddr=${encoded}`);

  // Ponto inválido não entra na URL: cai na busca por texto.
  const invalidPoint = { coordinates: { latitude: 200, longitude: 0 }, searchText: 'Arena' };
  assert.equal(buildWazeDirectionsUrl(invalidPoint), 'https://waze.com/ul?q=Arena&utm_source=wodarena');

  // Sem ponto e sem texto não há link.
  for (const build of [buildWazeDirectionsUrl, buildGoogleMapsDirectionsUrl, buildAppleMapsDirectionsUrl]) {
    assert.equal(build({ coordinates: null, searchText: '   ' }), null);
    assert.equal(build({}), null);
  }
});

test('texto malicioso nunca escapa do parâmetro nem muda o host', () => {
  const searchText = '"><script>alert(1)</script>&navigate=yes&ll=0,0#frag';
  for (const url of [
    buildWazeDirectionsUrl({ searchText }),
    buildGoogleMapsDirectionsUrl({ searchText }),
    buildAppleMapsDirectionsUrl({ searchText })
  ]) {
    assert.doesNotMatch(url, /[<>"#\s]/, url);
    assert.equal((url.match(/&/g) || []).length <= 2, true, url);
    const parsed = new URL(url);
    assert.ok(['waze.com', 'www.google.com', 'maps.apple.com'].includes(parsed.hostname), parsed.hostname);
    assert.equal(parsed.protocol, 'https:');
  }
});

test('nenhum arquivo de src/ usa o esquema do app do Waze', () => {
  const walk = (dir) => readdirSync(dir).flatMap((name) => {
    const url = new URL(`${name}`, dir);
    if (statSync(url).isDirectory()) return walk(new URL(`${name}/`, dir));
    return [url];
  });
  const files = walk(new URL('../src/', import.meta.url)).filter((url) => /\.(tsx?|jsx?|mjs|json|css)$/.test(url.pathname));
  assert.ok(files.length > 50, 'varredura de src/ vazia');
  for (const url of files) {
    assert.doesNotMatch(readFileSync(url, 'utf8'), /waze:\/\//i, url.pathname);
  }
});
