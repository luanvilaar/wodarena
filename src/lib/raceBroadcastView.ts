import {
  RACE_TOWER_PAGE_MS,
  raceBoardPageSize,
  raceFixedKeys,
  raceLiveStepDurations,
  raceQuietMs,
  raceStepIndex,
  raceTimedStep,
  raceTowerPages,
  type RaceBoardRow,
  type RacePointRef
} from '@/lib/raceBroadcast';
import type { BroadcastPayload } from '@/lib/broadcastPayload';
import type {
  RaceBroadcastPayload,
  RaceLiveBoardView,
  RaceLivePayload,
  RaceLiveWaveView,
  RaceStageView,
  RaceTickerEvent,
  RaceWaveBrief
} from '@/lib/raceBroadcastPayload';

// Apresentação do telão do Fitness Race (Story 1.113). Puro: sem React, sem rede
// e sem relógio próprio (a hora do servidor entra por `nowMs`). Todo texto e todo
// número da tela ao vivo sai daqui, para ser testado direto (o harness de testes
// não carrega CSS nem componente). Desenho aprovado em
// docs/design/telao-fitness-race/ (telão "Ao vivo": torre, mapa, cartões e faixa).
//
// Regras que valem em toda a tela (README do telão): tempos e diferenças em
// segundos inteiros, por uma função única de formatação (Regra 4); penalidade só
// em segundos, nunca o motivo (D2); sem previsão de chegada, ritmo nem chance de
// ultrapassagem (Regra 8); estação sem leitura não vira tempo nem posição.

/** Consulta ao servidor enquanto há onda no ar ou por largar (as luzes da D3 pedem a largada vista em ~2 s). */
export const RACE_LIVE_POLL_MS = 1_000;
/** Consulta quando todas as ondas já largaram e nenhuma está ao vivo. */
export const RACE_IDLE_POLL_MS = 5_000;
/** A seta verde ou vermelha de quem mudou de posição dura isto. */
export const RACE_ARROW_MS = 5_000;

/** O payload é do telão do Fitness Race (o de Functional Fitness não tem `eventType`). */
export const isRaceBroadcastPayload = (payload: BroadcastPayload | RaceBroadcastPayload): payload is RaceBroadcastPayload => (
  'eventType' in payload && payload.eventType === 'fitness_racing'
);

/** Cadência da consulta: 1 s com tela ao vivo ou onda ainda por largar, 5 s no resto (AC2, T3-1). */
export const racePollMs = (payload: Pick<RaceBroadcastPayload, 'screen' | 'next'>) => (
  payload.screen === 'live' || payload.next !== null ? RACE_LIVE_POLL_MS : RACE_IDLE_POLL_MS
);

// ---------------------------------------------------------------------------
// Formatação única de tempo
// ---------------------------------------------------------------------------

const pad2 = (value: number) => String(value).padStart(2, '0');

/**
 * Tempo ou diferença em segundos inteiros: `m:ss`, ou `h:mm:ss` a partir de 1 h.
 * Arredonda para o segundo mais próximo, como o tempo oficial publicado; nunca
 * trunca. É a única função de formatação de tempo e diferença das telas.
 */
export const formatRaceTime = (seconds: number) => {
  const total = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return hours > 0 ? `${hours}:${pad2(minutes)}:${pad2(total % 60)}` : `${minutes}:${pad2(total % 60)}`;
};

/** Relógio que corre (o da onda): `mm:ss`, ou `h:mm:ss` a partir de 1 h; só segundos completos. */
export const formatRaceRunningClock = (seconds: number) => {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return hours > 0 ? `${hours}:${pad2(minutes)}:${pad2(total % 60)}` : `${pad2(minutes)}:${pad2(total % 60)}`;
};

/** Segundos desde um instante ISO, pela hora do servidor; nunca negativo. Null sem instante válido. */
export const raceSecondsSince = (iso: string | null | undefined, nowMs: number) => {
  const at = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(at) ? Math.max(0, (nowMs - at) / 1000) : null;
};

/** Diferença com sinal: "+0:44" ou "−0:20" (segundos inteiros, como o resto da tela). */
export const formatRaceSignedGap = (seconds: number) => {
  const rounded = Math.round(Number.isFinite(seconds) ? seconds : 0);
  return `${rounded < 0 ? '−' : '+'}${formatRaceTime(Math.abs(rounded))}`;
};

/** O ponto como a tela escreve: "entrada Sled Push", "saída Sled Push" ou "chegada". */
export const racePointText = (point: RacePointRef | null | undefined) => {
  if (!point) return '';
  if (point.side === 'finish') return 'chegada';
  return `${point.side === 'in' ? 'entrada' : 'saída'} ${point.stationName}`;
};

/** Relógio do atleta (tempo de prova agora): desde a largada da corrida dele, mais as penalidades vigentes (R2). */
export const raceAthleteClock = (row: Pick<RaceBoardRow, 'startedAt' | 'penaltySeconds'>, nowMs: number) => {
  const elapsed = raceSecondsSince(row.startedAt, nowMs);
  return elapsed === null ? null : elapsed + Math.max(0, row.penaltySeconds || 0);
};

/** Selo da onda na torre da categoria: "O3"; vazio sem número de onda. */
export const raceWaveTag = (waveNumber: number | null | undefined) => (typeof waveNumber === 'number' && Number.isFinite(waveNumber) ? `O${waveNumber}` : '');

// ---------------------------------------------------------------------------
// Passo do rodízio e página da torre (D1, Regra 5)
// ---------------------------------------------------------------------------

export type RaceLiveFrame = {
  board: RaceLiveBoardView;
  /** A onda da torre de uma onda (mesa); null na torre da categoria. */
  wave: RaceLiveWaveView | null;
  /** Ondas na pista com atletas desta categoria (relógios do cabeçalho); na torre de uma onda, só ela. */
  waves: RaceLiveWaveView[];
  stepIndex: number;
  stepCount: number;
  pageIndex: number;
  pageCount: number;
  /** Linhas da página no ar, na ordem da torre; o líder e a reta final ficam em toda página. */
  rows: RaceBoardRow[];
};

const stepBoard = (live: RaceLivePayload, step: RaceLivePayload['steps'][number]) => live.boards.find((item) => (
  item.divisionKey === step.divisionKey && (item.waveKey ?? null) === (step.waveKey ?? null)
));

/**
 * O que a tela ao vivo mostra agora, pela hora do servidor, para duas TVs mostrarem o mesmo. Torre
 * da categoria (ranking único, R3): páginas de 15 linhas a 8 s e o passo fica no ar até mostrar todas
 * (pelo menos 20 s). Torre de uma onda (mesa): passos de 20 s e páginas de 10 linhas a 8 s, como na
 * 1.113. Null quando não há passo no ar.
 */
export const raceLiveFrame = (live: RaceLivePayload, nowMs: number): RaceLiveFrame | null => {
  const boards = live.steps.map((step) => stepBoard(live, step)).filter((board): board is RaceLiveBoardView => Boolean(board));
  if (boards.length === 0) return null;
  const { index: stepIndex, offsetMs } = raceTimedStep(nowMs, raceLiveStepDurations(boards));
  const board = boards[stepIndex];
  const wave = board.scope === 'wave' ? live.waves.find((item) => item.key === board.waveKey) ?? null : null;
  if (board.scope === 'wave' && !wave) return null;
  const waves = board.scope === 'division' ? live.waves.filter((item) => item.divisionKeys.includes(board.divisionKey)) : [wave as RaceLiveWaveView];
  const pages = raceTowerPages(board.rows, raceFixedKeys(board), raceBoardPageSize(board));
  const pageIndex = board.scope === 'division' && boards.length > 1
    ? Math.floor(offsetMs / RACE_TOWER_PAGE_MS) % pages.length
    : raceStepIndex(nowMs, RACE_TOWER_PAGE_MS, pages.length);
  const onPage = new Set(pages[pageIndex] ?? []);
  return { board, wave, waves, stepIndex, stepCount: boards.length, pageIndex, pageCount: pages.length, rows: board.rows.filter((row) => onPage.has(row.athleteKey)) };
};

// ---------------------------------------------------------------------------
// Cabeçalho
// ---------------------------------------------------------------------------

export type RaceHeaderView = {
  title: string;
  /** Relógio grande (torre de uma onda); vazio na torre da categoria, que mostra `clocks`. */
  clock: string;
  caption: string;
  /** Torre da categoria: um relógio por onda na pista com atletas dela (até 4, as mais novas), na ordem de largada. */
  clocks: { key: string; label: string; clock: string }[];
};

/** Quantos relógios de onda cabem no cabeçalho da torre da categoria. */
export const RACE_HEADER_CLOCKS_MAX = 4;

/**
 * Cabeçalho. Torre de uma onda: "Onda N · Categoria" e o relógio da onda. Torre da categoria (ranking
 * único): "Categoria · ranking da prova" e um relógio por onda na pista, contado da largada oficial
 * pela hora do servidor.
 */
export const describeRaceHeader = (frame: RaceLiveFrame, nowMs: number): RaceHeaderView => {
  if (frame.board.scope === 'division' || !frame.wave) {
    const clocks = [...frame.waves]
      .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
      .slice(-RACE_HEADER_CLOCKS_MAX)
      .map((wave) => {
        const elapsed = raceSecondsSince(wave.startedAt, nowMs);
        return { key: wave.key, label: wave.title, clock: elapsed === null ? '--:--' : formatRaceRunningClock(elapsed) };
      });
    return { title: `${frame.board.divisionName} · ranking da prova`, clock: '', caption: '', clocks };
  }
  const elapsed = raceSecondsSince(frame.wave.startedAt, nowMs);
  return {
    title: `${frame.board.waveTitle ?? frame.wave.title} · ${frame.board.divisionName}`,
    clock: elapsed === null ? '--:--' : formatRaceRunningClock(elapsed),
    caption: frame.wave.heatNumber !== null ? `Tempo da onda ${frame.wave.heatNumber}` : 'Tempo da onda',
    clocks: []
  };
};

/** Há alguém correndo na torre (o selo do cabeçalho diz AO VIVO; senão, ENCERRADA). */
export const raceFrameRacing = (frame: RaceLiveFrame) => (
  frame.wave && frame.board.scope === 'wave' ? frame.wave.racingCount > 0 : frame.board.rows.some((row) => row.status === 'racing')
);

// ---------------------------------------------------------------------------
// Linha da torre
// ---------------------------------------------------------------------------

export type RaceWhereView = {
  tone: 'station' | 'track' | 'finished' | 'dnf' | 'stalled' | 'purple';
  /** Linha de cima inteira: "Sled Pull 2/4", "Wall Balls 75", "Na pista". */
  main: string;
  /** Linha de baixo inteira: "na estação · 1:12", "após Sled Pull · 0:25". */
  sub: string;
  /**
   * O mesmo texto em partes: a tela corta com reticências só o nome e o assunto, nunca o
   * progresso nem o contador (nome de estação inteiro é largo e o que importa é o "2/4" e o tempo).
   */
  parts: { name: string; progress: string; subText: string; counter: string };
};

const whereView = (tone: RaceWhereView['tone'], parts: RaceWhereView['parts']): RaceWhereView => ({
  tone,
  main: parts.progress ? `${parts.name} ${parts.progress}` : parts.name,
  sub: parts.counter ? `${parts.subText} · ${parts.counter}` : parts.subText,
  parts
});

/**
 * "Onde está" (AC5; Regras 1 e 2; D4): na estação com o progresso do tipo dela,
 * entre estações com a última estação e o tempo desde a saída (posição
 * estimada), "Sem tempo fechado" (D44), chegada e DNF. `closingStationId` é a
 * estação que fecha o tempo, que ganha "reta final" no subtexto.
 */
export const describeRaceWhere = (row: RaceBoardRow, closingStationId: string | null, nowMs: number): RaceWhereView => {
  const where = row.where;
  // Torre da categoria: quem largou e ainda não tem leitura fica sem posição, "aguardando 1ª leitura".
  if (row.position === null && row.status === 'racing' && where.kind === 'track' && !where.afterStationId && !where.closedWithoutTime) {
    const since = raceSecondsSince(where.sinceAt, nowMs);
    return whereView('track', { name: 'Largou', progress: '', subText: 'aguardando 1ª leitura', counter: since === null ? '' : formatRaceTime(Math.floor(since)) });
  }
  if (where.kind === 'dnf') return whereView('dnf', { name: 'DNF', progress: '', subText: 'decisão do organizador', counter: '' });
  if (where.kind === 'finished') {
    return whereView('finished', { name: 'Chegada', progress: '', subText: row.penaltySeconds > 0 ? `inclui +${row.penaltySeconds} s` : 'tempo final', counter: '' });
  }
  if (where.kind === 'station') {
    const progress = where.progress;
    let progressText = '';
    let subText = 'na estação';
    let counter = '';
    if (progress.type === 'units') progressText = `${Math.min(progress.done, progress.target)}/${progress.target}`;
    else if (progress.type === 'reps') progressText = String(progress.done);
    else {
      const elapsed = where.waiting ? null : raceSecondsSince(where.startedAt, nowMs);
      if (elapsed !== null) counter = formatRaceTime(Math.floor(elapsed));
    }
    if (where.stationId === closingStationId) { subText = 'reta final'; counter = ''; }
    if (where.waiting) { subText = 'aguardando início'; counter = ''; }
    return whereView('station', { name: where.stationName, progress: progressText, subText, counter });
  }
  if (where.closedWithoutTime) return whereView('stalled', { name: 'Sem tempo fechado', progress: '', subText: 'aguardando o organizador', counter: '' });
  const since = raceSecondsSince(where.sinceAt, nowMs);
  return whereView('track', {
    name: 'Na pista',
    progress: '',
    subText: where.afterStationName ? `após ${where.afterStationName}` : 'desde a largada',
    counter: since === null ? '' : formatRaceTime(Math.floor(since))
  });
};

export type RaceGapView = {
  tone: 'lead' | 'gap' | 'ahead' | 'final' | 'none';
  text: string;
  sub: string;
  penalty: string | null;
  /** A diferença anda com o relógio ("contando"). */
  counting: boolean;
};

const NO_GAP = { tone: 'none' as const, text: '–', sub: '', counting: false };

/**
 * "Dif." (AC5 da 1.113). Torre de uma onda: "LÍDER"; "+m:ss" no mesmo ponto; o tempo final com
 * "+m:ss" (ou "líder") para quem fechou; "–" sem diferença e no DNF. Torre da categoria (ranking
 * único, 1.116): a diferença para o 1º com sinal e o ponto embaixo ("+0:44" · "saída Sled Pull"),
 * "contando" quando o relógio do atleta já passou do tempo do 1º num ponto que ele não alcançou
 * (conta com a hora do servidor), o ponto e o tempo de prova do líder e "–" para quem não tem posição.
 * A penalidade vigente de quem ainda corre sai só em segundos ("+15 s"), nunca o motivo (D2).
 */
export const describeRaceGap = (row: RaceBoardRow, options: { scope?: 'division' | 'wave'; nowMs?: number } = {}): RaceGapView => {
  const division = options.scope === 'division';
  if (row.status === 'dnf') return { ...NO_GAP, penalty: null };
  if (row.status === 'finished') {
    const sub = row.isLeader
      ? 'líder'
      : row.gapSeconds === null ? '' : division ? [formatRaceSignedGap(row.gapSeconds), racePointText(row.gapPoint)].filter(Boolean).join(' · ') : `+${formatRaceTime(row.gapSeconds)}`;
    return { tone: 'final', text: row.finalSeconds === null ? '–' : formatRaceTime(row.finalSeconds), sub, penalty: null, counting: false };
  }
  const penalty = row.penaltySeconds > 0 ? `+${row.penaltySeconds} s` : null;
  if (!division) {
    if (row.isLeader) return { tone: 'lead', text: 'LÍDER', sub: '', penalty, counting: false };
    if (row.gapSeconds === null) return { ...NO_GAP, penalty };
    return { tone: 'gap', text: `+${formatRaceTime(row.gapSeconds)}`, sub: '', penalty, counting: false };
  }
  if (row.position === null) return { ...NO_GAP, penalty };
  if (row.isLeader) {
    const at = row.lastPointRef && row.pointSeconds !== null ? `${racePointText(row.lastPointRef)} · ${formatRaceTime(row.pointSeconds)}` : '';
    return { tone: 'lead', text: 'LÍDER', sub: at, penalty, counting: false };
  }
  if (row.gapCounting && row.gapBaseSeconds !== null) {
    const clock = raceAthleteClock(row, options.nowMs ?? 0);
    if (clock === null) return { ...NO_GAP, penalty };
    return { tone: 'gap', text: `+${formatRaceTime(Math.max(0, clock - row.gapBaseSeconds))}`, sub: `${racePointText(row.gapPoint)} · contando`, penalty, counting: true };
  }
  if (row.gapSeconds === null) return { ...NO_GAP, penalty };
  return { tone: Math.round(row.gapSeconds) < 0 ? 'ahead' : 'gap', text: formatRaceSignedGap(row.gapSeconds), sub: racePointText(row.gapPoint), penalty, counting: false };
};

/** Posição da torre: o número, ou "–" no DNF. */
export const raceRowPosition = (row: RaceBoardRow) => (row.position === null ? '–' : String(row.position));

// ---------------------------------------------------------------------------
// Seta de variação de posição (AC4)
// ---------------------------------------------------------------------------

export type RankArrow = { dir: 'up' | 'down'; until: number };

/**
 * Setas da torre: quem ganhou ou perdeu posição entre as duas últimas ordens leva a
 * seta por 5 s; as ainda vivas continuam. Nunca na primeira carga (sem ordem
 * anterior) e nunca quando alguém entra ou sai da ordem (um DNF faria todos os
 * de trás parecerem ter subido). A comparação é da tela, não do payload, para a
 * `version` não mudar sem dado novo.
 */
export const nextRankArrows = (
  current: ReadonlyMap<string, RankArrow>,
  previousOrder: readonly string[] | null,
  order: readonly string[],
  nowMs: number
): Map<string, RankArrow> => {
  const next = new Map<string, RankArrow>();
  for (const [key, arrow] of current) if (arrow.until > nowMs && order.includes(key)) next.set(key, arrow);
  if (previousOrder === null || previousOrder.length !== order.length) return next;
  const before = new Map(previousOrder.map((key, index) => [key, index]));
  if (!order.every((key) => before.has(key))) return next;
  order.forEach((key, index) => {
    const was = before.get(key) as number;
    if (was !== index) next.set(key, { dir: index < was ? 'up' : 'down', until: nowMs + RACE_ARROW_MS });
  });
  return next;
};

/** A ordem que a seta compara: os atletas que têm posição (o DNF e quem ainda não tem leitura na torre da categoria saem da ordem). */
export const raceRankOrder = (rows: readonly RaceBoardRow[]) => rows.filter((row) => row.status !== 'dnf' && row.position !== null).map((row) => row.athleteKey);

// ---------------------------------------------------------------------------
// Cartões
// ---------------------------------------------------------------------------

const rowByKey = (board: RaceLiveBoardView, key: string) => board.rows.find((row) => row.athleteKey === key);

export type RaceCardA =
  | {
    kind: 'battle';
    eyebrow: string;
    /** Os dois são de ondas diferentes (selo "entre ondas"). */
    crossWave: boolean;
    ahead: { position: number | null; name: string; box: string };
    back: { position: number | null; name: string; box: string };
    interval: string;
    trend: string;
  }
  | { kind: 'waiting'; eyebrow: string; title: string; detail: string; at: string; note: string }
  | { kind: 'leader'; eyebrow: string; name: string; box: string; at: string; advantage: { label: string; value: string; known: boolean } };

const sinceText = (since: { stationName: string; side: 'in' | 'out' } | null) => (
  since ? `desde ${since.side === 'in' ? 'a entrada do' : 'a saída do'} ${since.stationName}` : ''
);

/** "Onda 2 · CT Meireles" na torre da categoria; só o box na torre de uma onda. */
const whoLine = (board: Pick<RaceLiveBoardView, 'scope'>, row: Pick<RaceBoardRow, 'waveTitle' | 'box'>) => (
  board.scope === 'division' ? [row.waveTitle, row.box].filter(Boolean).join(' · ') : row.box
);

/**
 * Cartão A, por prioridade (AC7 da 1.113): a disputa do motor; a torre ainda sem nenhuma leitura; o
 * líder. Na torre da categoria a disputa pode ser entre ondas e diz o ponto comparado. O roxo (1.114)
 * e o novo líder (1.118) entram por cima dele em `raceBroadcastMoments.ts`.
 */
export const describeRaceCardA = (board: RaceLiveBoardView, wave: RaceLiveWaveView | null, nowMs: number): RaceCardA | null => {
  const division = board.scope === 'division';
  const battle = board.battle;
  if (battle) {
    const ahead = rowByKey(board, battle.aheadKey);
    const back = rowByKey(board, battle.backKey);
    if (ahead && back) {
      const since = sinceText(battle.since);
      const trend = battle.trend === 'closing' && battle.trendSeconds !== null
        ? `caiu ${formatRaceTime(battle.trendSeconds)} ${since}`
        : battle.trend === 'widening' && battle.trendSeconds !== null
          ? `subiu ${formatRaceTime(battle.trendSeconds)} ${since}`
          : battle.trend === 'steady' ? `estável ${since}` : '';
      return {
        kind: 'battle',
        eyebrow: `Disputa pelo ${battle.position}º lugar`,
        crossWave: division && battle.crossWave,
        ahead: { position: ahead.position, name: ahead.name, box: whoLine(board, ahead) },
        back: { position: back.position, name: back.name, box: whoLine(board, back) },
        interval: formatRaceTime(battle.intervalSeconds),
        trend: [division && battle.point ? `na ${racePointText(battle.point)}` : '', trend.trim()].filter(Boolean).join(' · ')
      };
    }
  }
  if (board.rows.length === 0) return null;
  if (!board.hasLeaderReading) {
    if (division || !wave) {
      return {
        kind: 'waiting',
        eyebrow: `${board.divisionName} · ranking da prova`,
        title: 'Ranking em formação',
        detail: 'Quem largou entra no ranking na primeira leitura de um judge',
        at: 'Aguardando a primeira leitura de um judge',
        note: ''
      };
    }
    return {
      kind: 'waiting',
      eyebrow: `${wave.title} na pista`,
      title: `Largou às ${wave.startedClock}`,
      detail: 'Ordem do cronograma até a primeira leitura',
      at: 'Aguardando a primeira leitura de um judge',
      note: ''
    };
  }
  const leader = board.rows.find((row) => row.isLeader);
  if (!leader) return null;
  const second = board.rows.find((row) => row.status !== 'dnf' && !row.isLeader && row.position !== null);
  const where = describeRaceWhere(leader, raceClosingStationId(board), nowMs);
  const secondGap = second ? describeRaceGap(second, { scope: board.scope, nowMs }) : null;
  const known = Boolean(secondGap && (secondGap.tone === 'gap' || secondGap.tone === 'ahead' || secondGap.tone === 'final'));
  return {
    kind: 'leader',
    eyebrow: division ? 'Líder da prova' : 'Líder da onda',
    name: leader.name,
    box: whoLine(board, leader),
    at: `${where.main} · ${where.sub}`,
    advantage: known && secondGap
      ? { label: 'Vantagem para o 2º', value: division && secondGap.tone === 'final' ? secondGap.sub.split(' · ')[0] || secondGap.text : secondGap.text, known: true }
      : { label: 'Vantagem para o 2º', value: 'aguardando leitura', known: false }
  };
};

/** A estação que fecha o tempo da categoria no ar (D34). */
export const raceClosingStationId = (board: Pick<RaceLiveBoardView, 'stages'>) => board.stages.find((stage) => stage.closesTime)?.id ?? null;

export type RaceFinalistView = {
  key: string;
  position: number | null;
  name: string;
  box: string;
  /** Selo da onda ("O3") na torre da categoria; vazio na torre de uma onda. */
  wave: string;
  /** O número grande: reps, trechos ou voltas feitos; o tempo na estação (ergômetro, genérica, sem meta); "–" aguardando início. */
  value: string;
  /** "/100" ou "/4" depois do número; vazio sem meta. */
  of: string;
  /** Preenchimento da barra de 0 a 1; null sem barra. */
  fraction: number | null;
  caption: string;
  /**
   * Torre da categoria: o tempo a bater, o tempo final de quem já chegou e ainda pode ser superado pelo
   * relógio do atleta ("Passa Rafael Tavares se fechar antes de 1:11:32"). Null sem ninguém a passar.
   */
  target: { name: string; time: string } | null;
};

export type RaceWaveLine = { key: string; title: string; clock: string; detail: string };

export type RaceCardB =
  | { kind: 'finalists'; eyebrow: string; items: RaceFinalistView[] }
  | { kind: 'next'; eyebrow: string; title: string; time: string; detail: string }
  | { kind: 'waves'; eyebrow: string; items: RaceWaveLine[] };

/** O tempo a bater: entre quem já fechou, o menor tempo final que ainda é maior que o relógio do atleta. */
const targetOf = (board: RaceLiveBoardView, clock: number | null): RaceFinalistView['target'] => {
  if (clock === null) return null;
  const beatable = board.rows
    .filter((row) => row.status === 'finished' && row.finalSeconds !== null && row.finalSeconds > clock)
    .sort((a, b) => (a.finalSeconds as number) - (b.finalSeconds as number))[0];
  return beatable ? { name: beatable.name, time: formatRaceTime(beatable.finalSeconds as number) } : null;
};

/**
 * Cartão B (AC7 da 1.113): "Reta final" com até 3 atletas da última estação do percurso (D34), com o
 * progresso pelo tipo da estação e, na torre da categoria, o tempo a bater; senão "Próxima largada";
 * sem próxima onda, na torre da categoria, "Ondas na pista" (relógio, quantos correm e quantos chegaram).
 */
export const describeRaceCardB = (board: RaceLiveBoardView, next: RaceWaveBrief | null, nowMs: number, waves: readonly RaceLiveWaveView[] = []): RaceCardB => {
  const division = board.scope === 'division';
  if (board.finalists.length > 0) {
    return {
      kind: 'finalists',
      eyebrow: `Reta final · ${board.finalists[0].stationName}`,
      items: board.finalists.map((finalist): RaceFinalistView => {
        const clock = division ? raceAthleteClock({ startedAt: finalist.raceStartedAt, penaltySeconds: finalist.penaltySeconds }, nowMs) : null;
        const base = {
          key: finalist.athleteKey,
          position: finalist.position,
          name: finalist.name,
          box: finalist.box,
          wave: division ? raceWaveTag(finalist.waveNumber) : '',
          target: division ? targetOf(board, clock) : null
        };
        if (finalist.waiting) return { ...base, value: '–', of: '', fraction: null, caption: 'aguardando início' };
        const progress = finalist.progress;
        if (progress.type === 'reps') {
          return { ...base, value: String(progress.done), of: progress.target ? `/${progress.target}` : '', fraction: progress.target ? Math.min(1, progress.done / progress.target) : null, caption: '' };
        }
        if (progress.type === 'units') {
          return { ...base, value: String(Math.min(progress.done, progress.target)), of: `/${progress.target}`, fraction: Math.min(1, progress.done / progress.target), caption: progress.unit === 'trecho' ? 'trechos' : 'voltas' };
        }
        const elapsed = raceSecondsSince(finalist.startedAt, nowMs);
        return { ...base, value: elapsed === null ? '–' : formatRaceTime(Math.floor(elapsed)), of: '', fraction: null, caption: 'na estação' };
      })
    };
  }
  if (next) {
    const people = `${next.athleteCount} ${next.athleteCount === 1 ? 'atleta' : 'atletas'}`;
    return {
      kind: 'next',
      eyebrow: 'Próxima largada',
      title: next.title,
      time: next.time ? `${next.time} prevista` : '',
      detail: [next.divisionNames.join(' e '), people].filter(Boolean).join(' · ')
    };
  }
  if (division && waves.length > 0) {
    const items = [...waves]
      .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
      .slice(-3)
      .map((wave): RaceWaveLine => {
        const rows = board.rows.filter((row) => row.waveKey === wave.key);
        const racing = rows.filter((row) => row.status === 'racing').length;
        const finished = rows.filter((row) => row.status === 'finished').length;
        const elapsed = raceSecondsSince(wave.startedAt, nowMs);
        return {
          key: wave.key,
          title: wave.title,
          clock: racing > 0 && elapsed !== null ? formatRaceRunningClock(elapsed) : 'fim',
          detail: `${racing} correndo · ${finished} ${finished === 1 ? 'chegou' : 'chegaram'}`
        };
      });
    return { kind: 'waves', eyebrow: 'Ondas na pista', items };
  }
  return { kind: 'next', eyebrow: 'Próxima largada', title: 'Sem próxima onda', time: '', detail: 'Todas as ondas do cronograma já largaram' };
};

// ---------------------------------------------------------------------------
// Faixa da direção de prova e aviso de silêncio
// ---------------------------------------------------------------------------

/**
 * O último evento da torre no ar: na torre de uma onda, o da onda (a largada é o primeiro, então a faixa
 * nunca fica vazia ao vivo); na torre da categoria, o da categoria (a largada vale para as categorias da onda).
 */
export const raceLastTickerEvent = (live: Pick<RaceLivePayload, 'ticker'>, board: Pick<RaceLiveBoardView, 'scope' | 'waveKey' | 'divisionKey'>): RaceTickerEvent | null => (
  [...live.ticker].reverse().find((event) => (
    board.scope === 'division' ? (event.divisionKeys ?? []).includes(board.divisionKey) : event.waveKey === board.waveKey
  )) ?? null
);

/** Texto da faixa; a hora do dia vem no fuso do evento. Nunca o motivo da penalidade (D2). */
export const describeRaceTicker = (event: RaceTickerEvent): { clock: string | null; text: string } => {
  if (event.kind === 'start') return { clock: null, text: `LARGADA · ${event.waveTitle} · ${event.clock}` };
  if (event.kind === 'enter') {
    const who = `${event.name ?? 'Atleta'}${event.waveTitle ? ` (${event.waveTitle})` : ''}${event.position ? ` em ${event.position}º` : ''}`;
    return { clock: event.clock, text: ['ENTRA NO RANKING', who, racePointText(event.point)].filter(Boolean).join(' · ') };
  }
  if (event.kind === 'penalty') {
    return { clock: event.clock, text: ['PENALIDADE', `+${event.seconds ?? 0} s`, event.name, event.stationName].filter(Boolean).join(' · ') };
  }
  if (event.kind === 'dnf') return { clock: event.clock, text: `DNF · ${event.name ?? 'Atleta'} · decisão do organizador` };
  return { clock: event.clock, text: `CHEGADA · ${event.name ?? 'Atleta'} · ${event.finalSeconds === null ? '–' : formatRaceTime(event.finalSeconds)}` };
};

/**
 * Aviso do rodapé quando passam 10 min sem leitura (regra do motor): a tela não sai do ar por isso.
 * Na torre da categoria vale a leitura mais nova entre as ondas dela na pista. N sai da hora do
 * servidor e do instante da última leitura (ou da largada, se nunca houve leitura).
 */
export const raceSilenceNotice = (wave: Pick<RaceLiveWaveView, 'lastReadingAt'> | readonly Pick<RaceLiveWaveView, 'lastReadingAt'>[], nowMs: number): string | null => {
  const list = Array.isArray(wave) ? wave : [wave as Pick<RaceLiveWaveView, 'lastReadingAt'>];
  const latest = list.map((item) => item.lastReadingAt).filter((iso): iso is string => Boolean(iso)).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
  const quiet = raceQuietMs(latest, nowMs);
  return quiet === null ? null : `Sem leitura há ${Math.floor(quiet / 60_000)} min`;
};

// ---------------------------------------------------------------------------
// Mapa do percurso
// ---------------------------------------------------------------------------

/** Caixa de desenho do mapa (viewBox) e o trajeto em S: reta de cima, semicírculo à direita, reta de baixo. */
export const RACE_MAP = { width: 1040, height: 384, x0: 112, x1: 900, y1: 120, y2: 262 } as const;

export type RaceMapSlot = { index: number; x: number; y: number; part: 'top' | 'curve' | 'bottom' };

export type RaceMapLayout = {
  width: number;
  height: number;
  x0: number;
  x1: number;
  y1: number;
  y2: number;
  radius: number;
  trackPath: string;
  slotLength: number;
  slots: RaceMapSlot[];
  cardWidth: number;
  cardHeight: number;
};

/** O trajeto com uma casa por etapa, na ordem do percurso; escala sozinho para qualquer número de etapas. */
export const raceMapLayout = (stageCount: number): RaceMapLayout => {
  const { width, height, x0, x1, y1, y2 } = RACE_MAP;
  const radius = (y2 - y1) / 2;
  const centerY = (y1 + y2) / 2;
  const straight = x1 - x0;
  const curve = Math.PI * radius;
  const total = straight * 2 + curve;
  const count = Math.max(1, stageCount);
  const slotLength = total / count;
  const pointAt = (distance: number): Omit<RaceMapSlot, 'index'> => {
    if (distance <= straight) return { x: x0 + distance, y: y1, part: 'top' };
    if (distance <= straight + curve) {
      const angle = -Math.PI / 2 + (distance - straight) / radius;
      return { x: x1 + radius * Math.cos(angle), y: centerY + radius * Math.sin(angle), part: 'curve' };
    }
    return { x: x1 - (distance - straight - curve), y: y2, part: 'bottom' };
  };
  return {
    width,
    height,
    x0,
    x1,
    y1,
    y2,
    radius,
    trackPath: `M ${x0} ${y1} H ${x1} A ${radius} ${radius} 0 0 1 ${x1} ${y2} H ${x0}`,
    slotLength,
    slots: Array.from({ length: count }, (_, index) => ({ index, ...pointAt((index + 0.5) * slotLength) })),
    cardWidth: Math.max(56, Math.min(104, slotLength - 10)),
    cardHeight: 54
  };
};

/** Nome da etapa em até duas linhas que cabem na caixa; o que passar vira reticências. O nome vai inteiro, sem apelido. */
export const raceStageLines = (name: string, maxChars: number): string[] => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const limit = Math.max(3, maxChars);
  const clip = (line: string) => (line.length > limit ? `${line.slice(0, limit - 1).trimEnd()}…` : line);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || candidate.length <= limit) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  if (lines.length <= 2) return lines.map(clip);
  return [clip(lines[0]), clip(lines.slice(1).join(' '))];
};

/** Rótulo curto da corrida no mapa: "C1" para "Corrida 1" ou "Run 1"; sem número, a ordem da corrida. */
export const raceRunLabel = (stage: Pick<RaceStageView, 'name'>, runOrder: number) => {
  const match = stage.name.match(/(\d+)\s*$/);
  return `C${match ? match[1] : runOrder + 1}`;
};

export type RaceMarker = { key: string; slot: number; position: number | null; estimated: boolean; leader: boolean; purple: boolean };

/**
 * Marcadores do mapa: quem ainda corre (quem chegou ou foi DNF sai do mapa), na ordem da torre.
 * `purpleKeys` são os atletas com roxo em curso (Story 1.114); o líder continua em amarelo.
 */
export const raceBoardMarkers = (board: Pick<RaceLiveBoardView, 'rows'>, purpleKeys: ReadonlySet<string> = new Set()): RaceMarker[] => board.rows
  .filter((row) => row.status === 'racing' && row.slot !== null)
  .map((row) => ({
    key: row.athleteKey,
    slot: row.slot as number,
    position: row.position,
    estimated: row.slotEstimated,
    leader: row.isLeader,
    purple: purpleKeys.has(row.athleteKey)
  }));

export const raceFinishedCount = (board: Pick<RaceLiveBoardView, 'rows'>) => board.rows.filter((row) => row.status === 'finished').length;

export type RaceMarkerPlace = { key: string; x: number; y: number; radius: number };

/**
 * Grade de marcadores que cabe no espaço: `across` é o espaço ao longo da casa (sem invadir a vizinha) e
 * `room` o espaço para as linhas empilhadas. Começa no tamanho normal (38 de passo, raio 18) e encolhe até
 * caber; se nem o mínimo couber (onda enorme na mesma estação), fica no mínimo.
 */
const fitMarkers = (count: number, across: number, room: number) => {
  for (let gap = 38; gap >= 14; gap -= 2) {
    const cols = Math.max(1, Math.round(across / gap));
    if (Math.ceil(count / cols) * gap <= room) return { cols, gap, radius: Math.max(6, gap / 2 - 1) };
  }
  return { cols: Math.max(1, Math.round(across / 14)), gap: 14, radius: 6 };
};

/**
 * Posição de cada marcador: na casa da etapa, acima da reta de cima, abaixo da reta de baixo e à esquerda
 * da curva, em grade, sem cobrir uns aos outros nem os da casa vizinha. Casa lotada (onda grande, ou todos
 * na largada) usa marcadores menores, para ficar dentro do desenho.
 */
export const placeRaceMarkers = (layout: RaceMapLayout, markers: readonly RaceMarker[]): RaceMarkerPlace[] => {
  const bySlot = new Map<number, RaceMarker[]>();
  for (const marker of markers) bySlot.set(marker.slot, [...(bySlot.get(marker.slot) ?? []), marker]);
  const places: RaceMarkerPlace[] = [];
  const verticalRoom = 78;
  const horizontalRoom = 104;
  for (const [slotIndex, group] of bySlot) {
    const slot = layout.slots[Math.min(layout.slots.length - 1, Math.max(0, slotIndex))];
    const count = group.length;
    const onCurve = slot.part === 'curve';
    // Na reta, as colunas ficam dentro da largura da casa e as linhas empilham para fora; na curva, é o contrário.
    const { cols, gap, radius } = onCurve
      ? fitMarkers(count, horizontalRoom, layout.slotLength)
      : fitMarkers(count, layout.slotLength, verticalRoom);
    const lines = Math.ceil(count / cols);
    const offset = layout.cardHeight / 2 + radius + 7;
    group.forEach((marker, index) => {
      const col = index % cols;
      const line = Math.floor(index / cols);
      let x: number;
      let y: number;
      if (onCurve) {
        x = slot.x - layout.cardWidth / 2 - radius - 12 - col * gap;
        y = slot.y + (line - (lines - 1) / 2) * gap;
      } else {
        x = slot.x + (col - (cols - 1) / 2) * gap;
        y = slot.part === 'top' ? slot.y - offset - line * gap : slot.y + offset + line * gap;
      }
      places.push({ key: marker.key, x, y, radius });
    });
  }
  return places;
};
