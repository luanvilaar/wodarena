import type { CourseStage } from '@/types';

// Súmula Fitness Race, fase F0 (Story 1.93). Puro e sem DOM: o regulamento é
// dado (RaceRuleset, presets em raceRulePresets.ts) e o motor recalcula, a
// partir do log de eventos de uma estação, o progresso, o estado e as
// infrações. Sem React, sem Supabase, sem fetch e sem relógio: os eventos não
// carregam horário (largada e liberação são do servidor, Stories 1.94 e 1.97)
// e a ordem é a posição no log. Nenhum valor de temporada mora aqui: trocar de
// regulamento muda os números sem mudar este arquivo (D6).

// ---------------------------------------------------------------------------
// Regulamento
// ---------------------------------------------------------------------------

/** Tipo de estação para o regulamento. Estação que o motor não reconhece vira `generic` (só infrações gerais). */
export type RaceStationKind = 'ergometer' | 'sled' | 'sections' | 'wall_ball' | 'generic';
export type RaceRulesetPreset = '2025_26' | '2026_27' | 'custom';
/** Desfecho de um motivo: penalidade de tempo ou REFAZER. Não há DQ na súmula: o caso grave é resolvido pelo organizador (DNF). */
export type RaceReasonOutcome = 'penalty' | 'redo';

export type RaceReason = {
  code: string;
  label: string;
  /** Cobra desde a 1ª ocorrência, sem virar advertência (se gasta a advertência da estação, decide `immediateConsumesWarning`). */
  immediate?: boolean;
  /** Segundos desta infração; sem valor, vale o `secondsAfterWarning` da estação. */
  seconds?: number;
  outcome?: RaceReasonOutcome;
};

export type RaceStationRules = {
  /** Advertências (0 s) antes de começar a cobrar: 1 nas estações 1 a 7, 0 no Wall Ball. */
  warnings: number;
  secondsAfterWarning: number;
  reasons: RaceReason[];
};

export type RaceGeneralRule = {
  code: string;
  label: string;
  seconds: number;
};

export type RaceNoRepReason = { code: string; label: string };

export type RaceRuleset = {
  preset: RaceRulesetPreset;
  name: string;
  /** false nos presets de partida: valores a conferir com o regulamento oficial. */
  verified: boolean;
  /**
   * Infração de motivo imediato conta como uma das infrações da estação e gasta
   * a advertência: depois dela, a próxima infração na mesma estação já cobra.
   * true nos presets (D13 em DECISOES.md, que substituiu a leitura "não consome"
   * da primeira versão do AC4). Esta é a única regra que decide isso.
   */
  immediateConsumesWarning: boolean;
  stations: Record<RaceStationKind, RaceStationRules>;
  wallBall: {
    secondsPerMissingRep: number;
    missingRepsLabel: string;
    chalkSeconds: number;
    chalkLabel: string;
    noRepReasons: RaceNoRepReason[];
  };
  general: RaceGeneralRule[];
  /** Devolução incorreta de Farmers ou Sandbag: cancelável se corrigida antes de sair da Roxzone. */
  returnWrong: { label: string; seconds: number };
  /** Carga errada: estado REFAZER; não refeita, cobra `declinedSeconds`. */
  wrongLoad: { label: string; declinedLabel: string; declinedSeconds: number };
  /** Trecho ou volta faltando ao sair: segundos por unidade. */
  missingUnit: { label: string; perUnitSeconds: number };
};

/**
 * Regulamento `custom` montado a partir de outro (um preset, por exemplo):
 * cópia profunda, independente da original, para o organizador editar. Sai
 * sem a marca de conferido.
 */
export const createCustomRaceRuleset = (base: RaceRuleset, name = `${base.name} (personalizado)`): RaceRuleset => ({
  ...structuredClone(base),
  preset: 'custom',
  name,
  verified: false
});

// ---------------------------------------------------------------------------
// Estação do percurso
// ---------------------------------------------------------------------------

/** Estação copiada do snapshot do percurso do evento (Story 1.94), com o tipo já resolvido. */
export type RaceCourseStage = Pick<CourseStage, 'id' | 'name' | 'distance' | 'reps' | 'maleWeight' | 'femaleWeight'> & {
  kind: RaceStationKind;
  /** Trechos ou seções esperados (Sled 50 m com trecho de 12,5 m = 4). Sem valor, o motor não cobra unidade faltante. */
  expectedUnits?: number;
};

// Ids da biblioteca de estações de fitnessRacing.ts (derivados do nome).
const STATION_KIND_BY_ID: Record<string, RaceStationKind> = {
  'ski-erg': 'ergometer',
  row: 'ergometer',
  'sled-push': 'sled',
  'sled-pull': 'sled',
  'burpee-broad-jump': 'sections',
  'farmers-carry': 'sections',
  'sandbag-lunges': 'sections',
  'wall-balls': 'wall_ball'
};

// Mesmo slug que buildFitnessRacingCourse usa para o id da estação.
const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/** Tipo da estação pelo id do percurso ou, se o id não for da biblioteca, pelo nome. Corrida e estação desconhecida viram `generic`. */
export const resolveRaceStationKind = (stage: Pick<CourseStage, 'id' | 'name'> & { type?: CourseStage['type'] }): RaceStationKind => {
  if (stage.type === 'run') return 'generic';
  return STATION_KIND_BY_ID[stage.id] ?? STATION_KIND_BY_ID[slugify(stage.name || '')] ?? 'generic';
};

/** Estação do percurso pronta para o motor. `expectedUnits` vem de quem monta o snapshot (seções por mapa do local ficam para a F2). */
export const toRaceCourseStage = (stage: CourseStage, options: { expectedUnits?: number } = {}): RaceCourseStage => ({
  id: stage.id,
  name: stage.name,
  distance: stage.distance,
  reps: stage.reps,
  maleWeight: stage.maleWeight,
  femaleWeight: stage.femaleWeight,
  kind: resolveRaceStationKind(stage),
  ...(options.expectedUnits !== undefined ? { expectedUnits: options.expectedUnits } : {})
});

// ---------------------------------------------------------------------------
// Eventos, infrações e resultado
// ---------------------------------------------------------------------------

/**
 * Evento da súmula de uma estação. A posição no log é o `seq` (Story 1.94):
 * `undo.of` aponta para ela e ela entra na chave estável das infrações.
 */
export type RaceEvent =
  | { t: 'start' }
  | { t: 'section' }
  | { t: 'rep' }
  | { t: 'norep'; reason: string }
  | { t: 'chalk' }
  | { t: 'infraction'; code: string }
  | { t: 'return_wrong' }
  | { t: 'return_corrected' }
  | { t: 'leave_roxzone' }
  | { t: 'wrong_load' }
  | { t: 'redo_done' }
  | { t: 'redo_declined' }
  | { t: 'exit' }
  | { t: 'release' }
  /** Atleta saiu do Wall Ball antes das reps (Story 1.97, D24): só marca, sem efeito no tempo nem penalidade. */
  | { t: 'abandon' }
  | { t: 'undo'; of: number };

export type RaceInfractionKind = 'warning' | 'penalty' | 'redo';
/** O motor só produz `pending`, `confirmed` e `cancelled`; `revoked` é decisão do organizador. */
export type RaceInfractionStatus = 'pending' | 'confirmed' | 'revoked' | 'cancelled';

export type RaceInfraction = {
  /** Chave estável: estação, seq do evento de origem e código. O servidor casa a infração recalculada com a já revogada ou alterada. */
  sourceKey: string;
  sourceSeq: number;
  stageId: string;
  code: string;
  label: string;
  kind: RaceInfractionKind;
  seconds: number;
  status: RaceInfractionStatus;
  /** Infração geral (qualquer árbitro lança, não passa pela advertência). */
  general: boolean;
  /** Reps ou unidades faltantes, nas infrações de saída incompleta. */
  units?: number;
  /** Desfecho do REFAZER. */
  resolution?: 'redone' | 'declined';
  /** Observação da infração. */
  note?: string;
};

export type RaceStationState = 'waiting' | 'in_progress' | 'completed' | 'redo' | 'released' | 'left_incomplete';

export type RaceRejectedEvent = { seq: number; error: string };

export type RaceStationResult = {
  stageId: string;
  kind: RaceStationKind;
  state: RaceStationState;
  started: boolean;
  /** Wall Ball: reps válidas (rep menos o que foi desfeito) e a quantidade que trava o contador. */
  validReps: number;
  targetReps: number | null;
  noReps: { seq: number; reason: string }[];
  /** Sled e seções: trechos ou seções registrados e esperados. */
  units: number;
  expectedUnits: number | null;
  /** Reps ou unidades que faltavam quando o atleta saiu. */
  missing: number;
  roxzoneLeft: boolean;
  infractions: RaceInfraction[];
  /** Soma das penalidades `confirmed` desta estação. */
  penaltySeconds: number;
  /** Eventos recusados (sem efeito), com o motivo para o árbitro. */
  rejected: RaceRejectedEvent[];
  /** Posições desfeitas por um `undo` válido. */
  voided: number[];
  /** Ocorrências de infrações gerais até aqui (entra na próxima estação, ver evaluateRaceRun). */
  generalOccurrences: Record<string, number>;
  /** Saída registrada (`abandon`, D24) ainda ativa: contador não travado e estação não encerrada. */
  abandoned: boolean;
  /** Posição do `abandon` ativo (para achar o horário); null quando `abandoned` é false. */
  abandonSeq: number | null;
};

export type RaceEvaluationOptions = {
  /** Ocorrências de infrações gerais nas estações anteriores (informativo; a 2ª ocorrência cobra de novo, sem DQ). */
  generalOccurrences?: Record<string, number>;
};

// ---------------------------------------------------------------------------
// Motor
// ---------------------------------------------------------------------------

type Draft = {
  started: boolean;
  closed: 'released' | 'left_incomplete' | null;
  reps: number;
  noReps: { seq: number; reason: string }[];
  units: number;
  missing: number;
  roxzoneLeft: boolean;
  /** Infrações de estação que contam para a advertência. */
  counted: number;
  generalOccurrences: Record<string, number>;
  /** Índice, em `infractions`, do REFAZER em aberto. */
  redo: number | null;
  /** Índices das devoluções incorretas ainda canceláveis. */
  openReturns: number[];
  infractions: RaceInfraction[];
  /** Posição do `abandon` ativo (D24). */
  abandonSeq: number | null;
};

type PlainObject = Record<string, unknown>;
const isPlainObject = (value: unknown): value is PlainObject => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const positiveInt = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null);

const newDraft = (generalOccurrences: Record<string, number>): Draft => ({
  started: false,
  closed: null,
  reps: 0,
  noReps: [],
  units: 0,
  missing: 0,
  roxzoneLeft: false,
  counted: 0,
  generalOccurrences: { ...generalOccurrences },
  redo: null,
  openReturns: [],
  infractions: [],
  abandonSeq: null
});

const usesUnits = (kind: RaceStationKind) => kind === 'sled' || kind === 'sections';

/**
 * Aplica um evento (que não é `undo`) ao rascunho. Confere tudo antes de
 * mexer: devolve a mensagem de recusa sem alterar nada, ou null depois de
 * aplicar.
 */
const applyEvent = (
  ruleset: RaceRuleset,
  stage: RaceCourseStage,
  draft: Draft,
  raw: unknown,
  seq: number
): string | null => {
  if (!isPlainObject(raw)) return 'registro em formato inválido.';
  const event = raw;
  const kind = stage.kind;
  const rules = ruleset.stations[kind];
  const targetReps = positiveInt(stage.reps);
  const expectedUnits = positiveInt(stage.expectedUnits);
  const closedError = 'a estação já foi encerrada para este atleta.';

  const push = (
    code: string,
    label: string,
    infractionKind: RaceInfractionKind,
    seconds: number,
    extra: Partial<Pick<RaceInfraction, 'general' | 'units' | 'note'>> = {}
  ) => {
    draft.infractions.push({
      sourceKey: `${stage.id}:${seq}:${code}`,
      sourceSeq: seq,
      stageId: stage.id,
      code,
      label,
      kind: infractionKind,
      seconds,
      // Penalidade e advertência valem na hora (D2); REFAZER espera o desfecho.
      status: infractionKind === 'warning' || infractionKind === 'penalty' ? 'confirmed' : 'pending',
      general: extra.general ?? false,
      ...(extra.units !== undefined ? { units: extra.units } : {}),
      ...(extra.note !== undefined ? { note: extra.note } : {})
    });
    return draft.infractions.length - 1;
  };

  switch (event.t) {
    case 'start':
      if (draft.started) return 'a estação já foi iniciada.';
      if (draft.closed) return closedError;
      draft.started = true;
      return null;

    case 'section':
      if (!usesUnits(kind)) return 'esta estação não conta trechos.';
      if (!draft.started) return 'inicie a estação antes de registrar.';
      if (draft.closed) return closedError;
      if (expectedUnits !== null && draft.units >= expectedUnits) return `os ${expectedUnits} trechos já foram registrados.`;
      draft.units += 1;
      return null;

    case 'rep':
      if (kind !== 'wall_ball') return 'esta estação não conta repetições.';
      if (!draft.started) return 'inicie a estação antes de registrar.';
      if (draft.closed) return closedError;
      if (targetReps !== null && draft.reps >= targetReps) return `contador travado em ${targetReps} repetições.`;
      draft.reps += 1;
      return null;

    case 'norep': {
      if (kind !== 'wall_ball') return 'esta estação não registra no-rep.';
      if (!draft.started) return 'inicie a estação antes de registrar.';
      if (draft.closed) return closedError;
      const reason = typeof event.reason === 'string' ? event.reason : '';
      if (!ruleset.wallBall.noRepReasons.some((item) => item.code === reason)) return 'motivo de no-rep desconhecido.';
      draft.noReps.push({ seq, reason });
      return null;
    }

    case 'chalk':
      if (kind !== 'wall_ball') return 'magnésio fora do Wall Ball é infração geral.';
      if (draft.closed) return closedError;
      push('wall_ball_chalk', ruleset.wallBall.chalkLabel, 'penalty', ruleset.wallBall.chalkSeconds);
      return null;

    case 'infraction': {
      const code = typeof event.code === 'string' ? event.code : '';
      const reason = rules.reasons.find((item) => item.code === code);
      if (reason) {
        if (draft.closed) return closedError;
        const outcome = reason.outcome ?? 'penalty';
        if (outcome === 'redo' && draft.redo !== null) return 'já existe um REFAZER em aberto nesta estação.';
        if (outcome === 'redo') {
          draft.redo = push(code, reason.label, 'redo', 0);
          return null;
        }
        const seconds = reason.seconds ?? rules.secondsAfterWarning;
        if (reason.immediate) {
          push(code, reason.label, 'penalty', seconds);
          if (ruleset.immediateConsumesWarning) draft.counted += 1;
          return null;
        }
        // A advertência vale para a 1ª infração da estação, de qualquer motivo; depois, cada uma cobra.
        if (draft.counted < rules.warnings) push(code, reason.label, 'warning', 0);
        else push(code, reason.label, 'penalty', seconds);
        draft.counted += 1;
        return null;
      }
      const general = ruleset.general.find((item) => item.code === code);
      if (!general) return 'motivo desconhecido para esta estação.';
      // Gerais não passam pela advertência e valem mesmo com a estação encerrada (Roxzone).
      const occurrence = (draft.generalOccurrences[code] ?? 0) + 1;
      draft.generalOccurrences[code] = occurrence;
      push(code, general.label, 'penalty', general.seconds, { general: true });
      return null;
    }

    case 'return_wrong':
      if (kind !== 'sections') return 'devolução incorreta só vale em estação de seções.';
      if (draft.roxzoneLeft) return 'o atleta já saiu da Roxzone.';
      draft.openReturns.push(push('return_wrong', ruleset.returnWrong.label, 'penalty', ruleset.returnWrong.seconds));
      return null;

    case 'return_corrected': {
      if (kind !== 'sections') return 'devolução incorreta só vale em estação de seções.';
      if (draft.roxzoneLeft) return 'o atleta já saiu da Roxzone: a devolução não pode mais ser corrigida.';
      const open = draft.openReturns.pop();
      if (open === undefined) return 'não há devolução incorreta para corrigir.';
      draft.infractions[open] = { ...draft.infractions[open], status: 'cancelled' };
      return null;
    }

    case 'leave_roxzone':
      if (draft.roxzoneLeft) return 'a saída da Roxzone já foi registrada.';
      draft.roxzoneLeft = true;
      draft.openReturns = [];
      return null;

    case 'wrong_load':
      if (kind !== 'sections') return 'carga errada só vale em estação de seções.';
      if (draft.closed) return closedError;
      if (draft.redo !== null) return 'já existe um REFAZER em aberto nesta estação.';
      draft.redo = push('wrong_load', ruleset.wrongLoad.label, 'redo', 0);
      return null;

    case 'redo_done':
    case 'redo_declined': {
      if (draft.redo === null) return 'não há REFAZER em aberto nesta estação.';
      const declined = event.t === 'redo_declined';
      // Resolvido, o REFAZER fica registrado sem tempo; não refeito, cobra o valor do regulamento.
      draft.infractions[draft.redo] = { ...draft.infractions[draft.redo], status: 'confirmed', resolution: declined ? 'declined' : 'redone' };
      draft.redo = null;
      if (declined) push('redo_declined', ruleset.wrongLoad.declinedLabel, 'penalty', ruleset.wrongLoad.declinedSeconds);
      return null;
    }

    case 'release': {
      if (!draft.started) return 'inicie a estação antes de liberar.';
      if (draft.closed) return closedError;
      if (draft.redo !== null) return 'registre se o atleta refez antes de liberar.';
      if (kind === 'wall_ball' && targetReps !== null && draft.reps < targetReps) return `faltam ${targetReps - draft.reps} repetições: oriente o atleta a completar; o tempo só fecha na liberação com as ${targetReps} repetições.`;
      if (usesUnits(kind) && expectedUnits !== null && draft.units < expectedUnits) return `faltam ${expectedUnits - draft.units} trechos: registre a saída.`;
      draft.closed = 'released';
      return null;
    }

    case 'exit': {
      if (draft.closed) return closedError;
      if (draft.redo !== null) return 'registre se o atleta refez antes da saída.';
      let missing = 0;
      if (kind === 'wall_ball' && targetReps !== null) {
        missing = Math.max(0, targetReps - draft.reps);
        if (missing > 0) {
          push('missing_reps', ruleset.wallBall.missingRepsLabel, 'penalty', missing * ruleset.wallBall.secondsPerMissingRep, { units: missing });
        }
      } else if (usesUnits(kind) && expectedUnits !== null) {
        missing = Math.max(0, expectedUnits - draft.units);
        const rule = ruleset.missingUnit;
        if (missing > 0) {
          push('missing_units', rule.label, 'penalty', missing * rule.perUnitSeconds, { units: missing });
        }
      }
      draft.missing = missing;
      draft.closed = missing > 0 ? 'left_incomplete' : 'released';
      return null;
    }

    case 'abandon':
      // Saída antes das reps (Story 1.97, D24): não fecha a estação, não cobra nada, só marca a posição.
      if (kind !== 'wall_ball') return 'a saída só é registrada no Wall Ball.';
      if (!draft.started) return 'inicie a estação antes de registrar.';
      if (draft.closed) return closedError;
      if (targetReps !== null && draft.reps >= targetReps) return 'o contador já está travado: libere o atleta.';
      if (draft.abandonSeq !== null) return 'a saída já foi registrada.';
      draft.abandonSeq = seq;
      return null;

    default:
      return 'tipo de registro desconhecido.';
  }
};

const isUndo = (raw: unknown): raw is PlainObject => isPlainObject(raw) && raw.t === 'undo';

/**
 * Estado da estação derivado do log (AC1, AC13). Função pura e
 * determinística: aplica os eventos na ordem do array, não muta as entradas e
 * não lança; o mesmo log dá sempre o mesmo resultado.
 *
 * Cada evento é conferido contra o estado no momento em que entrou: o que não
 * cabe (101º `rep`, trecho além do esperado, motivo desconhecido) fica em
 * `rejected` e não tem efeito. `undo` aponta para um evento anterior aceito; o
 * efeito dele some e o estado é refeito do log sem os desfeitos (o original
 * continua no log). `undo` de `undo`, de evento inexistente, recusado ou já
 * desfeito é recusado.
 */
export const evaluateRaceStation = (
  ruleset: RaceRuleset,
  stage: RaceCourseStage,
  events: readonly unknown[],
  options: RaceEvaluationOptions = {}
): RaceStationResult => {
  const initialGeneral = options.generalOccurrences ?? {};
  const accepted = new Set<number>();
  const voided = new Set<number>();
  const rejected: RaceRejectedEvent[] = [];
  let draft = newDraft(initialGeneral);

  // Refaz o estado só com os eventos aceitos e não desfeitos. Um evento que
  // perdeu a base com o desfazer (ex.: `redo_done` sem o `wrong_load`) não tem efeito.
  const replay = (upTo: number) => {
    const next = newDraft(initialGeneral);
    for (let seq = 0; seq < upTo; seq += 1) {
      if (!accepted.has(seq) || voided.has(seq) || isUndo(events[seq])) continue;
      applyEvent(ruleset, stage, next, events[seq], seq);
    }
    return next;
  };

  events.forEach((raw, seq) => {
    if (isUndo(raw)) {
      const target = raw.of;
      const valid = typeof target === 'number'
        && Number.isInteger(target)
        && target >= 0
        && target < seq
        && accepted.has(target)
        && !isUndo(events[target])
        && !voided.has(target);
      if (!valid) {
        const earlier = typeof target === 'number' && Number.isInteger(target) && target >= 0 && target < seq;
        const error = earlier && voided.has(target)
          ? 'este registro já foi desfeito.'
          : earlier && isUndo(events[target])
            ? 'não é possível desfazer um desfazer.'
            : 'o desfazer aponta para um registro inexistente.';
        rejected.push({ seq, error });
        return;
      }
      accepted.add(seq);
      voided.add(target);
      draft = replay(seq);
      return;
    }
    const error = applyEvent(ruleset, stage, draft, raw, seq);
    if (error) rejected.push({ seq, error });
    else accepted.add(seq);
  });

  const targetReps = stage.kind === 'wall_ball' ? positiveInt(stage.reps) : null;
  const expectedUnits = usesUnits(stage.kind) ? positiveInt(stage.expectedUnits) : null;
  const complete = (targetReps !== null && draft.reps >= targetReps) || (expectedUnits !== null && draft.units >= expectedUnits);
  const state: RaceStationState = draft.closed
    ?? (draft.redo !== null ? 'redo' : !draft.started ? 'waiting' : complete ? 'completed' : 'in_progress');
  // A marca de saída some quando o atleta completa as reps ou a estação encerra (AUTO-DECISION da 1.97).
  const abandoned = draft.abandonSeq !== null && !complete && !draft.closed;

  return {
    stageId: stage.id,
    kind: stage.kind,
    state,
    started: draft.started,
    validReps: draft.reps,
    targetReps,
    noReps: draft.noReps,
    units: draft.units,
    expectedUnits,
    missing: draft.missing,
    roxzoneLeft: draft.roxzoneLeft,
    infractions: draft.infractions,
    penaltySeconds: sumConfirmedPenaltySeconds(draft.infractions),
    rejected,
    voided: [...voided].sort((a, b) => a - b),
    generalOccurrences: draft.generalOccurrences,
    abandoned,
    abandonSeq: abandoned ? draft.abandonSeq : null
  };
};

/**
 * Confere um evento novo antes de ele entrar no log (o servidor recusa o que
 * o motor recusaria): o mesmo cálculo de evaluateRaceStation com o evento no fim.
 */
export const checkRaceEvent = (
  ruleset: RaceRuleset,
  stage: RaceCourseStage,
  events: readonly unknown[],
  next: unknown,
  options: RaceEvaluationOptions = {}
): { ok: true } | { ok: false; error: string } => {
  const result = evaluateRaceStation(ruleset, stage, [...events, next], options);
  const refused = result.rejected.find((item) => item.seq === events.length);
  return refused ? { ok: false, error: `Registro ${events.length + 1}: ${refused.error}` } : { ok: true };
};

export type RaceRunResult = {
  stations: RaceStationResult[];
  infractions: RaceInfraction[];
  penaltySeconds: number;
};

/**
 * As estações da corrida na ordem do percurso. As ocorrências de infrações
 * gerais passam de uma estação para a seguinte (estação fora de ordem: 3 min
 * na 1ª e de novo na 2ª, mesmo em estações diferentes).
 */
export const evaluateRaceRun = (
  ruleset: RaceRuleset,
  attempts: readonly { stage: RaceCourseStage; events: readonly unknown[] }[]
): RaceRunResult => {
  let generalOccurrences: Record<string, number> = {};
  const stations = attempts.map(({ stage, events }) => {
    const result = evaluateRaceStation(ruleset, stage, events, { generalOccurrences });
    generalOccurrences = result.generalOccurrences;
    return result;
  });
  const infractions = stations.flatMap((station) => station.infractions);
  return { stations, infractions, penaltySeconds: sumConfirmedPenaltySeconds(infractions) };
};

// ---------------------------------------------------------------------------
// Tempo oficial
// ---------------------------------------------------------------------------

/** Soma dos segundos das infrações vigentes (`confirmed`); revogada, cancelada, rejeitada e pendente ficam de fora. */
export const sumConfirmedPenaltySeconds = (infractions: readonly Pick<RaceInfraction, 'status' | 'seconds'>[]) => (
  infractions.reduce((total, item) => (item.status === 'confirmed' && Number.isFinite(item.seconds) ? total + item.seconds : total), 0)
);

/**
 * Tempo oficial (D2): tempo bruto + penalidades vigentes. Tempo bruto
 * inválido = sem tempo oficial (null).
 */
export const computeOfficialSeconds = (
  rawSeconds: number | null | undefined,
  infractions: readonly Pick<RaceInfraction, 'kind' | 'status' | 'seconds'>[]
): number | null => {
  if (typeof rawSeconds !== 'number' || !Number.isFinite(rawSeconds) || rawSeconds < 0) return null;
  return rawSeconds + sumConfirmedPenaltySeconds(infractions);
};
