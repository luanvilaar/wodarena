import { resolveRaceWaveAssignments, type RaceAssignmentRow } from '@/lib/raceAssignments';
import type { RaceStationKind } from '@/lib/raceRules';
import {
  RACE_JUDGE_MAX_ACTIVE,
  RACE_JUDGE_MAX_ACTIVE_SOLO,
  RACE_STATION_KIND_LABELS,
  isRaceAttemptActive,
  isSoloRaceStation,
  raceJudgeCapacity,
  stationUnitNoun,
  stationUsesCounter,
  type RaceJudgeCard
} from '@/lib/raceStation';
import { formatRaceClock } from '@/lib/raceWaves';

// Painel de cobertura ao vivo do Fitness Race (Story 1.105; D3, D31, D32,
// D35, D39, D40, D41 em docs/design/fitness-race-sumula/DECISOES.md; textos da
// maquete aprovada telas/cobertura.html, D42). Puro: sem React, sem Supabase e
// sem fetch. O servidor (serverRaceCoverage.ts) junta a escala efetiva de cada
// onda (Story 1.104), as tentativas abertas (Story 1.103) e o percurso de cada
// categoria, e esta função devolve, por onda e por estação, os judges, os
// cartões abertos, a estimativa de atletas esperando e os avisos.
//
// Tudo aqui só avisa (D3): nada bloqueia gravação, abertura de cartão ou
// largada. Evento sem nenhuma escala não tem aviso nenhum, nem estimativa, nem
// selo "Coberta"/"Atenção" (D40): fica o resumo do que os judges já abriram.
// O judge que abriu cartão sem estar na escala efetiva aparece marcado
// `outside` (D41); não é aviso e não conta em "Judges lotados".

/** Intervalo da atualização do painel com a aba visível (AC5). */
export const RACE_COVERAGE_REFRESH_MS = 15_000;

/** Estação de uma categoria, na ordem do percurso, só `type: 'station'`. */
export type RaceCoverageStage = {
  stationId: string;
  key: string;
  name: string;
  kind: RaceStationKind;
  /** Meta para o rótulo do tipo ("4 trechos", "100 reps"). */
  meta: string;
  /** Última estação do percurso: fecha o tempo e é de 1 atleta por judge (D34, D39). */
  closesTime: boolean;
};

export type RaceCoverageWaveInput = {
  id: string;
  title: string;
  date: string;
  time: string;
  startedAt: string | null;
  categories: string[];
  /** Categorias dos atletas da onda, na ordem em que aparecem. */
  divisionIds: string[];
};

export type RaceCoverageRunInput = {
  id: string;
  athleteId: string;
  athleteName: string;
  divisionId: string | null;
  divisionName: string;
  heatId: string | null;
  status: string;
  /** Percurso da categoria no regulamento da corrida (só estações, em ordem). */
  stages: RaceCoverageStage[];
};

export type RaceCoverageAttemptInput = {
  id: string;
  runId: string;
  stationId: string;
  stationKind: RaceStationKind;
  judgeUserId: string | null;
  judgeName: string;
  status: string;
  progress: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type RaceCoverageInput = {
  timeZone?: string;
  waves: RaceCoverageWaveInput[];
  /** Percurso atual de cada categoria (só estações, em ordem), para a lista de estações da onda. */
  courses: Record<string, RaceCoverageStage[]>;
  divisionNames: Record<string, string>;
  runs: RaceCoverageRunInput[];
  attempts: RaceCoverageAttemptInput[];
  /** Linhas da escala já filtradas (judge ainda no evento, onda do cronograma). Vazio = evento sem escala. */
  assignments: RaceAssignmentRow[];
  /** Judges do evento (id e nome, sem e-mail). */
  judges: { id: string; name: string }[];
};

export type RaceCoverageJudgeState = 'scheduled' | 'free' | 'full' | 'over' | 'neutral';

export type RaceCoverageJudge = {
  judgeUserId: string;
  name: string;
  /** Na escala efetiva da onda para esta estação. */
  scheduled: boolean;
  /** Abriu cartão na estação sem estar na escala efetiva (D41). Sem escala, todos estão fora. */
  outside: boolean;
  /** Cartões ativos do judge no evento, de qualquer onda (o limite da 1.103 é por pessoa); sem escala, os desta estação. */
  active: number;
  /** 2, ou 1 na estação de 1 atleta (D32, D39). */
  limit: number;
  state: RaceCoverageJudgeState;
  label: string;
};

export type RaceCoverageCard = {
  attemptId: string;
  athleteName: string;
  divisionName: string;
  status: string;
  judgeUserId: string | null;
  judgeName: string;
  progress: string;
  /** HH:MM em que o cartão ficou sem judge (solto ou liberado pelo gestor). */
  looseSince: string | null;
};

export type RaceCoverageAlertKind = 'athletes_without_judge' | 'judges_full' | 'card_without_judge' | 'judge_over_limit' | 'no_judge_scheduled';

/** Ordem dos avisos na tela (maquete aprovada). */
export const RACE_COVERAGE_ALERT_ORDER: readonly RaceCoverageAlertKind[] = [
  'athletes_without_judge',
  'judges_full',
  'card_without_judge',
  'judge_over_limit',
  'no_judge_scheduled'
];

export const RACE_COVERAGE_ALERT_LABELS: Record<RaceCoverageAlertKind, string> = {
  athletes_without_judge: 'Atletas sem judge',
  judges_full: 'Judges lotados',
  card_without_judge: 'Cartão sem judge',
  judge_over_limit: 'Judge acima do limite',
  no_judge_scheduled: 'Sem judge escalado'
};

export type RaceCoverageAlert = {
  kind: RaceCoverageAlertKind;
  label: string;
  stationKey: string;
  stationName: string;
  text: string;
  hint: string;
  /** "Abrir a escala da onda" acompanha o aviso; "Ver a estação" vale para todos. */
  openAssignments: boolean;
};

export type RaceCoverageStationStatus = 'covered' | 'attention' | 'no_schedule';

export type RaceCoverageStation = {
  key: string;
  name: string;
  kind: RaceStationKind;
  kindLabel: string;
  meta: string;
  order: number;
  solo: boolean;
  limit: number;
  /** Categorias da onda que têm a estação, quando nem todas têm (percurso por categoria, D33). */
  onlyIn: string[];
  judges: RaceCoverageJudge[];
  cards: RaceCoverageCard[];
  /** Estimativa de atletas esperando (AC3). null sem escala (D40) ou antes da largada. */
  waiting: number | null;
  status: RaceCoverageStationStatus;
  alerts: RaceCoverageAlertKind[];
};

export type RaceCoverageSummary = {
  stations: number;
  covered: number;
  judgesScheduled: number;
  judgesFull: number;
  outside: number;
  cards: number;
  looseCards: number;
  waiting: number | null;
  judgesWithCard: number;
  stationsWithCard: number;
};

export type RaceCoverageWave = {
  id: string;
  title: string;
  date: string;
  time: string;
  startedAt: string | null;
  inProgress: boolean;
  categories: string[];
  /** De onde vem a escala da onda: própria ou padrão do evento. null sem escala. */
  source: 'wave' | 'default' | null;
  stations: RaceCoverageStation[];
  alerts: RaceCoverageAlert[];
  summary: RaceCoverageSummary;
};

export type RaceCoverage = {
  hasAssignments: boolean;
  waves: RaceCoverageWave[];
  /** Onda que o filtro abre: a em andamento (a que largou por último), senão a próxima a largar, senão a última. */
  defaultWaveId: string | null;
};

// ---------------------------------------------------------------------------
// Textos (maquete aprovada telas/cobertura.html, D42)
// ---------------------------------------------------------------------------

export const RACE_COVERAGE_NO_SCHEDULE_GUIDE = 'Este evento ainda não tem escala de judges. Sem escala, o painel não dá avisos de cobertura: abaixo fica só o que os judges já abriram, e quem abriu cartão está fora da escala. Monte a escala para ver a cobertura de cada onda.';
export const RACE_COVERAGE_ONLY_WARNS = 'Só avisa: nada aqui bloqueia a súmula, a abertura de cartões ou a largada. A escala orienta; um judge fora dela ainda abre a estação em que estiver.';
export const RACE_COVERAGE_PREP_NOTICE = 'A onda ainda não largou: confira a escala antes da largada. Atletas esperando e cartões aparecem depois da largada.';
export const RACE_COVERAGE_ESTIMATE_NOTE = 'O atleta conta como esperando a estação seguinte à última em que teve cartão encerrado; sem cartão nenhum, espera a primeira. Quem está com cartão aberto está na estação, não esperando. Quem passou por uma estação sem judge só volta a aparecer na próxima estação com cartão, por isso o número é aproximado. O "n de 2" do judge conta todos os cartões abertos dele, de qualquer onda (na estação de 1 atleta, "n de 1"). Judge que abriu cartão sem estar na escala aparece com o selo "Fora da escala": é informação, não aviso.';
export const RACE_COVERAGE_NO_SCHEDULE_NOTE = 'Sem escala, o painel não estima atletas esperando nem dá avisos. A lista de cada estação mostra quem abriu cartão nela, com quantos cartões. Quando a escala existir, quem abrir cartão sem estar nela aparece com o selo "Fora da escala".';

/** "Falha ao atualizar" (maquete): o último dado fica na tela. */
export const describeRaceCoverageFailure = (lastClock: string | null) => ({
  title: 'Não foi possível atualizar a cobertura.',
  detail: lastClock ? `Mostrando a leitura das ${lastClock}. Nova tentativa em 15 s.` : 'Nova tentativa em 15 s.'
});

const waitingText = (count: number) => `cerca de ${count} ${count === 1 ? 'atleta esperando' : 'atletas esperando'}`;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const soloNote = (kind: RaceStationKind) => (kind === 'wall_ball' ? 'o Wall Ball é 1 atleta por judge' : 'esta estação é de 1 atleta por judge');

const SOLO_OVER_HINT = 'Peça ao judge que termine e libere um dos cartões. O cartão de 1 atleta não tem soltar nem dispensar: só o organizador libera a tentativa.';

type AlertContext = {
  waveTitle: string;
  station: { key: string; name: string; kind: RaceStationKind; limit: number };
  waiting?: number;
  scheduledCount?: number;
  athleteName?: string;
  since?: string | null;
  judgeName?: string;
  active?: number;
  /** Cartão de 1 atleta aberto junto de outro: a estação dele. */
  soloStation?: { name: string; kind: RaceStationKind } | null;
};

/** Texto de cada aviso (AC4): nomeia a onda, a estação e o que fazer. */
export const describeRaceCoverageAlert = (kind: RaceCoverageAlertKind, context: AlertContext): RaceCoverageAlert => {
  const { waveTitle, station } = context;
  const prefix = `${waveTitle} · ${station.name}:`;
  const base = { kind, label: RACE_COVERAGE_ALERT_LABELS[kind], stationKey: station.key, stationName: station.name };
  switch (kind) {
    case 'athletes_without_judge':
      return {
        ...base,
        text: `${prefix} ${waitingText(context.waiting ?? 0)}, sem judge escalado e sem cartão aberto.`,
        hint: 'Escale um judge nesta estação ou peça a um judge livre que abra a estação.',
        openAssignments: true
      };
    case 'judges_full': {
      const count = context.scheduledCount ?? 0;
      const who = count === 1 ? 'o judge escalado está' : `os ${count} judges escalados estão`;
      const solo = station.limit === RACE_JUDGE_MAX_ACTIVE_SOLO ? `: ${soloNote(station.kind)}` : '';
      return {
        ...base,
        text: `${prefix} ${waitingText(context.waiting ?? 0)} e ${who} no limite (${station.limit} de ${station.limit}${solo}).`,
        hint: 'Escale mais um judge nesta estação.',
        openAssignments: true
      };
    }
    case 'card_without_judge':
      return {
        ...base,
        text: `${prefix} o cartão de ${context.athleteName ?? 'um atleta'} está sem judge${context.since ? ` desde ${context.since}` : ''}. Os registros seguem guardados.`,
        hint: 'Peça a um judge da estação que assuma o cartão.',
        openAssignments: false
      };
    case 'judge_over_limit': {
      const judge = context.judgeName ?? 'O judge';
      const active = context.active ?? 0;
      const solo = context.soloStation ?? null;
      if (solo && active <= RACE_JUDGE_MAX_ACTIVE) {
        const open = solo.kind === 'wall_ball' ? 'o Wall Ball aberto' : `o cartão de ${solo.name} aberto`;
        const alone = solo.kind === 'wall_ball' ? 'o Wall Ball é conferido sozinho' : 'essa estação é de 1 atleta por judge';
        return { ...base, text: `${prefix} ${judge} está com ${open} junto de outro cartão; ${alone}.`, hint: SOLO_OVER_HINT, openAssignments: false };
      }
      return {
        ...base,
        text: `${prefix} ${judge} está com ${active} cartões abertos; o limite é ${RACE_JUDGE_MAX_ACTIVE}.`,
        hint: solo ? SOLO_OVER_HINT : 'Peça ao judge que libere, solte ou dispense um cartão.',
        openAssignments: false
      };
    }
    case 'no_judge_scheduled':
    default:
      return {
        ...base,
        text: `${prefix} nenhum judge na escala desta onda.`,
        hint: 'Sem judge, a estação fica sem registro e sem split. Escale alguém se quiser conferir esta estação.',
        openAssignments: true
      };
  }
};

// ---------------------------------------------------------------------------
// Cartões e judges
// ---------------------------------------------------------------------------

const ATTEMPT_STATE_LABELS: Record<string, string> = {
  waiting: 'aguardando início',
  running: 'em andamento',
  done_pending_release: 'pronto para liberar',
  redo: 'refazer'
};

const numberOr = (value: unknown, fallback: number | null) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/** Trechos, voltas ou reps do cartão e o estado ("2 de 4 trechos · em andamento"). */
export const describeRaceCoverageProgress = (kind: RaceStationKind, status: string, progress: Record<string, unknown> | null) => {
  const data = progress || {};
  let count = '';
  if (kind === 'wall_ball') {
    const valid = numberOr(data.validReps, 0) as number;
    const target = numberOr(data.targetReps, null);
    count = target !== null ? `${valid} de ${target} reps` : `${valid} reps`;
  } else if (stationUsesCounter(kind)) {
    const units = numberOr(data.units, 0) as number;
    const expected = numberOr(data.expectedUnits, null);
    count = expected !== null ? `${units} de ${expected} ${stationUnitNoun(kind, expected)}` : plural(units, stationUnitNoun(kind, 1), stationUnitNoun(kind, 2));
  }
  return [count, ATTEMPT_STATE_LABELS[status] ?? ''].filter(Boolean).join(' · ');
};

/** Judge acima do limite (AC4): mais de 2 cartões ativos ou cartão de 1 atleta junto de outro. */
export const isRaceJudgeOverLimit = (cards: readonly RaceJudgeCard[]) => (
  cards.length > RACE_JUDGE_MAX_ACTIVE || (cards.length > 1 && cards.some((card) => card.solo))
);

/** O judge não pega mais um cartão nesta estação (regra única da 1.103, raceJudgeCapacity). */
export const isRaceJudgeFullFor = (cards: readonly RaceJudgeCard[], station: { kind: RaceStationKind; solo: boolean }) => (
  !raceJudgeCapacity(cards, { attemptId: '__coverage__', stationKind: station.kind, solo: station.solo }).ok
);

const judgeLabel = (state: RaceCoverageJudgeState, active: number, limit: number) => {
  if (state === 'scheduled') return 'Escalado';
  if (state === 'neutral') return plural(active, 'cartão', 'cartões');
  const word = state === 'over' ? 'acima do limite' : state === 'full' ? 'no limite' : 'com vaga';
  return `${active} de ${limit} · ${word}`;
};

// ---------------------------------------------------------------------------
// Estimativa de atletas esperando (AC3)
// ---------------------------------------------------------------------------

/**
 * Estação que o atleta espera, pelo que a súmula sabe (AC3): a seguinte à
 * estação mais adiante, na ordem do percurso da categoria, que já tem
 * tentativa (aberta ou encerrada). Sem tentativa nenhuma, a primeira. Com a
 * tentativa mais adiante ainda aberta, o atleta está nela e não espera nada
 * (AUTO-DECISION da implementação: quem está com cartão aberto já tem judge).
 * Só corrida `racing`; `finished`, `dnf` e `cancelled` não esperam. null
 * quando não espera (ou passou da última estação).
 */
export const estimateRaceWaitingStationKey = (
  run: Pick<RaceCoverageRunInput, 'status' | 'stages'>,
  attempts: readonly Pick<RaceCoverageAttemptInput, 'stationId' | 'status'>[]
): string | null => {
  if (run.status !== 'racing' || run.stages.length === 0) return null;
  const tried = attempts.filter((attempt) => attempt.status !== 'cancelled');
  let furthest = -1;
  run.stages.forEach((stage, index) => {
    if (tried.some((attempt) => attempt.stationId === stage.stationId)) furthest = index;
  });
  if (furthest === -1) return run.stages[0].key;
  const at = tried.find((attempt) => attempt.stationId === run.stages[furthest].stationId);
  if (at && isRaceAttemptActive(at.status, run.status)) return null;
  return run.stages[furthest + 1]?.key ?? null;
};

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------

type WaveStation = Omit<RaceCoverageStation, 'judges' | 'cards' | 'waiting' | 'status' | 'alerts'> & { divisionIds: string[]; position: number };

/** Estações do percurso das categorias da onda, agrupadas pela chave (raceStationKey), na ordem do percurso. */
const waveStations = (wave: RaceCoverageWaveInput, input: RaceCoverageInput): WaveStation[] => {
  const byKey = new Map<string, WaveStation>();
  for (const divisionId of wave.divisionIds) {
    (input.courses[divisionId] ?? []).forEach((stage, position) => {
      const solo = isSoloRaceStation(stage.kind, stage.closesTime);
      const entry = byKey.get(stage.key) ?? {
        key: stage.key,
        name: stage.name,
        kind: stage.kind,
        kindLabel: RACE_STATION_KIND_LABELS[stage.kind],
        meta: stage.meta,
        order: 0,
        solo: false,
        limit: RACE_JUDGE_MAX_ACTIVE,
        onlyIn: [],
        divisionIds: [],
        position
      };
      entry.position = Math.min(entry.position, position);
      entry.solo = entry.solo || solo;
      entry.limit = entry.solo ? RACE_JUDGE_MAX_ACTIVE_SOLO : RACE_JUDGE_MAX_ACTIVE;
      if (!entry.divisionIds.includes(divisionId)) entry.divisionIds.push(divisionId);
      byKey.set(stage.key, entry);
    });
  }
  const total = wave.divisionIds.filter((id) => (input.courses[id] ?? []).length > 0).length;
  return [...byKey.values()]
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'pt-BR'))
    .map((entry, index) => ({
      ...entry,
      order: index + 1,
      onlyIn: entry.divisionIds.length < total ? entry.divisionIds.map((id) => input.divisionNames[id] ?? '').filter(Boolean) : []
    }));
};

/** Onda que o filtro abre (AC5). */
export const pickDefaultRaceCoverageWave = (waves: readonly Pick<RaceCoverageWave, 'id' | 'startedAt' | 'inProgress'>[]) => {
  const running = waves.filter((wave) => wave.inProgress && wave.startedAt).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  if (running[0]) return running[0].id;
  const next = waves.find((wave) => !wave.startedAt);
  if (next) return next.id;
  return waves.at(-1)?.id ?? null;
};

/**
 * Cobertura de todas as ondas (AC2 a AC6). Ver o comentário do topo; a
 * estimativa e os avisos só existem com escala (D40).
 */
export const buildRaceCoverage = (input: RaceCoverageInput): RaceCoverage => {
  const hasAssignments = input.assignments.length > 0;
  const judgeNames = new Map(input.judges.map((judge) => [judge.id, judge.name]));
  const runById = new Map(input.runs.map((run) => [run.id, run]));
  const stageOf = (run: RaceCoverageRunInput | undefined, stationId: string) => run?.stages.find((stage) => stage.stationId === stationId) ?? null;

  // Cartões ativos por judge no evento (o limite da 1.103 é por pessoa).
  const activeAttempts = input.attempts.filter((attempt) => isRaceAttemptActive(attempt.status, runById.get(attempt.runId)?.status));
  const cardsByJudge = new Map<string, (RaceJudgeCard & { stationName: string })[]>();
  for (const attempt of [...activeAttempts].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))) {
    if (!attempt.judgeUserId) continue;
    const stage = stageOf(runById.get(attempt.runId), attempt.stationId);
    const list = cardsByJudge.get(attempt.judgeUserId) ?? [];
    list.push({
      attemptId: attempt.id,
      stationKind: attempt.stationKind,
      solo: isSoloRaceStation(attempt.stationKind, Boolean(stage?.closesTime)),
      stationName: stage?.name ?? attempt.stationId
    });
    cardsByJudge.set(attempt.judgeUserId, list);
  }
  const cardsOf = (judgeId: string) => cardsByJudge.get(judgeId) ?? [];

  const waves = input.waves.map((wave): RaceCoverageWave => {
    const started = Boolean(wave.startedAt);
    const runs = input.runs.filter((run) => run.heatId === wave.id && run.status !== 'cancelled');
    const runIds = new Set(runs.map((run) => run.id));
    const inProgress = started && runs.some((run) => run.status === 'racing');
    const effective = hasAssignments ? resolveRaceWaveAssignments(input.assignments, wave.id) : null;

    // Cartões abertos da onda por estação (chave).
    const cardsByKey = new Map<string, RaceCoverageAttemptInput[]>();
    for (const attempt of activeAttempts) {
      if (!runIds.has(attempt.runId)) continue;
      const key = stageOf(runById.get(attempt.runId), attempt.stationId)?.key;
      if (!key) continue;
      cardsByKey.set(key, [...(cardsByKey.get(key) ?? []), attempt]);
    }

    // Estimativa de atletas esperando (AC3): só com escala e com a onda largada (D40).
    const waitingByKey = new Map<string, number>();
    if (hasAssignments && started) {
      for (const run of runs) {
        const key = estimateRaceWaitingStationKey(run, input.attempts.filter((attempt) => attempt.runId === run.id));
        if (key) waitingByKey.set(key, (waitingByKey.get(key) ?? 0) + 1);
      }
    }

    const alerts: RaceCoverageAlert[] = [];
    const stations = waveStations(wave, input).map((station): RaceCoverageStation => {
      const cardRows = [...(cardsByKey.get(station.key) ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      const cards: RaceCoverageCard[] = cardRows.map((attempt) => {
        const run = runById.get(attempt.runId);
        return {
          attemptId: attempt.id,
          athleteName: run?.athleteName ?? '',
          divisionName: run?.divisionName ?? '',
          status: attempt.status,
          judgeUserId: attempt.judgeUserId,
          judgeName: attempt.judgeUserId ? (judgeNames.get(attempt.judgeUserId) || attempt.judgeName || 'Judge') : '',
          progress: describeRaceCoverageProgress(attempt.stationKind, attempt.status, attempt.progress),
          looseSince: attempt.judgeUserId ? null : formatRaceClock(attempt.updatedAt, input.timeZone).slice(0, 5) || null
        };
      });
      const cardJudgeIds = [...new Set(cardRows.map((attempt) => attempt.judgeUserId).filter((id): id is string => Boolean(id)))];
      const scheduledIds = effective ? [...new Set(effective.pairs.filter((pair) => pair.stationKey === station.key).map((pair) => pair.judgeUserId))] : [];
      const nameOf = (judgeId: string) => judgeNames.get(judgeId) || cardRows.find((attempt) => attempt.judgeUserId === judgeId)?.judgeName || 'Judge';

      const judgeEntry = (judgeId: string, scheduled: boolean): RaceCoverageJudge => {
        if (!hasAssignments) {
          const active = cardRows.filter((attempt) => attempt.judgeUserId === judgeId).length;
          return { judgeUserId: judgeId, name: nameOf(judgeId), scheduled: false, outside: true, active, limit: station.limit, state: 'neutral', label: judgeLabel('neutral', active, station.limit) };
        }
        const own = cardsOf(judgeId);
        const state: RaceCoverageJudgeState = !started
          ? 'scheduled'
          : isRaceJudgeOverLimit(own) ? 'over' : isRaceJudgeFullFor(own, station) ? 'full' : 'free';
        return { judgeUserId: judgeId, name: nameOf(judgeId), scheduled, outside: !scheduled, active: own.length, limit: station.limit, state, label: judgeLabel(state, own.length, station.limit) };
      };
      const judges = hasAssignments
        ? [...scheduledIds.map((id) => judgeEntry(id, true)), ...cardJudgeIds.filter((id) => !scheduledIds.includes(id)).map((id) => judgeEntry(id, false))]
        : cardJudgeIds.map((id) => judgeEntry(id, false));

      const waiting = hasAssignments && started ? waitingByKey.get(station.key) ?? 0 : null;
      const kinds: RaceCoverageAlertKind[] = [];
      if (hasAssignments) {
        const context = { waveTitle: wave.title, station };
        const scheduled = judges.filter((judge) => judge.scheduled);
        const noJudge = scheduled.length === 0;
        const judgedCard = cards.some((card) => card.judgeUserId);
        if (started && (waiting ?? 0) > 0 && noJudge && !judgedCard) {
          alerts.push(describeRaceCoverageAlert('athletes_without_judge', { ...context, waiting: waiting ?? 0 }));
          kinds.push('athletes_without_judge');
        } else if (noJudge) {
          // Continua com só judge de fora da escala conferindo (AUTO-DECISION v1.2 da story).
          alerts.push(describeRaceCoverageAlert('no_judge_scheduled', context));
          kinds.push('no_judge_scheduled');
        }
        // Judge fora da escala não entra na conta de lotados (D41).
        if (started && (waiting ?? 0) > 0 && !noJudge && scheduled.every((judge) => judge.state === 'full' || judge.state === 'over')) {
          alerts.push(describeRaceCoverageAlert('judges_full', { ...context, waiting: waiting ?? 0, scheduledCount: scheduled.length }));
          kinds.push('judges_full');
        }
        for (const card of cards.filter((item) => !item.judgeUserId)) {
          alerts.push(describeRaceCoverageAlert('card_without_judge', { ...context, athleteName: card.athleteName, since: card.looseSince }));
          kinds.push('card_without_judge');
        }
        if (started) {
          for (const judge of judges.filter((item) => item.state === 'over')) {
            const own = cardsOf(judge.judgeUserId);
            const solo = own.find((card) => card.solo);
            alerts.push(describeRaceCoverageAlert('judge_over_limit', {
              ...context,
              judgeName: judge.name,
              active: own.length,
              soloStation: solo ? { name: solo.stationName, kind: solo.stationKind } : null
            }));
            kinds.push('judge_over_limit');
          }
        }
      }
      return {
        key: station.key,
        name: station.name,
        kind: station.kind,
        kindLabel: station.kindLabel,
        meta: station.meta,
        order: station.order,
        solo: station.solo,
        limit: station.limit,
        onlyIn: station.onlyIn,
        judges,
        cards,
        waiting,
        status: !hasAssignments ? 'no_schedule' : kinds.length > 0 ? 'attention' : 'covered',
        alerts: kinds
      };
    });

    alerts.sort((a, b) => RACE_COVERAGE_ALERT_ORDER.indexOf(a.kind) - RACE_COVERAGE_ALERT_ORDER.indexOf(b.kind));

    const scheduledJudges = new Set<string>();
    const fullJudges = new Set<string>();
    const outsideJudges = new Set<string>();
    const withCard = new Set<string>();
    for (const station of stations) {
      for (const judge of station.judges) {
        if (judge.scheduled) {
          scheduledJudges.add(judge.judgeUserId);
          if (judge.state === 'full' || judge.state === 'over') fullJudges.add(judge.judgeUserId);
        } else if (hasAssignments) {
          outsideJudges.add(judge.judgeUserId);
        }
      }
      for (const card of station.cards) if (card.judgeUserId) withCard.add(card.judgeUserId);
    }
    const cardsCount = stations.reduce((sum, station) => sum + station.cards.length, 0);

    return {
      id: wave.id,
      title: wave.title,
      date: wave.date,
      time: wave.time,
      startedAt: wave.startedAt,
      inProgress,
      categories: wave.categories,
      source: effective ? effective.source : null,
      stations,
      alerts,
      summary: {
        stations: stations.length,
        covered: stations.filter((station) => station.status === 'covered').length,
        judgesScheduled: scheduledJudges.size,
        judgesFull: fullJudges.size,
        outside: outsideJudges.size,
        cards: cardsCount,
        looseCards: stations.reduce((sum, station) => sum + station.cards.filter((card) => !card.judgeUserId).length, 0),
        waiting: hasAssignments && started ? stations.reduce((sum, station) => sum + (station.waiting ?? 0), 0) : null,
        judgesWithCard: withCard.size,
        stationsWithCard: stations.filter((station) => station.cards.length > 0).length
      }
    };
  });

  return { hasAssignments, waves, defaultWaveId: pickDefaultRaceCoverageWave(waves) };
};
