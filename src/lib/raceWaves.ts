// Ondas da largada do Fitness Race (Story 1.96). Puro, sem rede nem banco: o
// servidor (serverRaceSheets.ts) e o painel do organizador usam estas regras para montar a
// lista das ondas a partir do cronograma do evento. A onda é um item
// `kind: 'heat'` do `event_schedule` (D5: o organizador define as ondas na aba
// Cronograma; a súmula não fixa categorias). O horário do cronograma é o
// previsto; a largada vale a partir do gesto do organizador (race_heat_marks, D1; D45).

/** Fuso usado quando o evento não informa o dele (mesmo padrão de eventStatus.ts). */
export const RACE_DEFAULT_TIME_ZONE = 'America/Fortaleza';

type PlainObject = Record<string, unknown>;
const isPlainObject = (value: unknown): value is PlainObject => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

/** Item `kind: 'heat'` do cronograma, só com os campos que a largada usa. */
export type RaceHeatItem = {
  id: string;
  title: string;
  date: string;
  time: string;
  heatNumber: number | null;
  athleteIds: string[];
};

export type RaceWaveAthlete = { id: string; name: string; box: string; divisionId: string; divisionName: string };

export type RaceWaveMark = { startedAt: string; startedByName?: string | null };

export type RaceWave = {
  id: string;
  title: string;
  date: string;
  time: string;
  heatNumber: number | null;
  categories: string[];
  athletes: RaceWaveAthlete[];
  startedAt: string | null;
  startedByName: string | null;
  runsCount: number;
  /** Corridas da onda com resultado no leaderboard (fechadas ou DNF); só na leitura `waves` (Story 1.107). */
  resultsCount?: number;
};

/** Cronograma do evento como lista: aceita o JSON gravado como texto. */
const scheduleItems = (schedule: unknown): unknown[] => {
  const raw = typeof schedule === 'string' ? (() => { try { return JSON.parse(schedule) as unknown; } catch { return []; } })() : schedule;
  return Array.isArray(raw) ? raw : [];
};

/** Atletas da onda: sem posições vazias (`''`) nem repetidos, na ordem do cronograma. */
export const heatAthleteIds = (item: { athleteIds?: unknown }): string[] => {
  if (!Array.isArray(item.athleteIds)) return [];
  const ids = item.athleteIds.filter((id): id is string => typeof id === 'string' && id.trim() !== '').map((id) => id.trim());
  return [...new Set(ids)];
};

/** Itens `kind: 'heat'` do cronograma, com id, normalizados. */
export const readRaceHeatItems = (schedule: unknown): RaceHeatItem[] => scheduleItems(schedule)
  .filter((item): item is PlainObject => isPlainObject(item) && item.kind === 'heat' && typeof item.id === 'string' && item.id !== '')
  .map((item) => ({
    id: item.id as string,
    title: typeof item.title === 'string' ? item.title : '',
    date: typeof item.date === 'string' ? item.date : '',
    time: typeof item.time === 'string' ? item.time : '',
    heatNumber: typeof item.heatNumber === 'number' && Number.isFinite(item.heatNumber) ? item.heatNumber : null,
    athleteIds: heatAthleteIds(item)
  }));

/** A onda do cronograma pelo id (só itens `kind: 'heat'`). */
export const findRaceHeatItem = (schedule: unknown, heatId: string) => readRaceHeatItems(schedule).find((item) => item.id === heatId) ?? null;

/** Título exibido da onda: o do cronograma ou, sem ele, "Onda N". */
export const raceWaveTitle = (item: Pick<RaceHeatItem, 'title' | 'heatNumber'>) => (
  item.title.trim() || (item.heatNumber !== null ? `Onda ${item.heatNumber}` : 'Onda')
);

/**
 * Lista das ondas para o painel de largada (AC1): só as que têm ao menos um
 * atleta do evento, em ordem de data, horário previsto e número; cada uma com
 * as categorias dos atletas (sem repetir) e o estado da largada.
 */
export const buildRaceWaves = (
  schedule: unknown,
  athletes: ReadonlyMap<string, RaceWaveAthlete>,
  marks: ReadonlyMap<string, RaceWaveMark>,
  runsByHeat: ReadonlyMap<string, number> = new Map()
): RaceWave[] => readRaceHeatItems(schedule)
  .map((item) => {
    const waveAthletes = item.athleteIds.map((id) => athletes.get(id)).filter((athlete): athlete is RaceWaveAthlete => Boolean(athlete));
    const mark = marks.get(item.id) ?? null;
    return {
      id: item.id,
      title: raceWaveTitle(item),
      date: item.date,
      time: item.time,
      heatNumber: item.heatNumber,
      categories: [...new Set(waveAthletes.map((athlete) => athlete.divisionName).filter(Boolean))],
      athletes: waveAthletes,
      startedAt: mark?.startedAt ?? null,
      startedByName: mark?.startedByName ?? null,
      runsCount: runsByHeat.get(item.id) ?? 0
    };
  })
  .filter((wave) => wave.athletes.length > 0)
  .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || (a.heatNumber ?? 0) - (b.heatNumber ?? 0));

/** A próxima onda a largar: a primeira da lista ainda sem largada (null quando todas largaram). */
export const nextRaceWaveId = (waves: readonly Pick<RaceWave, 'id' | 'startedAt'>[]) => waves.find((wave) => !wave.startedAt)?.id ?? null;

/** Estado da largada para a lista: "Aguardando largada" ou "Largou às HH:MM:SS". */
export const describeWaveStart = (startedAt: string | null, timeZone?: string) => (
  startedAt ? `Largou às ${formatRaceClock(startedAt, timeZone)}` : 'Aguardando largada'
);

/** Horário HH:MM:SS no fuso do evento (padrão America/Fortaleza). Texto vazio se não for um horário. */
export const formatRaceClock = (iso: string, timeZone?: string) => {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const format = (zone: string) => new Intl.DateTimeFormat('pt-BR', {
    timeZone: zone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).format(new Date(ms));
  try {
    return format(timeZone || RACE_DEFAULT_TIME_ZONE);
  } catch {
    return format(RACE_DEFAULT_TIME_ZONE);
  }
};
