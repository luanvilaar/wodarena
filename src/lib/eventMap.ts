// Local do evento no mapa (Stories 1.41 e 1.42). Módulo puro, sem imports: o
// painel do gestor, a página pública e o servidor (persistência e geocoding)
// usam as mesmas funções, e o node --test importa este arquivo direto.
//
// Coordenadas entram nas URLs só depois de validadas e formatadas com até 6
// casas decimais (sem notação exponencial); todo texto livre passa por
// encodeURIComponent. Nenhuma URL usa o esquema do app do Waze: o link
// universal https://waze.com/ul abre o app quando instalado e o Live Map no
// navegador quando não está.

export type EventCoordinates = {
  latitude: number;
  longitude: number;
};

/** `coordinates: null` = evento sem ponto (campo vazio ou ponto removido). */
export type EventCoordinatesResult =
  | { ok: true; coordinates: EventCoordinates | null }
  | { ok: false; error: string };

/** Destino dos links de "Como chegar": o ponto, quando há, ou o texto do local. */
export type EventMapTarget = {
  coordinates?: EventCoordinates | null;
  searchText?: string;
};

export const COORDINATE_DECIMALS = 6;
export const LATITUDE_LIMIT = 90;
export const LONGITUDE_LIMIT = 180;

/** Zoom inicial do mapa do Mapbox: mostra o local com contexto de ruas. */
export const EVENT_MAP_ZOOM = 15;
/** Zoom do deep link de navegação, como na documentação do Waze. */
export const WAZE_DIRECTIONS_ZOOM = 17;

const WAZE_DEEP_LINK_BASE_URL = 'https://waze.com/ul';
const GOOGLE_MAPS_DIRECTIONS_BASE_URL = 'https://www.google.com/maps/dir/';
const APPLE_MAPS_BASE_URL = 'https://maps.apple.com/';
const WAZE_UTM_SOURCE = 'wodarena';

const COORDINATE_EXAMPLE = '-7.1195, -34.8450';
const HOW_TO_COPY = 'No Google Maps, clique com o botão direito no local e copie as coordenadas';

const MESSAGES = {
  link: `Links de mapa não são aceitos. ${HOW_TO_COPY} e cole aqui no formato latitude, longitude (ex.: ${COORDINATE_EXAMPLE}).`,
  decimalComma: `Use ponto como separador decimal e vírgula só entre a latitude e a longitude (ex.: ${COORDINATE_EXAMPLE}).`,
  twoNumbers: `Informe dois números, latitude e longitude, separados por vírgula (ex.: ${COORDINATE_EXAMPLE}).`,
  format: `Formato não reconhecido. ${HOW_TO_COPY} e cole aqui no formato latitude, longitude (ex.: ${COORDINATE_EXAMPLE}).`,
  latitudeRange: 'A latitude (primeiro número) precisa estar entre -90 e 90. Confira se a latitude veio antes da longitude.',
  longitudeRange: 'A longitude (segundo número) precisa estar entre -180 e 180.',
  bothOrNone: 'Informe latitude e longitude juntas (as duas como número) ou nenhuma das duas para ficar sem ponto.',
  notNumber: 'Latitude e longitude precisam ser números válidos.'
} as const;

// Um número como o Google Maps copia: sinal opcional, até 3 dígitos inteiros e
// ponto decimal. Recusa vírgula decimal, exponencial, hexadecimal, Infinity e NaN.
const COORDINATE_NUMBER_PATTERN = /^[-+]?\d{1,3}(\.\d+)?$/;
const URL_LIKE_PATTERN = /:\/\/|\bwww\.|\/|\b[a-z0-9-]+\.(com|gl|app|br|net|org|ly|be|pt|uk|co|me|io)\b/i;
const DECIMAL_COMMA_PATTERN = /^[-+]?\d+,\d+(\s*[;,]\s*|\s+)[-+]?\d+,\d+$/;
const NUMBER_TOKEN_PATTERN = /[-+]?\d+(?:[.,]\d+)?/g;
const LETTER_PATTERN = /[a-z]/i;

// `-0` vira `0`, para o ponto não sair como "-0" nas URLs nem no banco.
const normalizeZero = (value: number) => (value === 0 ? 0 : value);

const checkRanges = (latitude: number, longitude: number): EventCoordinatesResult => {
  if (Math.abs(latitude) > LATITUDE_LIMIT) return { ok: false, error: MESSAGES.latitudeRange };
  if (Math.abs(longitude) > LONGITUDE_LIMIT) return { ok: false, error: MESSAGES.longitudeRange };
  return { ok: true, coordinates: { latitude: normalizeZero(latitude), longitude: normalizeZero(longitude) } };
};

/**
 * Lê o que o gestor colou no campo "Coordenadas (lat, lng)": exatamente dois
 * números com ponto decimal, separados por vírgula (espaços opcionais ao redor
 * dela), como o Google Maps copia (`-7.1195, -34.8450`). Texto vazio é "sem
 * ponto" (não é erro). Links de mapa nunca são aceitos nem resolvidos.
 */
export const parseCoordinatesInput = (text: unknown): EventCoordinatesResult => {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed) return { ok: true, coordinates: null };

  if (URL_LIKE_PATTERN.test(trimmed)) return { ok: false, error: MESSAGES.link };

  const parts = trimmed.split(',').map(part => part.trim());
  if (parts.length === 2 && parts.every(part => COORDINATE_NUMBER_PATTERN.test(part))) {
    return checkRanges(Number(parts[0]), Number(parts[1]));
  }

  if (DECIMAL_COMMA_PATTERN.test(trimmed)) return { ok: false, error: MESSAGES.decimalComma };
  const numberTokens = trimmed.match(NUMBER_TOKEN_PATTERN) || [];
  if (!LETTER_PATTERN.test(trimmed) && numberTokens.length !== 2) return { ok: false, error: MESSAGES.twoNumbers };
  return { ok: false, error: MESSAGES.format };
};

/**
 * Validação do ponto gravado (servidor e cliente): cada valor é `number`
 * finito ou `null`, nada além disso; os dois juntos ou nenhum; faixas -90..90
 * e -180..180. Zero é coordenada válida, não "ausente".
 */
export const validateEventCoordinates = ({ latitude, longitude }: { latitude: unknown; longitude: unknown }): EventCoordinatesResult => {
  if (latitude === null && longitude === null) return { ok: true, coordinates: null };
  if (latitude === null || longitude === null || latitude === undefined || longitude === undefined) {
    return { ok: false, error: MESSAGES.bothOrNone };
  }
  if (typeof latitude !== 'number' || typeof longitude !== 'number' || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { ok: false, error: MESSAGES.notNumber };
  }
  return checkRanges(latitude, longitude);
};

const isValidPoint = (coordinates: EventCoordinates | null | undefined): coordinates is EventCoordinates => (
  Boolean(coordinates) && validateEventCoordinates({
    latitude: coordinates?.latitude,
    longitude: coordinates?.longitude
  }).ok
);

/** Número com até 6 casas, sem zeros sobrando e sem notação exponencial. */
export const formatCoordinate = (value: number) => String(normalizeZero(Number(value.toFixed(COORDINATE_DECIMALS))));

/** Texto `lat, lng` (até 6 casas decimais), no mesmo formato que o campo aceita. */
export const formatCoordinates = (latitude: number, longitude: number) => (
  `${formatCoordinate(latitude)}, ${formatCoordinate(longitude)}`
);

// Texto comparável: sem acento, em minúsculas e só letras e números separados
// por espaço. Serve para saber se Cidade e Estado já estão escritos no Local.
const toComparable = (text: string) => (
  text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
);

const containsWords = (haystack: string, needle: string) => needle !== '' && ` ${haystack} `.includes(` ${needle} `);

// Estados chegam como "PB" ou como "PB - PARAÍBA": a sigla antes do " - " basta.
const appearsIn = (comparableLocation: string, part: string) => {
  if (containsWords(comparableLocation, toComparable(part))) return true;
  return part.includes(' - ') && containsWords(comparableLocation, toComparable(part.split(' - ')[0]));
};

/**
 * Local + Cidade + Estado, unidos por ", ". Só entram as partes não vazias e,
 * para Cidade e Estado, só as que ainda não aparecem no Local (o Local costuma
 * trazer "João Pessoa - PB"; repetir deixaria o endereço e os links poluídos).
 */
export const buildMapSearchText = ({ location, city, state }: { location?: unknown; city?: unknown; state?: unknown }) => {
  const clean = (part: unknown) => (typeof part === 'string' ? part.trim() : '');
  const place = clean(location);
  const comparablePlace = toComparable(place);
  const extras = [clean(city), clean(state)].filter(part => part && !appearsIn(comparablePlace, part));
  return [place, ...extras].filter(Boolean).join(', ');
};

const searchTextOf = (target: EventMapTarget) => (typeof target.searchText === 'string' ? target.searchText.trim() : '');

/** Deep link universal do Waze: navega até o ponto ou busca pelo texto. */
export const buildWazeDirectionsUrl = (target: EventMapTarget) => {
  if (isValidPoint(target.coordinates)) {
    const { latitude, longitude } = target.coordinates;
    return `${WAZE_DEEP_LINK_BASE_URL}?ll=${formatCoordinate(latitude)},${formatCoordinate(longitude)}&navigate=yes&zoom=${WAZE_DIRECTIONS_ZOOM}&utm_source=${WAZE_UTM_SOURCE}`;
  }
  const searchText = searchTextOf(target);
  return searchText ? `${WAZE_DEEP_LINK_BASE_URL}?q=${encodeURIComponent(searchText)}&utm_source=${WAZE_UTM_SOURCE}` : null;
};

/**
 * Rota no Google Maps (Maps URLs, `api=1`). A documentação pede a vírgula de
 * `lat,lng` codificada como %2C.
 */
export const buildGoogleMapsDirectionsUrl = (target: EventMapTarget) => {
  if (isValidPoint(target.coordinates)) {
    const { latitude, longitude } = target.coordinates;
    return `${GOOGLE_MAPS_DIRECTIONS_BASE_URL}?api=1&destination=${formatCoordinate(latitude)}%2C${formatCoordinate(longitude)}`;
  }
  const searchText = searchTextOf(target);
  return searchText ? `${GOOGLE_MAPS_DIRECTIONS_BASE_URL}?api=1&destination=${encodeURIComponent(searchText)}` : null;
};

/** Rota no Apple Maps (parâmetro de destino `daddr`). */
export const buildAppleMapsDirectionsUrl = (target: EventMapTarget) => {
  if (isValidPoint(target.coordinates)) {
    const { latitude, longitude } = target.coordinates;
    return `${APPLE_MAPS_BASE_URL}?daddr=${formatCoordinate(latitude)},${formatCoordinate(longitude)}`;
  }
  const searchText = searchTextOf(target);
  return searchText ? `${APPLE_MAPS_BASE_URL}?daddr=${encodeURIComponent(searchText)}` : null;
};
