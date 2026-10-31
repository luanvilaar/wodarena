import { raceStationKey } from '@/lib/raceCourseStructure';
import type { RaceEvent, RaceReason, RaceRuleset, RaceStationKind, RaceStationResult } from '@/lib/raceRules';
import { formatRacePenalty, wallBallLoad, type RaceQueuedEvent } from '@/lib/raceWallBall';

// Tela do judge de uma estação que não é a contagem de reps (Story 1.102, D33):
// ergômetro, trenó, seções e genérica. Regras puras, sem React e sem rede:
// quais botões aparecem, quando "Liberar" acende, o texto de "Atleta saiu",
// os motivos agrupados, o tempo na estação e o estado de cada linha da lista
// da onda. O estado da estação vem do próprio motor (evaluateRaceStation),
// rodado no aparelho sobre a fila local (useRaceSync), e o motor continua
// sendo quem recusa o que não cabe: a tela mostra a mensagem dele. A tela
// nunca envia `abandon` (só tipo reps, D24) nem `exit` em estação de reps
// (D22); a estação de reps abre a tela do Wall Ball (Story 1.97).

// ---------------------------------------------------------------------------
// Faixa e tipos
// ---------------------------------------------------------------------------

/** Faixa do CourtShell da escolha de estação (D26). */
export const RACE_STATIONS_EYEBROW = 'Fitness Race · Estações';

/** Faixa do CourtShell da lista e do cartão (AC4, D26): "Fitness Race · {nome da estação}". */
export const raceStationEyebrow = (name?: string | null) => (name ? `Fitness Race · ${name}` : RACE_STATIONS_EYEBROW);

export const RACE_STATION_KIND_LABELS: Record<RaceStationKind, string> = {
  ergometer: 'Ergômetro',
  sled: 'Trenó',
  sections: 'Seções',
  wall_ball: 'Reps',
  generic: 'Genérica'
};

/** Trenó e seções contam trechos ou voltas (`section` do motor); os outros tipos não têm meta numérica. */
export const stationUsesCounter = (kind: RaceStationKind) => kind === 'sled' || kind === 'sections';

/** Estação de reps não usa o cartão de estação: abre a tela do Wall Ball (Story 1.97). */
export const stationOpensWallBall = (kind: RaceStationKind) => kind === 'wall_ball';

export const stationUnitNoun = (kind: RaceStationKind, count: number) => {
  if (kind === 'sled') return count === 1 ? 'trecho' : 'trechos';
  return count === 1 ? 'volta' : 'voltas';
};

/** Carga informada no percurso (peso masculino ou feminino), só em seções (AUTO-DECISION da story): liga devolução, carga errada e Roxzone. */
export const stationHasLoad = (stage: { kind: RaceStationKind; maleWeight?: string | null; femaleWeight?: string | null }) => (
  stage.kind === 'sections' && Boolean((stage.maleWeight || '').trim() || (stage.femaleWeight || '').trim())
);

/**
 * Meta e carga da estação para os selos do cartão (D6): "4 trechos" (ou a
 * distância quando não há meta) e a carga da categoria.
 */
export const describeStationMeta = (
  stage: { kind: RaceStationKind; expectedUnits?: number | null; distance?: string | null; maleWeight?: string | null; femaleWeight?: string | null },
  category?: string | null
) => {
  const target = stationUsesCounter(stage.kind) && typeof stage.expectedUnits === 'number'
    ? `${stage.expectedUnits} ${stationUnitNoun(stage.kind, stage.expectedUnits)}`
    : '';
  const distance = stage.distance ? stage.distance : '';
  return {
    target: [target, distance].filter(Boolean).join(' · '),
    load: wallBallLoad({ maleWeight: stage.maleWeight || undefined, femaleWeight: stage.femaleWeight || undefined }, category)
  };
};

// ---------------------------------------------------------------------------
// Motivos (AC5, AC7, AC8)
// ---------------------------------------------------------------------------

/**
 * Motivos do catálogo `sections` por estação conhecida da biblioteca
 * (AUTO-DECISION da story): o catálogo do regulamento é um só para Burpee
 * Broad Jump, Sandbag Lunges e Farmers Carry (QA da 1.93, REQ-001); os grupos
 * seguem os comentários de raceRulePresets.ts.
 */
export const RACE_SECTION_REASON_GROUPS: Record<string, readonly string[]> = {
  'burpee-broad-jump': ['chest_not_touching', 'hands_too_far', 'feet_misaligned', 'extra_step'],
  'sandbag-lunges': ['knee_not_touching', 'no_extension', 'step_between_reps', 'sandbag_outside_shoulders'],
  'farmers-carry': ['kb_moved_forward', 'arms_not_extended']
};

/**
 * Motivos da estação no regulamento: os do tipo; em seções, só os do grupo da
 * estação quando o nome (ou o id) é da biblioteca; fora dela, todos.
 */
export const stationReasons = (rules: Pick<RaceRuleset, 'stations'>, stage: { id: string; name: string; kind: RaceStationKind }): RaceReason[] => {
  const all = rules.stations[stage.kind]?.reasons ?? [];
  if (stage.kind !== 'sections') return all;
  const group = RACE_SECTION_REASON_GROUPS[stage.id] ?? RACE_SECTION_REASON_GROUPS[raceStationKey(stage.name)];
  if (!group) return all;
  const picked = all.filter((reason) => group.includes(reason.code));
  return picked.length > 0 ? picked : all;
};

/** Até este número de motivos, eles ficam no próprio cartão; acima, abrem a folha "Infração da estação" (maquete dois-cartoes.html). */
export const STATION_INLINE_REASONS_MAX = 2;

/** Itens do menu "Infração geral" (D17): as gerais do regulamento, 1 toque. Sem magnésio do Wall Ball (fora dele, é infração geral). */
export const stationGeneralInfractionItems = (rules: Pick<RaceRuleset, 'general'>) => (
  rules.general.map((item) => ({ key: item.code, label: item.label, seconds: item.seconds, event: { t: 'infraction', code: item.code } as RaceEvent }))
);

/** Texto da advertência da estação para a folha de motivos: "A 1ª nesta estação é advertência (0 s). Depois, 15 s cada." */
export const describeStationWarning = (rules: Pick<RaceRuleset, 'stations'>, kind: RaceStationKind, warningUsed: boolean) => {
  const station = rules.stations[kind];
  if (!station) return '';
  const after = `${station.secondsAfterWarning} s`;
  if (station.warnings <= 0) return `Cada infração vale ${after}. Vale na hora.`;
  return warningUsed
    ? `Advertência já usada nesta estação: esta vale ${after}. Vale na hora.`
    : `A 1ª nesta estação é advertência (0 s). Depois, ${after} cada. Vale na hora.`;
};

// ---------------------------------------------------------------------------
// Controles do cartão (AC5 a AC8, AC12)
// ---------------------------------------------------------------------------

type ControlResult = Pick<RaceStationResult, 'state' | 'started' | 'units' | 'expectedUnits' | 'roxzoneLeft' | 'infractions'>;

/** Devolução incorreta ainda cancelável: vigente e o atleta não saiu da Roxzone. */
export const stationOpenReturn = (result: Pick<RaceStationResult, 'roxzoneLeft' | 'infractions'>) => (
  !result.roxzoneLeft && result.infractions.some((item) => item.code === 'return_wrong' && item.status === 'confirmed')
);

/** A advertência da estação já foi usada (selo "Advertência usada"). */
export const stationWarningUsed = (result: Pick<RaceStationResult, 'infractions'>) => (
  result.infractions.some((item) => !item.general && item.kind === 'warning' && item.status !== 'cancelled')
);

export type StationControls = {
  counter: boolean;
  /** "Iniciar" no ergômetro e na genérica; no trenó e nas seções, o 1º "+1" inicia junto (maquete). */
  showStart: boolean;
  canAddUnit: boolean;
  missing: number;
  closed: 'released' | 'left_incomplete' | null;
  redo: boolean;
  release: { enabled: boolean; label: string; sub: string };
  /** "Atleta saiu" só no trenó e nas seções com meta (D28): sem meta, a saída não cobraria nada e fecharia a estação. */
  exit: { visible: boolean; enabled: boolean };
  load: { visible: boolean; openReturn: boolean; canReturnWrong: boolean; canWrongLoad: boolean };
};

/**
 * Quais botões o cartão mostra e quando "Liberar" acende: depois do início,
 * sem REFAZER em aberto e, no trenó e nas seções com meta, com o contador
 * completo (o motor recusa a liberação com trecho faltando).
 */
export const describeStationControls = (input: {
  stage: { kind: RaceStationKind; maleWeight?: string | null; femaleWeight?: string | null };
  closesTime: boolean;
  result: ControlResult;
}): StationControls => {
  const { stage, closesTime, result } = input;
  const counter = stationUsesCounter(stage.kind);
  const closed = result.state === 'released' || result.state === 'left_incomplete' ? result.state : null;
  const redo = result.state === 'redo';
  const expected = counter ? result.expectedUnits : null;
  const missing = expected !== null ? Math.max(0, expected - result.units) : 0;
  const enabled = !closed && !redo && result.started && missing === 0;
  const label = enabled
    ? 'Segure para liberar'
    : counter && missing > 0
      ? `Faltam ${missing} ${stationUnitNoun(stage.kind, missing)}`
      : 'Inicie para liberar';
  const openReturn = stationOpenReturn(result);
  const loadVisible = stationHasLoad(stage) && !closed && !redo;
  return {
    counter,
    showStart: !counter && !result.started && !closed,
    canAddUnit: counter && !closed && !redo && (expected === null || result.units < expected),
    missing,
    closed,
    redo,
    release: {
      enabled,
      label,
      sub: closesTime ? 'Fecha o tempo da prova · sem desfazer' : 'O atleta segue para a próxima estação · sem desfazer'
    },
    exit: { visible: counter && expected !== null && !closed && !redo, enabled: missing > 0 },
    load: {
      visible: loadVisible,
      openReturn: loadVisible && openReturn,
      canReturnWrong: loadVisible && !openReturn && !result.roxzoneLeft,
      canWrongLoad: loadVisible && !openReturn
    }
  };
};

/**
 * Texto da folha "Atleta saiu" (AC6, AC7, D28): o que vai ser cobrado
 * (faltantes × valor do regulamento) antes de confirmar. Na estação final, a
 * saída não fecha o tempo (Story 1.101, AC4; D44) e a folha diz isso.
 */
export const describeStationExit = (input: {
  kind: RaceStationKind;
  units: number;
  expectedUnits: number;
  perUnitSeconds: number;
  closesTime: boolean;
}) => {
  const { kind, units, expectedUnits, perUnitSeconds, closesTime } = input;
  const missing = Math.max(0, expectedUnits - units);
  const seconds = missing * perUnitSeconds;
  const one = stationUnitNoun(kind, 1);
  const many = stationUnitNoun(kind, 2);
  return {
    missing,
    seconds,
    progress: `${units} de ${expectedUnits} ${stationUnitNoun(kind, expectedUnits)} · faltam ${missing}`,
    calc: `${missing} × ${perUnitSeconds} s`,
    charge: formatRacePenalty(seconds),
    // Trecho é masculino; volta, feminino.
    consequence: `Encerra a estação e cobra ${missing === 1 ? `${kind === 'sled' ? 'o' : 'a'} ${one} que falta` : `${kind === 'sled' ? 'os' : 'as'} ${many} que faltam`}.`,
    closesTimeWarning: closesTime
      ? 'Esta é a estação final: a saída não fecha o tempo da prova. A corrida fica em "Sem tempo fechado" e o organizador decide o tempo (Ajustar tempo ou DNF).'
      : null
  };
};

// ---------------------------------------------------------------------------
// Log: desfazer, último registro e tempo na estação (AC8)
// ---------------------------------------------------------------------------

type LogResult = Pick<RaceStationResult, 'voided' | 'rejected'>;

const NOT_UNDOABLE = new Set<RaceEvent['t']>(['undo', 'start', 'release', 'exit']);

/**
 * Posição que o "Desfazer último" atinge: o último registro aceito e ainda
 * não desfeito, sem contar desfazer, início, liberação e saída (o judge não
 * reabre a estação). null sem o que desfazer.
 */
export const lastUndoableStationSeq = (events: readonly { event: RaceEvent }[], result: LogResult) => {
  const voided = new Set(result.voided);
  const rejected = new Set(result.rejected.map((item) => item.seq));
  for (let seq = events.length - 1; seq >= 0; seq -= 1) {
    if (voided.has(seq) || rejected.has(seq) || NOT_UNDOABLE.has(events[seq].event.t)) continue;
    return seq;
  }
  return null;
};

/** Texto de um registro para a linha "Último: …". */
export const describeStationEvent = (
  event: RaceEvent,
  rules: Pick<RaceRuleset, 'stations' | 'general' | 'returnWrong' | 'wrongLoad'>,
  kind: RaceStationKind
): string => {
  switch (event.t) {
    case 'start': return 'Iniciou';
    case 'section': return `+1 ${stationUnitNoun(kind, 1)}`;
    case 'infraction':
      return rules.stations[kind]?.reasons.find((item) => item.code === event.code)?.label
        ?? rules.general.find((item) => item.code === event.code)?.label
        ?? 'Infração';
    case 'return_wrong': return `Devolução incorreta · ${formatRacePenalty(rules.returnWrong.seconds)}`;
    case 'return_corrected': return 'Devolução corrigida';
    case 'leave_roxzone': return 'Saiu da Roxzone';
    case 'wrong_load': return 'Carga errada · refazer';
    case 'redo_done': return 'Refez com a carga certa';
    case 'redo_declined': return `Não refez · ${formatRacePenalty(rules.wrongLoad.declinedSeconds)}`;
    case 'exit': return 'Saída registrada';
    case 'release': return 'Liberado';
    default: return 'Registro';
  }
};

/** Texto da última ação, com o desfazer citando o registro atingido. */
export const describeLastStationAction = (
  events: readonly { event: RaceEvent }[],
  rules: Pick<RaceRuleset, 'stations' | 'general' | 'returnWrong' | 'wrongLoad'>,
  kind: RaceStationKind
) => {
  const last = events[events.length - 1]?.event;
  if (!last) return '';
  if (last.t === 'undo') {
    const target = events[last.of]?.event;
    return `desfeito (${target ? describeStationEvent(target, rules, kind) : 'registro'}). O registro continua no histórico`;
  }
  return describeStationEvent(last, rules, kind);
};

const effectiveEvents = (events: readonly RaceQueuedEvent[], result: LogResult) => {
  const voided = new Set(result.voided);
  const rejected = new Set(result.rejected.map((item) => item.seq));
  return events.filter((_, seq) => !voided.has(seq) && !rejected.has(seq));
};

/** Horário do toque do início efetivo da estação. null sem início. */
export const stationStartedAt = (events: readonly RaceQueuedEvent[], result: LogResult) => {
  const start = effectiveEvents(events, result).find((item) => item.event.t === 'start');
  return typeof start?.deviceAt === 'number' ? start.deviceAt : null;
};

/** Horário do toque que encerrou a estação (liberação ou saída). null aberta. */
export const stationEndedAt = (events: readonly RaceQueuedEvent[], result: LogResult & Pick<RaceStationResult, 'state'>) => {
  if (result.state !== 'released' && result.state !== 'left_incomplete') return null;
  const end = effectiveEvents(events, result).filter((item) => item.event.t === 'release' || item.event.t === 'exit').pop();
  return typeof end?.deviceAt === 'number' ? end.deviceAt : null;
};

/**
 * Tempo na estação (AC8): do toque do início até agora, pelo relógio do
 * aparelho; com a estação encerrada, até o toque que a encerrou. null sem início.
 */
export const stationElapsedSeconds = (
  events: readonly RaceQueuedEvent[],
  result: LogResult & Pick<RaceStationResult, 'state'>,
  nowMs: number
) => {
  const start = stationStartedAt(events, result);
  if (start === null || !Number.isFinite(nowMs)) return null;
  const end = stationEndedAt(events, result) ?? nowMs;
  return Math.max(0, Math.floor((end - start) / 1000));
};

// ---------------------------------------------------------------------------
// Lista da onda da estação (AC3, AC4, AC12)
// ---------------------------------------------------------------------------

export type RaceStationBoardAthlete = {
  athleteId: string;
  name: string;
  box: string;
  divisionName: string;
  team: boolean;
  runStatus: string;
  stationId: string;
  kind: RaceStationKind;
  expectedUnits: number | null;
  closesTime: boolean;
  attempt: {
    id: string;
    status: string;
    judgeUserId: string | null;
    judgeName: string;
    started: boolean;
    units: number;
    expectedUnits: number | null;
    missing: number;
    penaltySeconds: number;
  } | null;
};

const CLOSED_ATTEMPT = new Set(['released', 'exited_incomplete', 'cancelled']);

/** Tentativa aberta do judge nesta estação (não liberada, sem saída). */
const isOpenAttemptOf = (athlete: RaceStationBoardAthlete, viewerId: string) => (
  Boolean(athlete.attempt && athlete.attempt.judgeUserId === viewerId && !CLOSED_ATTEMPT.has(athlete.attempt.status) && athlete.runStatus === 'racing')
);

/**
 * Estado da linha da lista: concluído (liberado, saída, DNF, prova
 * encerrada), com outro judge, sem judge (assumir), seu atleta ou em corrida.
 */
export const describeStationRow = (athlete: RaceStationBoardAthlete, viewerId: string) => {
  const attempt = athlete.attempt;
  const unitsText = (units: number, expected: number | null) => (
    stationUsesCounter(athlete.kind) ? `${units} de ${expected ?? '—'} ${stationUnitNoun(athlete.kind, expected ?? units)}` : ''
  );
  if (athlete.runStatus === 'dnf') return { done: true, disabled: true, mine: false, chip: 'DNF', detail: '' };
  if (attempt?.status === 'released') return { done: true, disabled: true, mine: false, chip: 'Liberado', detail: '' };
  if (attempt?.status === 'exited_incomplete') {
    return { done: true, disabled: true, mine: false, chip: `Saiu · faltaram ${attempt.missing}`, detail: '' };
  }
  if (athlete.runStatus !== 'racing') return { done: true, disabled: true, mine: false, chip: 'Prova encerrada', detail: '' };
  if (!attempt) return { done: false, disabled: false, mine: false, chip: 'Em corrida', detail: '' };
  const detail = attempt.started || attempt.units > 0 ? unitsText(attempt.units, attempt.expectedUnits) || 'em andamento' : '';
  if (attempt.judgeUserId && attempt.judgeUserId !== viewerId) return { done: false, disabled: true, mine: false, chip: `Com ${attempt.judgeName}`, detail };
  if (!attempt.judgeUserId) return { done: false, disabled: false, mine: false, chip: 'Sem judge · assumir', detail };
  return { done: false, disabled: false, mine: true, chip: 'Seu atleta', detail };
};

/**
 * Estação final de 1 atleta por judge (AC12, D39): com um atleta aberto pelo
 * judge, tocar em outro mostra o aviso e não abre nada. A recusa de verdade é
 * do servidor (Story 1.103). Devolve o aviso e o atleta aberto, ou null.
 */
export const finalStationGuard = (rows: readonly RaceStationBoardAthlete[], viewerId: string, target: RaceStationBoardAthlete) => {
  const open = rows.find((row) => row.athleteId !== target.athleteId && isOpenAttemptOf(row, viewerId) && (row.closesTime || target.closesTime));
  if (!open) return null;
  return {
    message: `Esta estação é de 1 atleta por judge. Libere ${open.name} antes de abrir outro atleta.`,
    open
  };
};

// ---------------------------------------------------------------------------
// Capacidade do judge (Story 1.103; D31, D32, D39, D43)
// ---------------------------------------------------------------------------

/** Tentativas ativas que um judge confere ao mesmo tempo nas estações de 2 cartões (D31). Equipe é 1 cartão. */
export const RACE_JUDGE_MAX_ACTIVE = 2;
/** Na estação de 1 atleta (reps ou estação final), o judge confere só ela (D32, D39). */
export const RACE_JUDGE_MAX_ACTIVE_SOLO = 1;

/** Estados da tentativa que ocupam a vaga do judge (AC2); `released`, `exited_incomplete` e `cancelled` não ocupam. */
export const RACE_ACTIVE_ATTEMPT_STATUSES = ['waiting', 'running', 'done_pending_release', 'redo'] as const;
/** Situações da corrida em que a tentativa ainda ocupa a vaga; `dnf` e `cancelled` liberam. */
const ACTIVE_RUN_STATUSES = new Set(['racing', 'finished']);

/** A tentativa ocupa a vaga do judge (AC2): estado ativo, com a corrida em `racing` ou `finished`. */
export const isRaceAttemptActive = (attemptStatus: string, runStatus: string | null | undefined) => (
  (RACE_ACTIVE_ATTEMPT_STATUSES as readonly string[]).includes(attemptStatus) && ACTIVE_RUN_STATUSES.has(runStatus ?? '')
);

/**
 * Estação de 1 atleta por judge (AC3): tipo reps em qualquer posição do
 * percurso (D32, D43) ou a última estação do percurso, de qualquer tipo (D39).
 * Não divide a tela, não tem "Soltar" nem "Dispensar".
 */
export const isSoloRaceStation = (stationKind: RaceStationKind, isLastStation: boolean) => stationKind === 'wall_ball' || isLastStation;

export const RACE_JUDGE_FULL_MESSAGE = 'Você já confere 2 atletas. Libere um antes de abrir outro.';
export const RACE_JUDGE_WALL_BALL_MESSAGE = 'O Wall Ball é conferido sozinho: libere o cartão aberto antes.';
export const RACE_JUDGE_FINAL_STATION_MESSAGE = 'Esta estação é de 1 atleta por judge. Libere o atleta aberto antes de abrir outro.';
/** Soltar e dispensar só existem nas estações de 2 cartões (AC5, D39). */
export const RACE_SOLO_RELEASE_MESSAGE = 'Esta estação é de 1 atleta por judge: só o organizador libera a tentativa.';

/** Cartão aberto do judge, para a conta da capacidade. */
export type RaceJudgeCard = { attemptId: string; stationKind: RaceStationKind; solo: boolean };

export type RaceJudgeCapacity =
  | { ok: true; active: number; max: number }
  | { ok: false; reason: 'full' | 'solo'; message: string; active: number; max: number; blocking: RaceJudgeCard[] };

/**
 * Cabe mais esta tentativa na tela do judge? Regra única do servidor e da
 * tela (AC2, AC3). `active` são as tentativas ativas dele (isRaceAttemptActive);
 * retomar a que já é dele nunca conta como nova. Estação de 1 atleta é
 * exclusiva nos dois sentidos: com ela aberta não abre nada; com qualquer
 * cartão aberto, não abre ela. Nas outras, até 2.
 */
export const raceJudgeCapacity = (active: readonly RaceJudgeCard[], target: RaceJudgeCard): RaceJudgeCapacity => {
  const others = active.filter((card) => card.attemptId !== target.attemptId);
  const solo = others.find((card) => card.solo);
  const max = target.solo || solo ? RACE_JUDGE_MAX_ACTIVE_SOLO : RACE_JUDGE_MAX_ACTIVE;
  if (solo || (target.solo && others.length > 0)) {
    // A mensagem é a da estação de 1 atleta envolvida: a aberta ou, sem ela, a que se quer abrir.
    const kind = (solo ?? target).stationKind;
    return {
      ok: false,
      reason: 'solo',
      message: kind === 'wall_ball' ? RACE_JUDGE_WALL_BALL_MESSAGE : RACE_JUDGE_FINAL_STATION_MESSAGE,
      active: others.length,
      max,
      blocking: solo ? [solo] : others
    };
  }
  if (others.length >= RACE_JUDGE_MAX_ACTIVE) {
    return { ok: false, reason: 'full', message: RACE_JUDGE_FULL_MESSAGE, active: others.length, max, blocking: others };
  }
  return { ok: true, active: others.length, max };
};

/**
 * Tela de dois cartões do judge (Story 1.103, AC7), com o cartão em foco.
 * Nunca usada para a estação de 1 atleta (D39): ela abre a tela de um atleta só.
 */
export const raceCardsHref = (eventId: string, focusAttemptId?: string | null) => (
  `/judge/corrida/${encodeURIComponent(eventId)}/cartoes${focusAttemptId ? `?foco=${encodeURIComponent(focusAttemptId)}` : ''}`
);

/** Topo da tela de dois cartões (AC7, maquete): "1 de 2 · 1 vaga livre" ou "2 de 2 · Você já confere 2 atletas". */
export const describeJudgeCardsCount = (active: number) => {
  const used = Math.max(0, Math.min(RACE_JUDGE_MAX_ACTIVE, active));
  const free = RACE_JUDGE_MAX_ACTIVE - used;
  if (free === 0) return `${used} de ${RACE_JUDGE_MAX_ACTIVE} · Você já confere ${RACE_JUDGE_MAX_ACTIVE} atletas`;
  return `${used} de ${RACE_JUDGE_MAX_ACTIVE} · ${free} ${free === 1 ? 'vaga livre' : 'vagas livres'}`;
};

type CardSyncState = { status: 'saved' | 'saving' | 'offline' | 'conflict' | 'rejected'; pendingCount: number };

/**
 * Indicador geral da tela de dois cartões (AC8): cada cartão tem a sua fila;
 * o geral soma os registros pendentes e mostra o pior estado (recusa ou
 * conflito, depois sem conexão, depois salvando). Recusa em um cartão não
 * para o outro: o geral só avisa.
 */
export const aggregateCardsSync = (cards: readonly CardSyncState[]) => {
  const pendingCount = cards.reduce((sum, card) => sum + card.pendingCount, 0);
  const stopped = cards.filter((card) => card.status === 'conflict' || card.status === 'rejected').length;
  if (stopped > 0) {
    return { tone: 'down' as const, pendingCount, text: `${stopped === 1 ? '1 cartão precisa' : `${stopped} cartões precisam`} de atenção${cards.length > stopped ? ' · o outro segue salvando' : ''}` };
  }
  const items = `${pendingCount} ${pendingCount === 1 ? 'registro' : 'registros'}`;
  if (pendingCount > 0 && cards.some((card) => card.status === 'offline')) return { tone: 'down' as const, pendingCount, text: `Sem conexão: ${items} guardados no aparelho` };
  if (pendingCount > 0) return { tone: 'wait' as const, pendingCount, text: `Salvando ${items}…` };
  return { tone: 'ok' as const, pendingCount, text: 'Salvo' };
};

/** Marca da lista e da escolha de estação abertas por "Adicionar atleta" (`?de=cartoes`): voltam aos cartões e não listam a estação de 1 atleta. */
export const RACE_FROM_CARDS = 'cartoes';

const normalizeSearch = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Busca por nome na lista da onda (AUTO-DECISION da story): filtro local, sem acento e sem caixa. */
export const filterStationRows = <T extends { name: string }>(rows: readonly T[], query: string) => {
  const needle = normalizeSearch(query);
  return needle ? rows.filter((row) => normalizeSearch(row.name).includes(needle)) : [...rows];
};
