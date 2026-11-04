import {
  RACE_CLASS_STEP_MS,
  RACE_PAGE_SIZE,
  RACE_TOWER_PAGE_MS,
  racePageCount,
  raceStepIndex,
  type RaceBoardRow,
  type RaceStationRecord
} from '@/lib/raceBroadcast';
import type {
  RaceArrivalView,
  RaceBroadcastPayload,
  RaceClassPayload,
  RaceGridPayload,
  RaceLiveBoardView,
  RaceLivePayload,
  RaceStageView
} from '@/lib/raceBroadcastPayload';
import {
  describeRaceCardA,
  describeRaceGap,
  formatRaceTime,
  racePointText,
  type RaceCardA,
  type RaceLiveFrame,
  type RaceWhereView
} from '@/lib/raceBroadcastView';

// Momentos do telão do Fitness Race (Story 1.114): o grid de largada, as luzes que
// acendem quando o telão vê a largada (D3), a bandeirada de quem fecha o tempo (D34)
// e o roxo de melhor estação (D5). Puro: sem React, sem rede e sem relógio próprio
// (a hora do servidor entra por `nowMs`). O telão só lê: nada aqui larga onda (D45).
// Desenho aprovado em docs/design/telao-fitness-race/ (grid, luzes, bandeirada, roxo).
//
// O estado que existe vive só na tela, por abertura (a chave opaca já mostrada, a fila
// da bandeirada), nunca no servidor, para a `version` do payload não mudar sem dado novo.

const joinNames = (names: readonly string[]) => names.join(' e ');

// ---------------------------------------------------------------------------
// Luzes de largada (D3)
// ---------------------------------------------------------------------------

/** Cinco unidades de duas lâmpadas cada, como na maquete. */
export const RACE_LIGHTS_UNITS = 5;
/** Intervalo entre uma unidade acender e a seguinte. */
export const RACE_LIGHTS_STEP_MS = 170;
/** A largada só vale para as luzes se foi vista há menos disto (T4-3): TV que volta de uma queda não pisca luz atrasada. */
export const RACE_LIGHTS_FRESH_MS = 15_000;

export type RaceSeenStart = {
  waveKey: string;
  waveTitle: string;
  /** "Open Masculino" ou "Open Masculino e Open Feminino": as categorias da onda que largou. */
  divisionsText: string;
  startedAt: string;
  /** `screen`: o painel cobre a tela; `map`: entra por cima do mapa, com a torre de outra onda visível (Regra 5). */
  placement: 'screen' | 'map';
};

const liveOf = (payload: RaceBroadcastPayload): RaceLivePayload | null => (payload.screen === 'live' ? payload.live : null);

/**
 * A largada que o telão acabou de ver (AC3): uma onda que a resposta anterior, na mesma
 * abertura da tela, não trazia entre as largadas e que largou há menos de 15 s pela hora
 * do servidor. Nunca na primeira carga, nem para onda que já vinha largada (corrigir a
 * largada não conta), e só quando a onda que largou vai ao ar: com a mesa fixada em outra
 * onda, na classificação ou na espera, ela não está nos passos e a tela fixada continua.
 * Duas ondas na mesma consulta fazem uma sequência só, para a mais recente. Zerar a largada
 * tira a onda das largadas, então largar de novo dispara de novo.
 */
export const detectSeenStart = (previous: RaceBroadcastPayload | null, next: RaceBroadcastPayload, nowMs: number): RaceSeenStart | null => {
  if (previous === null) return null;
  const live = liveOf(next);
  if (!live) return null;
  const previousLive = liveOf(previous);
  const known = new Set((previousLive?.waves ?? []).map((wave) => wave.key));
  // Torre da categoria (ranking único): a onda está no ar quando alguma categoria dela tem torre; torre de uma onda: só a do passo.
  const onAir = new Set(live.scope === 'division'
    ? live.waves.filter((wave) => live.boards.some((board) => wave.divisionKeys.includes(board.divisionKey))).map((wave) => wave.key)
    : live.steps.map((step) => step.waveKey).filter((key): key is string => key !== null));
  const candidates = live.waves
    .filter((wave) => !known.has(wave.key) && onAir.has(wave.key))
    .map((wave) => ({ wave, at: Date.parse(wave.startedAt) }))
    .filter((item) => Number.isFinite(item.at) && nowMs - item.at < RACE_LIGHTS_FRESH_MS)
    .sort((a, b) => b.at - a.at);
  const chosen = candidates[0]?.wave;
  if (!chosen) return null;
  const divisions = live.scope === 'division'
    ? chosen.divisionKeys.map((key) => live.boards.find((board) => board.divisionKey === key)?.divisionName ?? '').filter(Boolean)
    : [...new Set(live.boards.filter((board) => board.waveKey === chosen.key).map((board) => board.divisionName))];
  return {
    waveKey: chosen.key,
    waveTitle: chosen.title,
    divisionsText: joinNames(divisions),
    startedAt: chosen.startedAt,
    placement: previousLive !== null && previousLive.steps.length > 0 ? 'map' : 'screen'
  };
};

export type RaceLightsPlan = {
  reduced: boolean;
  /** Instante (ms desde o início do painel) em que cada unidade acende. */
  litAtMs: number[];
  /** As unidades apagam juntas e aparece "Largada!". */
  offAtMs: number;
  /** O painel sai. */
  endMs: number;
};

/**
 * A sequência do painel: com movimento, as unidades acendem uma a uma (170 ms), apagam
 * juntas 550 ms depois da última, "Largada!" fica por 1,35 s e o painel sai. Com
 * `prefers-reduced-motion` não há passo a passo: as cinco aparecem juntas, apagam juntas
 * (T4-6: 500 ms acesas) e "Largada!" fica 400 ms.
 */
export const raceLightsPlan = (reducedMotion: boolean): RaceLightsPlan => {
  if (reducedMotion) return { reduced: true, litAtMs: Array.from({ length: RACE_LIGHTS_UNITS }, () => 0), offAtMs: 500, endMs: 900 };
  const lastLit = RACE_LIGHTS_STEP_MS * RACE_LIGHTS_UNITS;
  return {
    reduced: false,
    litAtMs: Array.from({ length: RACE_LIGHTS_UNITS }, (_, index) => RACE_LIGHTS_STEP_MS * (index + 1)),
    offAtMs: lastLit + 550,
    endMs: lastLit + 1_900
  };
};

export type RaceLightsFrame = { phase: 'lights' | 'go' | 'done'; lit: number };

/** O que o painel mostra passados `elapsedMs`: quantas unidades acesas, "Largada!" ou nada. */
export const raceLightsFrame = (plan: RaceLightsPlan, elapsedMs: number): RaceLightsFrame => {
  if (elapsedMs >= plan.endMs) return { phase: 'done', lit: 0 };
  if (elapsedMs >= plan.offAtMs) return { phase: 'go', lit: 0 };
  return { phase: 'lights', lit: plan.litAtMs.filter((at) => at <= elapsedMs).length };
};

/** A mensagem embaixo das lâmpadas: a onda e as categorias até o sinal, depois "Largada!". */
export const raceLightsMessage = (start: Pick<RaceSeenStart, 'waveTitle' | 'divisionsText'>, frame: RaceLightsFrame) => (
  frame.phase === 'go' ? 'Largada!' : [start.waveTitle, start.divisionsText].filter(Boolean).join(' · ')
);

// ---------------------------------------------------------------------------
// Bandeirada (D34)
// ---------------------------------------------------------------------------

/** Uma chegada vale enquanto o `finish_at` está nos últimos 30 s pela hora do servidor (T4-2). */
export const RACE_FLAG_WINDOW_MS = 30_000;
/** Tempo no ar da bandeirada; 4,5 s quando há outra na fila. */
export const RACE_FLAG_MS = 6_500;
export const RACE_FLAG_QUEUED_MS = 4_500;

export type RaceFlagState = {
  /** Chaves opacas já enfileiradas ou mostradas nesta abertura da tela: cada chegada aparece uma vez. */
  seen: readonly string[];
  queue: readonly RaceArrivalView[];
  current: { arrival: RaceArrivalView; until: number } | null;
  /** A última mostrada: fica montada depois que expira, para a bandeirada sair com a transição. */
  last: RaceArrivalView | null;
};

export const RACE_FLAG_INITIAL: RaceFlagState = { seen: [], queue: [], current: null, last: null };

/**
 * Avança a fila da bandeirada (AC4): entram as chegadas dos últimos 30 s ainda não vistas,
 * por instante; cada uma fica 6,5 s (4,5 s quando há outra esperando); a próxima entra
 * quando a atual vence. Devolve o mesmo objeto quando nada muda, para a tela não renderizar à toa.
 */
export const nextRaceFlagState = (state: RaceFlagState, arrivals: readonly RaceArrivalView[], nowMs: number): RaceFlagState => {
  const taken = new Set(state.seen);
  const inWindow = arrivals
    .map((arrival) => ({ arrival, at: Date.parse(arrival.finishAt) }))
    .filter((item) => Number.isFinite(item.at) && nowMs - item.at <= RACE_FLAG_WINDOW_MS)
    .sort((a, b) => a.at - b.at || a.arrival.athleteKey.localeCompare(b.arrival.athleteKey));
  const fresh: RaceArrivalView[] = [];
  for (const { arrival } of inWindow) {
    if (taken.has(arrival.athleteKey)) continue;
    taken.add(arrival.athleteKey);
    fresh.push(arrival);
  }

  let { seen, queue, current, last } = state;
  let changed = false;
  if (fresh.length > 0) {
    seen = [...seen, ...fresh.map((arrival) => arrival.athleteKey)];
    queue = [...queue, ...fresh];
    changed = true;
  }
  if (current && nowMs >= current.until) {
    current = null;
    changed = true;
  }
  if (!current && queue.length > 0) {
    const [head, ...rest] = queue;
    queue = rest;
    current = { arrival: head, until: nowMs + (rest.length > 0 ? RACE_FLAG_QUEUED_MS : RACE_FLAG_MS) };
    last = head;
    changed = true;
  }
  return changed ? { seen, queue, current, last } : state;
};

export type RaceFlagView = {
  /** "Chegada · Onda 3 · 10:26:29". */
  eyebrow: string;
  /** "1º", ou "–" quando o resultado da categoria ainda não foi publicado. */
  position: string;
  positionCaption: string;
  name: string;
  /** "Box Aldeota · Open Masculino". */
  who: string;
  time: string;
  /** "Tempo final" ou "Tempo final · inclui +15 s de penalidade" (só os segundos, D2). */
  timeCaption: string;
  /** "Melhor da categoria: Wall Balls 4:05" quando o atleta detém o roxo de alguma estação; vazio senão. */
  best: string;
};

/**
 * O texto da bandeirada. O tempo final sai pela função única de formatação (Regra 4). Com mais de
 * um roxo, a linha traz o mais novo (o que o atleta acabou de conquistar, T4-7), pelo instante dos
 * recordes; sem instante conhecido, a ordem do payload.
 */
export const describeRaceFlag = (arrival: RaceArrivalView, waveTitle: string | null, records: readonly RaceStationRecord[] = []): RaceFlagView => {
  const recency = (hold: RaceArrivalView['holds'][number]) => {
    const record = records.find((item) => item.athleteKey === arrival.athleteKey && item.stationName === hold.stationName);
    const at = record?.at ? Date.parse(record.at) : Number.NaN;
    return Number.isFinite(at) ? at : -1;
  };
  const holds = [...arrival.holds].sort((a, b) => recency(b) - recency(a));
  const hold = holds[0];
  const more = holds.length - 1;
  return {
    eyebrow: ['Chegada', waveTitle, arrival.finishClock].filter(Boolean).join(' · '),
    position: arrival.position === null ? '–' : `${arrival.position}º`,
    positionCaption: 'na categoria até agora',
    name: arrival.name,
    who: [arrival.box, arrival.divisionName].filter(Boolean).join(' · '),
    time: formatRaceTime(arrival.finalSeconds),
    timeCaption: arrival.penaltySeconds > 0 ? `Tempo final · inclui +${arrival.penaltySeconds} s de penalidade` : 'Tempo final',
    best: hold ? `Melhor da categoria: ${hold.stationName} ${formatRaceTime(hold.seconds)}${more > 0 ? ` e mais ${more}` : ''}` : ''
  };
};

/** A onda da chegada, para o título da bandeirada (a chegada pode ser de um passo que não é o do rodízio). */
export const raceArrivalWaveTitle = (live: Pick<RaceLivePayload, 'waves' | 'boards'>, arrival: Pick<RaceArrivalView, 'waveKey'>): string | null => {
  if (!arrival.waveKey) return null;
  return live.waves.find((wave) => wave.key === arrival.waveKey)?.title
    ?? live.boards.find((board) => board.waveKey === arrival.waveKey)?.waveTitle
    ?? null;
};

// ---------------------------------------------------------------------------
// Novo líder (torre da categoria, ranking único)
// ---------------------------------------------------------------------------

/** O cartão "Novo líder da prova" fica por isto depois que o 1º da categoria muda. */
export const RACE_NEW_LEADER_MS = 6_500;

export type RaceLeaderState = {
  /** O 1º de cada torre da categoria na última resposta vista nesta abertura da tela. */
  leaders: Readonly<Record<string, string>>;
  /** A troca mais recente de cada torre: quem passou a liderar, quem liderava e até quando o cartão fica. */
  changes: Readonly<Record<string, { leaderKey: string; previousKey: string; until: number }>>;
};

export const RACE_LEADER_INITIAL: RaceLeaderState = { leaders: {}, changes: {} };

const leaderOf = (board: Pick<RaceLiveBoardView, 'rows'>) => board.rows.find((row) => row.isLeader)?.athleteKey ?? null;

/**
 * Troca de líder nas torres das categorias, entre a resposta anterior e a nova, na mesma abertura da
 * tela (nunca na primeira carga). A torre de uma onda não tem o cartão. Estado só da tela, para a
 * `version` do payload não mudar sem dado novo.
 */
export const nextRaceLeaderState = (state: RaceLeaderState, live: Pick<RaceLivePayload, 'boards'> | null, nowMs: number, first: boolean): RaceLeaderState => {
  const leaders: Record<string, string> = {};
  const changes: Record<string, { leaderKey: string; previousKey: string; until: number }> = {};
  for (const [key, change] of Object.entries(state.changes)) if (change.until > nowMs) changes[key] = change;
  for (const board of live?.boards ?? []) {
    if (board.scope !== 'division') continue;
    const leader = leaderOf(board);
    if (!leader) continue;
    leaders[board.divisionKey] = leader;
    const previous = state.leaders[board.divisionKey];
    if (!first && previous && previous !== leader) changes[board.divisionKey] = { leaderKey: leader, previousKey: previous, until: nowMs + RACE_NEW_LEADER_MS };
  }
  return { leaders, changes };
};

export type RaceNewLeaderCard = {
  kind: 'newLeader';
  eyebrow: string;
  name: string;
  /** "Onda 2 · CT Meireles". */
  who: string;
  /** "Passou Rafael Tavares (Onda 1) na saída Ski Erg"; vazio quando o anterior já não está na torre. */
  at: string;
  /** "0:13": a diferença do antigo líder no ponto em que se compararam; vazio sem diferença. */
  advantage: string;
};

/** O cartão do novo líder enquanto a troca está no ar e ele continua em 1º. */
export const describeRaceNewLeader = (board: RaceLiveBoardView, state: RaceLeaderState, nowMs: number): RaceNewLeaderCard | null => {
  if (board.scope !== 'division') return null;
  const change = state.changes[board.divisionKey];
  if (!change || change.until <= nowMs || leaderOf(board) !== change.leaderKey) return null;
  const leader = board.rows.find((row) => row.athleteKey === change.leaderKey);
  if (!leader) return null;
  const previous = board.rows.find((row) => row.athleteKey === change.previousKey);
  const gap = previous ? describeRaceGap(previous, { scope: 'division', nowMs }) : null;
  const point = previous?.gapPoint ?? null;
  return {
    kind: 'newLeader',
    eyebrow: 'Novo líder da prova',
    name: leader.name,
    who: [leader.waveTitle, leader.box].filter(Boolean).join(' · '),
    at: previous ? [`Passou ${previous.name}${previous.waveTitle ? ` (${previous.waveTitle})` : ''}`, point ? `na ${racePointText(point)}` : ''].filter(Boolean).join(' ') : '',
    advantage: gap && (gap.tone === 'gap' || gap.tone === 'ahead') ? gap.text.replace(/^[+−]/, '') : ''
  };
};

// ---------------------------------------------------------------------------
// Roxo de melhor estação (D5)
// ---------------------------------------------------------------------------

/** A linha da torre e o marcador do mapa ficam roxos por isto, a partir do instante do recorde. */
export const RACE_PURPLE_ROW_MS = 9_000;
/** O cartão A "Melhor da categoria · roxo" fica por isto. */
export const RACE_PURPLE_CARD_MS = 11_000;

const recordAge = (record: Pick<RaceStationRecord, 'at'>, nowMs: number): number | null => {
  if (!record.at) return null;
  const at = Date.parse(record.at);
  return Number.isFinite(at) ? nowMs - at : null;
};

/**
 * Recordes dentro da janela, do mais novo ao mais antigo. A tela decide pelo instante do
 * recorde e pela hora do servidor, sem estado novo: TV reaberta depois da janela não pisca,
 * e recorde sem instante (split publicado) nunca é roxo.
 */
export const activeRaceRecords = (records: readonly RaceStationRecord[], nowMs: number, windowMs: number): RaceStationRecord[] => records
  .flatMap((record) => {
    const age = recordAge(record, nowMs);
    return age !== null && age < windowMs ? [{ record, age }] : [];
  })
  .sort((a, b) => a.age - b.age)
  .map((item) => item.record);

/** O roxo em curso de cada atleta (o mais novo, 9 s): a linha da torre e o marcador do mapa. */
export const racePurpleByAthlete = (records: readonly RaceStationRecord[], nowMs: number): Map<string, RaceStationRecord> => {
  const byAthlete = new Map<string, RaceStationRecord>();
  for (const record of activeRaceRecords(records, nowMs, RACE_PURPLE_ROW_MS)) {
    if (!byAthlete.has(record.athleteKey)) byAthlete.set(record.athleteKey, record);
  }
  return byAthlete;
};

/**
 * "Onde está" da linha roxa: "{ESTAÇÃO}" e "melhor da categoria · m:ss". Só vale para quem
 * ainda corre: a chegada e o DNF mostram o texto deles, como na maquete.
 */
export const withRacePurple = (where: RaceWhereView, row: Pick<RaceBoardRow, 'status'>, record: RaceStationRecord | undefined): RaceWhereView => {
  if (!record || row.status !== 'racing') return where;
  const time = formatRaceTime(record.seconds);
  return {
    tone: 'purple',
    main: record.stationName,
    sub: `melhor da categoria · ${time}`,
    parts: { name: record.stationName, progress: '', subText: 'melhor da categoria', counter: time }
  };
};

export type RacePurpleCard = {
  kind: 'purple';
  /** "Melhor da categoria · roxo", com a onda e a categoria quando o recorde não é do passo no ar. */
  eyebrow: string;
  station: string;
  time: string;
  /** "Nome · Box". */
  who: string;
  /** "Antes: 4:12 · Nome (Onda 2)" ou "Primeiro tempo da categoria nesta estação". */
  was: string;
};

/**
 * Cartão A do roxo (AC5c): o recorde mais novo dentro de 11 s, com prioridade sobre a
 * disputa e o líder. Com rodízio (T4-5) entra no passo que estiver no ar, com a onda e a
 * categoria no título quando forem outras. Null sem recorde em curso.
 */
export const describeRacePurpleCard = (live: Pick<RaceLivePayload, 'records' | 'boards'>, frame: Pick<RaceLiveFrame, 'board' | 'wave'>, nowMs: number): RacePurpleCard | null => {
  const record = activeRaceRecords(live.records, nowMs, RACE_PURPLE_CARD_MS)[0];
  if (!record) return null;
  const divisionName = live.boards.find((board) => board.divisionKey === record.divisionKey)?.divisionName ?? '';
  const sameStep = record.divisionKey === frame.board.divisionKey
    && (frame.board.scope === 'division' || !record.waveTitle || record.waveTitle === frame.wave?.title);
  const previous = record.previous;
  return {
    kind: 'purple',
    eyebrow: ['Melhor da categoria · roxo', ...(sameStep ? [] : [record.waveTitle, divisionName])].filter(Boolean).join(' · '),
    station: record.stationName,
    time: formatRaceTime(record.seconds),
    who: [record.name, record.box].filter(Boolean).join(' · '),
    was: previous
      ? `Antes: ${formatRaceTime(previous.seconds)} · ${previous.name}${previous.waveTitle ? ` (${previous.waveTitle})` : ''}`
      : 'Primeiro tempo da categoria nesta estação'
  };
};

/** Cartão A: o roxo primeiro; depois o novo líder (torre da categoria); sem eles, a prioridade da 1.113 (disputa, sem leitura, líder). */
export const describeRaceCardAWithPurple = (
  live: RaceLivePayload,
  frame: RaceLiveFrame,
  nowMs: number,
  leaders: RaceLeaderState = RACE_LEADER_INITIAL
): RaceCardA | RacePurpleCard | RaceNewLeaderCard | null => (
  describeRacePurpleCard(live, frame, nowMs) ?? describeRaceNewLeader(frame.board, leaders, nowMs) ?? describeRaceCardA(frame.board, frame.wave, nowMs)
);

// ---------------------------------------------------------------------------
// Grid de largada
// ---------------------------------------------------------------------------

export type RaceGridSlotView = { number: number; name: string; box: string; division: string };
export type RaceGridStationView = { name: string; meta: string };

export type RaceGridFrame = {
  waveKey: string;
  /** Título do cabeçalho: "Grid de largada · Onda 3". */
  title: string;
  /** "Onda 3". */
  heading: string;
  /** "Open Masculino · 10 atletas · ordem do cronograma". */
  summary: string;
  /** As vagas da página no ar, numeradas na ordem do cronograma (a numeração segue entre as páginas). */
  slots: RaceGridSlotView[];
  /** Mais de uma categoria na onda: a categoria vai em cada linha (T4-1). */
  showDivision: boolean;
  pageIndex: number;
  pageCount: number;
  /** "Largada prevista", "10:12" e o aviso de que a largada vale no gesto do organizador (D45). */
  when: { label: string; time: string; hint: string };
  /** "Percurso" e as estações, com meta e carga; com percursos diferentes, um por categoria a cada 12 s. */
  course: { label: string; stations: RaceGridStationView[] };
  /** Rodapé: "Largada" e "Onda 3 · prevista 10:12 · o relógio começa no sinal do organizador". */
  footer: { label: string; text: string };
};

const gridStations = (stages: readonly RaceStageView[]): RaceGridStationView[] => stages
  .filter((stage) => stage.type === 'station')
  .map((stage) => ({ name: stage.name, meta: [stage.target, stage.load].filter(Boolean).join(' · ') }));

/** Estações do percurso; categorias com o mesmo percurso dividem uma página, as outras alternam a cada 12 s. */
const gridCourse = (grid: RaceGridPayload, nowMs: number): RaceGridFrame['course'] => {
  const groups: { names: string[]; stations: RaceGridStationView[]; signature: string }[] = [];
  for (const course of grid.courses) {
    const stations = gridStations(course.stages);
    const signature = JSON.stringify(stations);
    const group = groups.find((item) => item.signature === signature);
    if (group) group.names.push(course.divisionName);
    else groups.push({ names: [course.divisionName], stations, signature });
  }
  if (groups.length === 0) return { label: 'Percurso', stations: [] };
  const group = groups[raceStepIndex(nowMs, RACE_CLASS_STEP_MS, groups.length)];
  return { label: groups.length > 1 ? `Percurso · ${joinNames(group.names)}` : 'Percurso', stations: group.stations };
};

/**
 * O grid da onda (AC2). Sozinho, a onda com mais de 10 atletas alterna páginas de 8 s
 * (Regra 5); na alternância com a classificação, `page` é a que o passo de 12 s indica.
 * O horário previsto é só informação: a largada vale no gesto do gestor (D45).
 */
export const raceGridFrame = (grid: RaceGridPayload, nowMs: number, page?: number): RaceGridFrame => {
  const total = grid.athletes.length;
  const pageCount = racePageCount(total);
  const pageIndex = page === undefined ? raceStepIndex(nowMs, RACE_TOWER_PAGE_MS, pageCount) : Math.min(pageCount - 1, Math.max(0, Math.floor(page)));
  const wave = grid.wave;
  const first = pageIndex * RACE_PAGE_SIZE;
  const people = `${total} ${total === 1 ? 'atleta' : 'atletas'}`;
  return {
    waveKey: wave.key,
    title: `Grid de largada · ${wave.title}`,
    heading: wave.title,
    summary: [joinNames(wave.divisionNames), people, 'ordem do cronograma'].filter(Boolean).join(' · '),
    slots: grid.athletes.slice(first, first + RACE_PAGE_SIZE).map((athlete, index) => ({
      number: first + index + 1,
      name: athlete.name,
      box: athlete.box,
      division: athlete.divisionName
    })),
    showDivision: new Set(grid.athletes.map((athlete) => athlete.divisionKey)).size > 1,
    pageIndex,
    pageCount,
    when: { label: wave.time ? 'Largada prevista' : 'Largada', time: wave.time, hint: 'Aguardando o sinal do organizador' },
    course: gridCourse(grid, nowMs),
    footer: {
      label: 'Largada',
      text: [wave.title, wave.time ? `prevista ${wave.time}` : '', 'o relógio começa no sinal do organizador'].filter(Boolean).join(' · ')
    }
  };
};

/**
 * O grid da alternância com a classificação: quando o passo de 12 s do momento é do grid,
 * a página que ele indica; senão null (o passo é da classificação).
 */
export const raceClassGridFrame = (cls: Pick<RaceClassPayload, 'steps' | 'grid'>, nowMs: number): RaceGridFrame | null => {
  if (!cls.grid || cls.steps.length === 0) return null;
  const step = cls.steps[raceStepIndex(nowMs, RACE_CLASS_STEP_MS, cls.steps.length)];
  return step.kind === 'grid' && step.waveKey === cls.grid.wave.key ? raceGridFrame(cls.grid, nowMs, step.page) : null;
};
