import { isRaceStationKey } from '@/lib/raceCourseStructure';

// Escala de judges por estação do Fitness Race (Story 1.104; D35, D3, D38 em
// docs/design/fitness-race-sumula/DECISOES.md). Puro: sem React, sem Supabase
// e sem fetch. O servidor (serverRaceAssignments.ts), o editor do organizador
// (RaceAssignmentsPanel.tsx) e a lista de estações do judge
// (StationListScreen.tsx) leem a escala pelas mesmas regras.
//
// Regra de leitura (AC2): a onda que tem linhas próprias usa só as linhas
// dela; a onda sem linhas usa o padrão do evento (heatId nulo). Linha de judge
// que já não está atribuído ao evento (event_judges) é ignorada antes, então
// uma onda ajustada só com judges removidos (ou sem nenhum judge) volta a
// seguir o padrão (limitação registrada na story). A escala só orienta (D3):
// nada aqui bloqueia o judge fora dela.

/** Linhas por gravação (AC3). */
export const RACE_ASSIGNMENTS_MAX_ROWS = 500;

export type RaceAssignmentRow = { judgeUserId: string; stationKey: string; heatId: string | null };
export type RaceAssignmentPair = { judgeUserId: string; stationKey: string };

/** Chave de um par judge x estação dentro de um escopo. */
export const raceAssignmentPairKey = (pair: RaceAssignmentPair) => `${pair.judgeUserId}|${pair.stationKey}`;

/** Só as linhas de judge ainda atribuído ao evento (AC2, AC7). */
export const filterActiveRaceAssignments = <T extends { judgeUserId: string }>(rows: readonly T[], activeJudgeIds: Iterable<string>): T[] => {
  const active = new Set(activeJudgeIds);
  return rows.filter((row) => active.has(row.judgeUserId));
};

/** A onda tem linhas próprias (depois de tirar os judges removidos do evento)? */
export const raceWaveIsAdjusted = (rows: readonly RaceAssignmentRow[], heatId: string, activeJudgeIds?: Iterable<string>) => {
  const valid = activeJudgeIds ? filterActiveRaceAssignments(rows, activeJudgeIds) : rows;
  return valid.some((row) => row.heatId === heatId);
};

/**
 * Escala efetiva de uma onda (AC2): as linhas da onda quando ela tem linhas
 * próprias; senão, as do padrão do evento. `heatId` nulo devolve o padrão.
 * Com `activeJudgeIds`, os judges que já não estão no evento ficam de fora
 * antes da escolha. Sem repetir o par judge x estação.
 */
export const resolveRaceWaveAssignments = (
  rows: readonly RaceAssignmentRow[],
  heatId: string | null,
  activeJudgeIds?: Iterable<string>
): { source: 'wave' | 'default'; pairs: RaceAssignmentPair[] } => {
  const valid = activeJudgeIds ? filterActiveRaceAssignments(rows, activeJudgeIds) : [...rows];
  const own = heatId ? valid.filter((row) => row.heatId === heatId) : [];
  const source = own.length > 0 ? 'wave' : 'default';
  const picked = source === 'wave' ? own : valid.filter((row) => row.heatId === null);
  const seen = new Set<string>();
  const pairs: RaceAssignmentPair[] = [];
  for (const row of picked) {
    const key = raceAssignmentPairKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ judgeUserId: row.judgeUserId, stationKey: row.stationKey });
  }
  return { source, pairs };
};

/**
 * Lista de `{ judgeUserId, stationKey }` enviada para gravar (AC3): array com
 * no máximo 500 itens, cada um com o id do judge (texto até 120) e a chave da
 * estação (raceStationKey). Pares repetidos viram um. Mensagem em português
 * quando não serve.
 */
export const parseRaceAssignmentPairs = (value: unknown): { ok: true; pairs: RaceAssignmentPair[] } | { ok: false; message: string } => {
  if (!Array.isArray(value)) return { ok: false, message: 'Envie a lista da escala.' };
  if (value.length > RACE_ASSIGNMENTS_MAX_ROWS) return { ok: false, message: `A escala aceita no máximo ${RACE_ASSIGNMENTS_MAX_ROWS} linhas por gravação.` };
  const seen = new Set<string>();
  const pairs: RaceAssignmentPair[] = [];
  for (const item of value) {
    const judgeUserId = item && typeof item === 'object' && typeof (item as { judgeUserId?: unknown }).judgeUserId === 'string'
      ? (item as { judgeUserId: string }).judgeUserId.trim()
      : '';
    const stationKey = item && typeof item === 'object' ? (item as { stationKey?: unknown }).stationKey : undefined;
    if (!judgeUserId || judgeUserId.length > 120 || !isRaceStationKey(stationKey)) return { ok: false, message: 'Linha da escala inválida: informe o judge e a estação.' };
    const pair = { judgeUserId, stationKey };
    const key = raceAssignmentPairKey(pair);
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push(pair);
  }
  return { ok: true, pairs };
};

/** Marca ou desmarca um par na matriz do editor (AC5). */
export const toggleRaceAssignment = (pairs: readonly RaceAssignmentPair[], pair: RaceAssignmentPair): RaceAssignmentPair[] => {
  const key = raceAssignmentPairKey(pair);
  return pairs.some((item) => raceAssignmentPairKey(item) === key)
    ? pairs.filter((item) => raceAssignmentPairKey(item) !== key)
    : [...pairs, { judgeUserId: pair.judgeUserId, stationKey: pair.stationKey }];
};

/** Mesmo conjunto de pares, sem importar a ordem (o editor sabe se há algo a gravar). */
export const sameRaceAssignmentPairs = (a: readonly RaceAssignmentPair[], b: readonly RaceAssignmentPair[]) => {
  const left = new Set(a.map(raceAssignmentPairKey));
  const right = new Set(b.map(raceAssignmentPairKey));
  return left.size === right.size && [...left].every((key) => right.has(key));
};

/** Estações do percurso sem nenhum judge no escopo, na ordem recebida (aviso não bloqueante, AC5; D3). */
export const raceStationsWithoutJudge = (stationKeys: readonly string[], pairs: readonly RaceAssignmentPair[]) => {
  const covered = new Set(pairs.map((pair) => pair.stationKey));
  return stationKeys.filter((key) => !covered.has(key));
};

/** Selo do escopo no seletor do editor (AC5). */
export const describeRaceAssignmentScope = (adjusted: boolean) => (adjusted ? 'Ajustada' : 'Segue o padrão');

export type RaceMyStationsWave = { heatId: string; inProgress: boolean; stationKeys: string[] };

/**
 * "Minhas estações" do judge (AC6): as da onda em andamento (ou das ondas em
 * andamento, juntas) ou, sem onda em andamento, as de todas as ondas. Evento
 * sem onda no cronograma usa o padrão do evento. Sem repetir, na ordem em que
 * aparecem.
 */
export const pickMyRaceStationKeys = (waves: readonly RaceMyStationsWave[], defaultKeys: readonly string[] = []) => {
  const running = waves.filter((wave) => wave.inProgress);
  const source = running.length > 0
    ? running.flatMap((wave) => wave.stationKeys)
    : waves.length > 0 ? waves.flatMap((wave) => wave.stationKeys) : [...defaultKeys];
  return [...new Set(source)];
};

/**
 * Lista de estações do judge com "Minhas estações" primeiro (AC6): as dele, na
 * ordem do percurso, e as demais em seguida. Sem nenhuma estação dele, tudo
 * fica em `others`, como na Story 1.102.
 */
export const splitMyRaceStations = <T extends { key: string }>(stations: readonly T[], myKeys: readonly string[]) => {
  const mine = new Set(myKeys);
  return {
    mine: stations.filter((station) => mine.has(station.key)),
    others: stations.filter((station) => !mine.has(station.key))
  };
};
