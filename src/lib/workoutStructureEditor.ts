import {
  UNIT_WORDS,
  WORKOUT_STRUCTURE_LIMITS,
  formatWorkoutTime,
  maxSegmentAmount,
  validateWorkoutStructure,
  workUnitWord
} from '@/lib/workoutStructure';
import type {
  AmrapScoreDisplay,
  WorkoutGenerator,
  WorkoutGeneratorKind,
  WorkoutSegment,
  WorkoutSegmentMark,
  WorkoutSegmentUnit,
  WorkoutStructure,
  WorkoutStructureFormat,
  WorkoutTieBreak
} from '@/lib/workoutStructure';

// Construtor da súmula digital (Story 1.46, desenho aprovado em
// docs/design/sumula-digital/). Puro e sem DOM: o construtor do painel, as
// páginas de desenvolvimento e os testes usam as mesmas funções.
//
// O gestor escreve o WOD como no quadro do box, uma linha por movimento com
// três campos: repetições, movimento e carga. O campo de repetições aceita um
// número (50), uma quantidade por round (21-15-9), rounds iguais (3x10) e a
// unidade no fim (500 m, 30 cal). O rascunho guarda o texto digitado; a
// estrutura (lista de segmentos do contrato) é gerada a partir dele e validada
// por validateWorkoutStructure, o mesmo validador do servidor.

export const DEFAULT_PENALTY_SECONDS_PER_REP = 1;
export const DEFAULT_TIME_CAP_SECONDS: Record<'for_time' | 'amrap', number> = { for_time: 600, amrap: 720 };
export const DEFAULT_LOAD_STEP_KG = 2.5;

const LIMITS = WORKOUT_STRUCTURE_LIMITS;
const ENTRY_DEFAULTS = { mode: 'both', marking: 'reps', publish: 'after_review' } as const;
/** Linhas por prova no construtor (o contrato limita as etapas geradas a 30). */
export const MAX_BUILDER_LINES = 10;

// ---------------------------------------------------------------------------
// Rascunho
// ---------------------------------------------------------------------------

export type BuilderLine = {
  /** Identifica a linha no rascunho (os marcos do desempate apontam para ela). */
  key: string;
  /** Texto do campo de repetições: "50", "21-15-9", "3x10", "500 m", "30 cal". */
  reps: string;
  name: string;
  /** Carga em kg como digitada ("43", "42,5"); vazio = sem carga. */
  load: string;
  mark: WorkoutSegmentMark;
  note: string;
};

export type BuilderLift = {
  key: string;
  /** Repetições por tentativa (1 = 1RM). */
  reps: string;
  name: string;
  /** Carga inicial em kg como digitada; vazio = livre. */
  load: string;
  attempts: '1' | '2' | '3' | 'unlimited';
  note: string;
};

/** Etapa da súmula: a linha e o round (a partir de 1). */
export type StepRef = { line: string; round: number };

export type ForTimeTieBreakMode = 'none' | 'split' | 'last_split';
export type AmrapTieBreakMode = 'none' | 'last_round' | 'split';
export type MaxLoadTieBreakMode = 'none' | 'finish_time' | 'fewest_attempts';

export type ForTimeDraft = {
  lines: BuilderLine[];
  /** Rounds quando nenhuma linha tem sequência (com sequência, vale o tamanho dela). */
  rounds: string;
  cap: string;
  penalty: string;
  tieBreak: ForTimeTieBreakMode;
  marks: StepRef[];
};

export type AmrapDraft = {
  lines: BuilderLine[];
  duration: string;
  scoreDisplay: AmrapScoreDisplay;
  tieBreak: AmrapTieBreakMode;
  /** Linha do marco no 1º round (desempate `split`). */
  markLine: string | null;
};

export type MaxLoadDraft = {
  lifts: BuilderLift[];
  /** Janela em MM:SS; vazio = sem janela. */
  window: string;
  order: 'fixed' | 'free';
  scoring: 'sum' | 'best';
  step: string;
  tieBreak: MaxLoadTieBreakMode;
};

export type SheetDraft = {
  format: WorkoutStructureFormat;
  forTime: ForTimeDraft;
  amrap: AmrapDraft;
  maxLoad: MaxLoadDraft;
  /** Próximo número para a chave de uma linha nova. */
  nextKey: number;
};

export type DraftResult = { ok: true; draft: SheetDraft } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Campos
// ---------------------------------------------------------------------------

export type RepsFieldResult =
  | { ok: true; list: number[]; unit: WorkoutSegmentUnit }
  | { ok: false; error: string };
export type TimeInputResult = { ok: true; seconds: number } | { ok: false; error: string };
export type LoadInputResult = { ok: true; kg: number | null } | { ok: false; error: string };

const UNIT_SUFFIX = /\s*(reps?|cal|m)$/i;

/**
 * Lê o campo de repetições: "50", "21-15-9" (também com vírgula ou espaço),
 * "3x10" (3 rounds de 10) e a unidade no fim ("500 m", "30 cal", "21-15-9
 * cal"). De 1 a 9 quantidades, cada uma dentro do limite da unidade.
 */
export const parseRepsField = (text: unknown): RepsFieldResult => {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw) return { ok: false, error: 'informe as repetições' };

  const suffix = raw.match(UNIT_SUFFIX);
  const unitWord = suffix ? suffix[1].toLowerCase() : 'reps';
  const unit: WorkoutSegmentUnit = unitWord === 'cal' ? 'cal' : unitWord === 'm' ? 'm' : 'reps';
  const body = suffix ? raw.slice(0, raw.length - suffix[0].length).trim() : raw;

  const times = body.match(/^(\d{1,2})\s*[xX×]\s*(\d{1,5})$/);
  const list = times
    ? Array.from({ length: Number(times[1]) }, () => Number(times[2]))
    : body.split(/\s*[-,;]\s*|\s+/).map((part) => (/^\d{1,5}$/.test(part) ? Number(part) : Number.NaN));

  if (!body || list.length === 0 || list.some((value) => !Number.isInteger(value))) {
    return { ok: false, error: 'repetições: use 50, 21-15-9, 3x10, 500 m ou 30 cal' };
  }
  if (list.length > LIMITS.maxGeneratorItems) {
    return { ok: false, error: `use de 1 a ${LIMITS.maxGeneratorItems} rounds` };
  }
  const max = maxSegmentAmount(unit);
  if (list.some((value) => value < LIMITS.minReps || value > max)) {
    return { ok: false, error: `cada quantidade vai de ${LIMITS.minReps} a ${max} ${UNIT_WORDS[unit].many}` };
  }
  return { ok: true, list, unit };
};

/** Texto do campo de repetições para uma lista e uma unidade. */
export const formatRepsField = (list: readonly number[], unit: WorkoutSegmentUnit = 'reps') => {
  const body = list.join('-');
  return unit === 'reps' ? body : `${body} ${unit}`;
};

/** "10:00", "1:10:00" ou só os minutos ("12"). */
export const parseTimeInput = (text: unknown): TimeInputResult => {
  const raw = typeof text === 'string' ? text.trim() : '';
  const minutesOnly = raw.match(/^(\d{1,3})$/);
  if (minutesOnly) return { ok: true, seconds: Number(minutesOnly[1]) * 60 };
  const short = raw.match(/^(\d{1,3}):([0-5]\d)$/);
  if (short) return { ok: true, seconds: Number(short[1]) * 60 + Number(short[2]) };
  const long = raw.match(/^(\d{1,2}):([0-5]\d):([0-5]\d)$/);
  if (long) return { ok: true, seconds: Number(long[1]) * 3600 + Number(long[2]) * 60 + Number(long[3]) };
  return { ok: false, error: 'Informe o tempo no formato MM:SS (ex.: 10:00).' };
};

export const formatTimeInput = (seconds: number) => formatWorkoutTime(seconds);

/** Carga em kg: vazio = sem carga; aceita vírgula ou ponto e até duas casas. */
export const parseLoadInput = (text: unknown): LoadInputResult => {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw) return { ok: true, kg: null };
  const message = `a carga vai de ${LIMITS.minLoadKg} a ${LIMITS.maxLoadKg} kg (ex.: 43 ou 42,5)`;
  if (!/^\d{1,3}([.,]\d{1,2})?$/.test(raw)) return { ok: false, error: message };
  const kg = Number(raw.replace(',', '.'));
  if (kg < LIMITS.minLoadKg || kg > LIMITS.maxLoadKg) return { ok: false, error: message };
  return { ok: true, kg };
};

/** 42.5 → "42,5". */
export const formatKg = (kg: number) => String(kg).replace('.', ',');

const workWord = workUnitWord;

/** `fixed` (todas iguais), `descending`, `ascending` ou `null` quando a sequência mistura. */
export const detectGeneratorKind = (reps: readonly number[]): WorkoutGeneratorKind | null => {
  if (reps.length === 0) return null;
  if (reps.every((value) => value === reps[0])) return 'fixed';
  if (reps.every((value, index) => index === 0 || value < reps[index - 1])) return 'descending';
  if (reps.every((value, index) => index === 0 || value > reps[index - 1])) return 'ascending';
  return null;
};

// ---------------------------------------------------------------------------
// Criar e carregar
// ---------------------------------------------------------------------------

const emptyLine = (key: string, reps = ''): BuilderLine => ({ key, reps, name: '', load: '', mark: 'reps', note: '' });
const emptyLift = (key: string): BuilderLift => ({ key, reps: '1', name: '', load: '', attempts: '3', note: '' });

/** Rascunho novo: uma linha vazia por formato; o time cap do formulário, se legível, vira o inicial. */
export const createDraft = (format: WorkoutStructureFormat = 'for_time', options: { timeCap?: string } = {}): SheetDraft => {
  const fromForm = options.timeCap ? parseTimeInput(options.timeCap) : null;
  const initialCap = fromForm?.ok && fromForm.seconds >= LIMITS.minTimeCapSeconds && fromForm.seconds <= LIMITS.maxTimeCapSeconds
    ? formatTimeInput(fromForm.seconds)
    : null;
  return {
    format,
    forTime: {
      lines: [emptyLine('k1')],
      rounds: '1',
      cap: initialCap && format === 'for_time' ? initialCap : formatTimeInput(DEFAULT_TIME_CAP_SECONDS.for_time),
      penalty: String(DEFAULT_PENALTY_SECONDS_PER_REP),
      tieBreak: 'none',
      marks: []
    },
    amrap: {
      lines: [emptyLine('k2')],
      duration: initialCap && format === 'amrap' ? initialCap : formatTimeInput(DEFAULT_TIME_CAP_SECONDS.amrap),
      scoreDisplay: 'rounds_reps',
      tieBreak: 'none',
      markLine: null
    },
    maxLoad: {
      lifts: [emptyLift('k3')],
      window: initialCap && format === 'max_load' ? initialCap : '',
      order: 'fixed',
      scoring: 'sum',
      step: formatKg(DEFAULT_LOAD_STEP_KG),
      tieBreak: 'finish_time'
    },
    nextKey: 4
  };
};

const segmentSignature = (segment: WorkoutSegment) => JSON.stringify([
  segment.name, segment.unit, segment.load ? segment.load.value : null, segment.mark, segment.note
]);

// Segmentos em rounds contíguos (1, 2, 3...), na ordem round a round, e com o
// mesmo movimento em cada posição de todos os rounds. Senão, não cabe em linhas.
const splitRounds = (segments: readonly WorkoutSegment[]): WorkoutSegment[][] | null => {
  const rounds: WorkoutSegment[][] = [];
  for (const segment of segments) {
    if (rounds.length > 0 && segment.round === rounds.length) rounds[rounds.length - 1].push(segment);
    else if (segment.round === rounds.length + 1) rounds.push([segment]);
    else return null;
  }
  if (rounds.length === 0) return null;
  const width = rounds[0].length;
  if (rounds.some((round) => round.length !== width)) return null;
  for (let index = 0; index < width; index += 1) {
    const signature = segmentSignature(rounds[0][index]);
    if (rounds.some((round) => segmentSignature(round[index]) !== signature)) return null;
  }
  return rounds;
};

const NOT_IN_LINES = 'Esta súmula foi montada etapa por etapa e não cabe em linhas de repetições, movimento e carga.';

/**
 * Rascunho a partir de uma estrutura gravada (para editar). Os outros formatos
 * ficam com o rascunho novo. Estrutura que não cabe em linhas (ordem dos
 * movimentos mudando entre rounds, por exemplo) devolve `ok: false`.
 */
export const draftFromStructure = (structure: WorkoutStructure): DraftResult => {
  const draft = createDraft(structure.format);
  let next = draft.nextKey;
  const key = () => `k${next++}`;

  if (structure.format === 'max_load') {
    if (!structure.maxLoad) return { ok: false, error: NOT_IN_LINES };
    const tie = structure.tieBreak?.kind;
    draft.maxLoad = {
      lifts: structure.maxLoad.lifts.map((lift) => ({
        key: key(),
        reps: String(lift.reps),
        name: lift.name,
        load: lift.startLoadKg === null ? '' : formatKg(lift.startLoadKg),
        attempts: lift.maxAttempts === null ? 'unlimited' : (String(lift.maxAttempts) as BuilderLift['attempts']),
        note: lift.note
      })),
      window: structure.timeCapSeconds === null ? '' : formatTimeInput(structure.timeCapSeconds),
      order: structure.maxLoad.order,
      scoring: structure.maxLoad.scoring,
      step: formatKg(structure.maxLoad.loadStepKg),
      tieBreak: tie === 'finish_time' || tie === 'fewest_attempts' ? tie : 'none'
    };
    return { ok: true, draft: { ...draft, nextKey: next } };
  }

  const rounds = splitRounds(structure.segments);
  if (!rounds || (structure.format === 'amrap' && rounds.length !== 1)) return { ok: false, error: NOT_IN_LINES };

  const width = rounds[0].length;
  const lists = Array.from({ length: width }, (_, index) => rounds.map((round) => round[index].reps));
  const constant = lists.map((list) => list.every((value) => value === list[0]));
  const lines: BuilderLine[] = rounds[0].map((segment, index) => ({
    key: key(),
    reps: formatRepsField(constant[index] ? [lists[index][0]] : lists[index], segment.unit),
    name: segment.name,
    load: segment.load ? formatKg(segment.load.value) : '',
    mark: segment.mark,
    note: segment.note
  }));
  const refById = new Map<string, StepRef>();
  rounds.forEach((round, roundIndex) => round.forEach((segment, index) => {
    refById.set(segment.id, { line: lines[index].key, round: roundIndex + 1 });
  }));

  if (structure.format === 'amrap') {
    const tie = structure.tieBreak;
    draft.amrap = {
      lines,
      duration: formatTimeInput(structure.timeCapSeconds ?? DEFAULT_TIME_CAP_SECONDS.amrap),
      scoreDisplay: structure.scoreDisplay ?? 'rounds_reps',
      tieBreak: tie?.kind === 'last_round' ? 'last_round' : tie?.kind === 'split_time' ? 'split' : 'none',
      markLine: tie?.kind === 'split_time' ? refById.get(tie.at)?.line ?? null : null
    };
    return { ok: true, draft: { ...draft, nextKey: next } };
  }

  const tie = structure.tieBreak;
  const marks = tie?.kind === 'split_time' ? [tie.at] : tie?.kind === 'last_split' ? tie.at : [];
  draft.forTime = {
    lines,
    rounds: String(rounds.length),
    cap: formatTimeInput(structure.timeCapSeconds ?? DEFAULT_TIME_CAP_SECONDS.for_time),
    penalty: String(structure.incomplete?.secondsPerRep ?? DEFAULT_PENALTY_SECONDS_PER_REP),
    tieBreak: tie?.kind === 'split_time' ? 'split' : tie?.kind === 'last_split' ? 'last_split' : 'none',
    marks: marks.map((id) => refById.get(id)).filter((ref): ref is StepRef => Boolean(ref))
  };
  return { ok: true, draft: { ...draft, nextKey: next } };
};

// ---------------------------------------------------------------------------
// Edição do rascunho (sempre devolve um rascunho novo)
// ---------------------------------------------------------------------------

export const setDraftFormat = (draft: SheetDraft, format: WorkoutStructureFormat): SheetDraft => ({ ...draft, format });

type LineList = 'forTime' | 'amrap';

export const addLine = (draft: SheetDraft, list: LineList): SheetDraft => {
  const lines = draft[list].lines;
  if (lines.length >= MAX_BUILDER_LINES) return draft;
  // Em For Time a linha nova copia as repetições da anterior (21-15-9 costuma valer para todas).
  const reps = list === 'forTime' && lines.length > 0 ? lines[lines.length - 1].reps : '';
  return {
    ...draft,
    [list]: { ...draft[list], lines: [...lines, emptyLine(`k${draft.nextKey}`, reps)] },
    nextKey: draft.nextKey + 1
  };
};

export type LinePatch = Partial<Pick<BuilderLine, 'reps' | 'name' | 'load' | 'mark' | 'note'>>;

export const updateLine = (draft: SheetDraft, list: LineList, key: string, patch: LinePatch): SheetDraft => ({
  ...draft,
  [list]: { ...draft[list], lines: draft[list].lines.map((line) => (line.key === key ? { ...line, ...patch } : line)) }
});

export const removeLine = (draft: SheetDraft, list: LineList, key: string): SheetDraft => {
  const lines = draft[list].lines;
  if (lines.length <= 1 || !lines.some((line) => line.key === key)) return draft;
  const remaining = lines.filter((line) => line.key !== key);
  if (list === 'forTime') {
    return { ...draft, forTime: { ...draft.forTime, lines: remaining, marks: draft.forTime.marks.filter((mark) => mark.line !== key) } };
  }
  return { ...draft, amrap: { ...draft.amrap, lines: remaining, markLine: draft.amrap.markLine === key ? null : draft.amrap.markLine } };
};

export const moveLine = (draft: SheetDraft, list: LineList, key: string, direction: 'up' | 'down'): SheetDraft => {
  const lines = [...draft[list].lines];
  const index = lines.findIndex((line) => line.key === key);
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= lines.length) return draft;
  [lines[index], lines[target]] = [lines[target], lines[index]];
  return { ...draft, [list]: { ...draft[list], lines } };
};

export const addLift = (draft: SheetDraft): SheetDraft => {
  if (draft.maxLoad.lifts.length >= LIMITS.maxLifts) return draft;
  return {
    ...draft,
    maxLoad: { ...draft.maxLoad, lifts: [...draft.maxLoad.lifts, emptyLift(`k${draft.nextKey}`)] },
    nextKey: draft.nextKey + 1
  };
};

export type LiftPatch = Partial<Pick<BuilderLift, 'reps' | 'name' | 'load' | 'attempts' | 'note'>>;

export const updateLift = (draft: SheetDraft, key: string, patch: LiftPatch): SheetDraft => ({
  ...draft,
  maxLoad: { ...draft.maxLoad, lifts: draft.maxLoad.lifts.map((lift) => (lift.key === key ? { ...lift, ...patch } : lift)) }
});

export const removeLift = (draft: SheetDraft, key: string): SheetDraft => {
  const lifts = draft.maxLoad.lifts;
  if (lifts.length <= 1 || !lifts.some((lift) => lift.key === key)) return draft;
  return { ...draft, maxLoad: { ...draft.maxLoad, lifts: lifts.filter((lift) => lift.key !== key) } };
};

const sameRef = (a: StepRef, b: StepRef) => a.line === b.line && a.round === b.round;

/**
 * Bandeira de desempate numa etapa (For Time). Sem desempate, liga o marco
 * fixo nela; no marco fixo, move a bandeira (ou desliga, se for a mesma); no
 * último marco, liga ou desliga a etapa na lista.
 */
export const toggleStepMark = (draft: SheetDraft, ref: StepRef): SheetDraft => {
  const forTime = draft.forTime;
  const has = forTime.marks.some((mark) => sameRef(mark, ref));
  if (forTime.tieBreak === 'last_split') {
    const marks = has ? forTime.marks.filter((mark) => !sameRef(mark, ref)) : [...forTime.marks, ref];
    return { ...draft, forTime: { ...forTime, marks } };
  }
  if (forTime.tieBreak === 'split' && has) return { ...draft, forTime: { ...forTime, tieBreak: 'none', marks: [] } };
  return { ...draft, forTime: { ...forTime, tieBreak: 'split', marks: [ref] } };
};

export const setForTimeTieBreak = (draft: SheetDraft, mode: ForTimeTieBreakMode): SheetDraft => ({
  ...draft,
  forTime: {
    ...draft.forTime,
    tieBreak: mode,
    // Do último marco para o marco fixo fica só a primeira bandeira; sem desempate, nenhuma.
    marks: mode === 'none' ? [] : mode === 'split' ? draft.forTime.marks.slice(0, 1) : draft.forTime.marks
  }
});

// ---------------------------------------------------------------------------
// Análise: etapas, lista de conferência e estrutura gerada
// ---------------------------------------------------------------------------

export type BuilderStep = {
  /** "linha-round", estável enquanto a linha existir. */
  key: string;
  ref: StepRef;
  lineIndex: number;
  reps: number;
  unit: WorkoutSegmentUnit;
  name: string;
  loadKg: number | null;
  marked: boolean;
};

export type ChecklistTone = 'ok' | 'error' | 'muted';
export type ChecklistItem = { tone: ChecklistTone; text: string };

export type DraftAnalysis = {
  format: WorkoutStructureFormat;
  items: ChecklistItem[];
  /** Só os itens com problema, na ordem da lista. */
  problems: string[];
  /** A estrutura gerada, já validada; null enquanto houver problema. */
  structure: WorkoutStructure | null;
  /** Etapas da súmula (For Time e AMRAP), na ordem em que o judge marca. */
  steps: BuilderStep[];
  /** Rounds em vigor (For Time). */
  rounds: number;
  /** Rounds definidos pela sequência de repetições; null quando vale o campo "Rounds". */
  derivedRounds: number | null;
  /** Problema por linha (chave da linha → mensagem), para marcar o campo. */
  lineProblems: Record<string, string>;
};

type LineReading = {
  line: BuilderLine;
  index: number;
  reps: RepsFieldResult;
  load: LoadInputResult;
  name: string;
};

const readLines = (lines: readonly BuilderLine[]): LineReading[] => lines.map((line, index) => ({
  line,
  index,
  reps: parseRepsField(line.reps),
  load: parseLoadInput(line.load),
  name: line.name.trim()
}));

const lineChecks = (readings: readonly LineReading[], items: ChecklistItem[], lineProblems: Record<string, string>) => {
  for (const reading of readings) {
    const label = `Linha ${reading.index + 1}`;
    const problems: string[] = [];
    if (!reading.name) problems.push('informe o movimento');
    else if (reading.name.length > LIMITS.maxNameLength) problems.push(`o movimento tem até ${LIMITS.maxNameLength} caracteres`);
    if (!reading.reps.ok) problems.push(reading.reps.error);
    if (!reading.load.ok) problems.push(reading.load.error);
    if (problems.length > 0) {
      const text = `${label}: ${problems.join('; ')}.`;
      items.push({ tone: 'error', text });
      lineProblems[reading.line.key] = text;
    }
  }
};

const buildGenerator = (lists: readonly number[][], units: readonly WorkoutSegmentUnit[]): WorkoutGenerator | null => {
  if (lists.length === 0 || units.some((unit) => unit !== 'reps')) return null;
  const first = JSON.stringify(lists[0]);
  if (lists.some((list) => JSON.stringify(list) !== first)) return null;
  const kind = detectGeneratorKind(lists[0]);
  return kind ? { kind, reps: [...lists[0]] } : null;
};

const finish = (analysis: DraftAnalysis, candidate: WorkoutStructure | null): DraftAnalysis => {
  const items = [...analysis.items];
  let structure: WorkoutStructure | null = null;
  if (candidate && !items.some((item) => item.tone === 'error')) {
    const checked = validateWorkoutStructure(candidate);
    if (checked.ok) structure = checked.structure;
    else items.push({ tone: 'error', text: checked.error });
  }
  return {
    ...analysis,
    items,
    problems: items.filter((item) => item.tone === 'error').map((item) => item.text),
    structure
  };
};

const timeCheck = (text: string, label: string, items: ChecklistItem[]) => {
  const parsed = parseTimeInput(text);
  if (!parsed.ok || parsed.seconds < LIMITS.minTimeCapSeconds || parsed.seconds > LIMITS.maxTimeCapSeconds) {
    // 5999 s = 99:59, o maior tempo que o campo legado time_cap guarda em MM:SS.
    items.push({ tone: 'error', text: `${label}: use MM:SS entre ${formatTimeInput(LIMITS.minTimeCapSeconds)} e 99:59.` });
    return null;
  }
  items.push({ tone: 'ok', text: `${label}: ${formatTimeInput(parsed.seconds)}` });
  return parsed.seconds;
};

const analyzeForTime = (draft: SheetDraft): DraftAnalysis => {
  const ft = draft.forTime;
  const items: ChecklistItem[] = [];
  const lineProblems: Record<string, string> = {};
  const readings = readLines(ft.lines);
  lineChecks(readings, items, lineProblems);

  const lengths = [...new Set(readings.flatMap((reading) => (reading.reps.ok && reading.reps.list.length > 1 ? [reading.reps.list.length] : [])))];
  if (lengths.length > 1) {
    items.push({ tone: 'error', text: `As sequências de repetições têm tamanhos diferentes (${lengths.join(' e ')} rounds). Use o mesmo número de rounds em todas as linhas.` });
  }
  const derivedRounds = lengths.length > 0 ? Math.max(...lengths) : null;
  let rounds = derivedRounds ?? 1;
  if (derivedRounds === null) {
    const typed = /^\d{1,2}$/.test(ft.rounds.trim()) ? Number(ft.rounds.trim()) : Number.NaN;
    if (!(typed >= LIMITS.minRound && typed <= LIMITS.maxRound)) {
      items.push({ tone: 'error', text: `Rounds: de ${LIMITS.minRound} a ${LIMITS.maxRound}.` });
    } else {
      rounds = typed;
    }
  }

  const steps: BuilderStep[] = [];
  for (let round = 1; round <= rounds; round += 1) {
    for (const reading of readings) {
      if (!reading.reps.ok) continue;
      const list = reading.reps.list;
      const reps = list.length === 1 ? list[0] : list[round - 1];
      if (!reps) continue;
      const ref = { line: reading.line.key, round };
      steps.push({
        key: `${reading.line.key}-${round}`,
        ref,
        lineIndex: reading.index,
        reps,
        unit: reading.reps.unit,
        name: reading.name || 'Sem nome',
        loadKg: reading.load.ok ? reading.load.kg : null,
        marked: ft.tieBreak !== 'none' && ft.marks.some((mark) => sameRef(mark, ref))
      });
    }
  }

  const cap = timeCheck(ft.cap, 'Time cap', items);
  const penaltyText = ft.penalty.trim();
  const penalty = /^\d{1,2}$/.test(penaltyText) ? Number(penaltyText) : Number.NaN;
  if (!(penalty >= LIMITS.minPenaltySecondsPerRep && penalty <= LIMITS.maxPenaltySecondsPerRep)) {
    items.push({ tone: 'error', text: `Penalidade: de ${LIMITS.minPenaltySecondsPerRep} a ${LIMITS.maxPenaltySecondsPerRep} segundos inteiros por repetição.` });
  }

  const total = steps.reduce((sum, step) => sum + step.reps, 0);
  if (steps.length > LIMITS.maxSegments) {
    items.push({ tone: 'error', text: `${steps.length} etapas: o limite é ${LIMITS.maxSegments}. Reduza rounds ou movimentos.` });
  } else if (steps.length > 0) {
    items.push({ tone: 'ok', text: `${steps.length} ${steps.length === 1 ? 'etapa' : 'etapas'} na súmula, ${total} ${workWord(steps.map((step) => step.unit), total)}` });
  }

  const markedSteps = steps.filter((step) => step.marked);
  if (ft.tieBreak !== 'none' && markedSteps.length === 0) {
    items.push({ tone: 'error', text: 'Desempate: toque na bandeira da etapa em que o judge anota o tempo.' });
  } else if (ft.tieBreak === 'none') {
    items.push({ tone: 'muted', text: 'Sem desempate (opcional)' });
  } else {
    items.push({ tone: 'ok', text: ft.tieBreak === 'split' ? 'Desempate no marco escolhido' : `Desempate no último marco concluído (${markedSteps.length} ${markedSteps.length === 1 ? 'marco' : 'marcos'})` });
  }

  const analysis: DraftAnalysis = {
    format: 'for_time', items, problems: [], structure: null, steps, rounds, derivedRounds, lineProblems
  };
  if (cap === null || Number.isNaN(penalty) || steps.length === 0) return finish(analysis, null);

  const segments: WorkoutSegment[] = steps.map((step, index) => {
    const reading = readings[step.lineIndex];
    return {
      id: `s${index + 1}`,
      round: step.ref.round,
      name: reading.name,
      reps: step.reps,
      unit: step.unit,
      load: step.loadKg === null ? null : { value: step.loadKg, unit: 'kg' },
      note: reading.line.note.trim(),
      required: true,
      // Metros: o judge só conclui o bloco.
      mark: step.unit === 'm' ? 'end' : reading.line.mark
    };
  });
  const idByKey = new Map(steps.map((step, index) => [step.key, `s${index + 1}`]));
  const markedIds = markedSteps.map((step) => idByKey.get(step.key) as string);
  let tieBreak: WorkoutTieBreak | null = null;
  if (ft.tieBreak === 'split' && markedIds.length > 0) tieBreak = { kind: 'split_time', at: markedIds[0], order: 'asc' };
  if (ft.tieBreak === 'last_split' && markedIds.length > 0) tieBreak = { kind: 'last_split', at: markedIds, order: 'asc' };

  const lists = readings.map((reading) => (reading.reps.ok
    ? (reading.reps.list.length === 1 ? Array.from({ length: rounds }, () => (reading.reps.ok ? reading.reps.list[0] : 0)) : reading.reps.list)
    : []));
  const generator = buildGenerator(lists, steps.map((step) => step.unit));

  return finish(analysis, {
    version: 2,
    format: 'for_time',
    totalReps: total,
    timeCapSeconds: cap,
    incomplete: { rule: 'penalty_per_rep', secondsPerRep: penalty, base: 'time_cap' },
    tieBreak,
    generator,
    customized: generator === null,
    entry: { ...ENTRY_DEFAULTS },
    segments,
    maxLoad: null,
    scoreDisplay: null
  });
};

const analyzeAmrap = (draft: SheetDraft): DraftAnalysis => {
  const am = draft.amrap;
  const items: ChecklistItem[] = [];
  const lineProblems: Record<string, string> = {};
  const readings = readLines(am.lines);
  lineChecks(readings, items, lineProblems);
  for (const reading of readings) {
    if (reading.reps.ok && reading.reps.list.length > 1 && !lineProblems[reading.line.key]) {
      const text = `Linha ${reading.index + 1}: no AMRAP use uma quantidade por movimento (o round se repete).`;
      items.push({ tone: 'error', text });
      lineProblems[reading.line.key] = text;
    }
  }
  const steps: BuilderStep[] = readings.flatMap((reading) => (reading.reps.ok && reading.reps.list.length === 1 ? [{
    key: `${reading.line.key}-1`,
    ref: { line: reading.line.key, round: 1 },
    lineIndex: reading.index,
    reps: reading.reps.list[0],
    unit: reading.reps.unit,
    name: reading.name || 'Sem nome',
    loadKg: reading.load.ok ? reading.load.kg : null,
    marked: am.tieBreak === 'split' && am.markLine === reading.line.key
  }] : []));

  const duration = timeCheck(am.duration, 'Duração', items);
  const perRound = steps.reduce((sum, step) => sum + step.reps, 0);
  if (steps.length > 0) items.push({ tone: 'ok', text: `${perRound} ${workWord(steps.map((step) => step.unit), perRound)} por round` });
  if (am.tieBreak === 'split' && !steps.some((step) => step.marked)) {
    items.push({ tone: 'error', text: 'Desempate: escolha o movimento do 1º round em que o judge anota o tempo.' });
  } else {
    items.push(am.tieBreak === 'none' ? { tone: 'muted', text: 'Sem desempate (opcional)' } : { tone: 'ok', text: 'Desempate definido' });
  }

  const analysis: DraftAnalysis = {
    format: 'amrap', items, problems: [], structure: null, steps, rounds: 1, derivedRounds: null, lineProblems
  };
  if (duration === null || steps.length === 0) return finish(analysis, null);

  const segments: WorkoutSegment[] = steps.map((step, index) => {
    const reading = readings[step.lineIndex];
    return {
      id: `s${index + 1}`,
      round: 1,
      name: reading.name,
      reps: step.reps,
      unit: step.unit,
      load: step.loadKg === null ? null : { value: step.loadKg, unit: 'kg' },
      note: reading.line.note.trim(),
      required: true,
      mark: step.unit === 'm' ? 'end' : reading.line.mark
    };
  });
  const markedIndex = steps.findIndex((step) => step.marked);
  const tieBreak: WorkoutTieBreak | null = am.tieBreak === 'last_round'
    ? { kind: 'last_round', order: 'asc' }
    : am.tieBreak === 'split' && markedIndex >= 0 ? { kind: 'split_time', at: `s${markedIndex + 1}`, order: 'asc' } : null;
  const generator = buildGenerator(steps.map((step) => [step.reps]), steps.map((step) => step.unit));

  return finish(analysis, {
    version: 2,
    format: 'amrap',
    totalReps: perRound,
    timeCapSeconds: duration,
    incomplete: null,
    tieBreak,
    generator,
    customized: generator === null,
    entry: { ...ENTRY_DEFAULTS },
    segments,
    maxLoad: null,
    scoreDisplay: am.scoreDisplay
  });
};

const analyzeMaxLoad = (draft: SheetDraft): DraftAnalysis => {
  const ml = draft.maxLoad;
  const items: ChecklistItem[] = [];
  const lineProblems: Record<string, string> = {};

  const lifts = ml.lifts.map((lift, index) => {
    const problems: string[] = [];
    const name = lift.name.trim();
    if (!name) problems.push('informe o movimento');
    else if (name.length > LIMITS.maxNameLength) problems.push(`o movimento tem até ${LIMITS.maxNameLength} caracteres`);
    const repsText = lift.reps.trim();
    const reps = /^\d{1,2}$/.test(repsText) ? Number(repsText) : Number.NaN;
    if (!(reps >= LIMITS.minLiftReps && reps <= LIMITS.maxLiftReps)) problems.push(`as repetições por tentativa vão de ${LIMITS.minLiftReps} a ${LIMITS.maxLiftReps}`);
    const load = parseLoadInput(lift.load);
    if (!load.ok) problems.push(`a carga inicial vai de ${LIMITS.minLoadKg} a ${LIMITS.maxLoadKg} kg`);
    if (problems.length > 0) {
      const text = `Linha ${index + 1}: ${problems.join('; ')}.`;
      items.push({ tone: 'error', text });
      lineProblems[lift.key] = text;
    }
    return {
      id: `l${index + 1}`,
      name,
      reps,
      maxAttempts: lift.attempts === 'unlimited' ? null : Number(lift.attempts),
      startLoadKg: load.ok ? load.kg : null,
      note: lift.note.trim()
    };
  });
  if (Object.keys(lineProblems).length === 0) {
    items.push({ tone: 'ok', text: `${lifts.length} ${lifts.length === 1 ? 'movimento' : 'movimentos'} de carga` });
  }

  let window: number | null = null;
  let windowOk = true;
  if (ml.window.trim()) {
    window = timeCheck(ml.window, 'Janela', items);
    windowOk = window !== null;
  } else {
    items.push({ tone: 'ok', text: 'Sem janela de tempo' });
  }

  const stepText = ml.step.trim().replace(',', '.');
  const step = /^\d{1,2}(\.\d{1,2})?$/.test(stepText) ? Number(stepText) : Number.NaN;
  if (!(step >= LIMITS.minLoadStepKg && step <= LIMITS.maxLoadStepKg)) {
    items.push({ tone: 'error', text: `Incremento: de ${formatKg(LIMITS.minLoadStepKg)} a ${LIMITS.maxLoadStepKg} kg.` });
  } else {
    items.push({ tone: 'ok', text: `Incremento de ${formatKg(step)} kg` });
  }
  items.push(ml.tieBreak === 'none'
    ? { tone: 'muted', text: 'Sem desempate (opcional)' }
    : { tone: 'ok', text: ml.tieBreak === 'finish_time' && window === null ? 'Desempate por tempo, medido do início da prova' : 'Desempate definido' });

  const analysis: DraftAnalysis = {
    format: 'max_load', items, problems: [], structure: null, steps: [], rounds: 1, derivedRounds: null, lineProblems
  };
  if (!windowOk || Number.isNaN(step)) return finish(analysis, null);

  return finish(analysis, {
    version: 2,
    format: 'max_load',
    totalReps: 0,
    timeCapSeconds: window,
    incomplete: null,
    tieBreak: ml.tieBreak === 'none' ? null : { kind: ml.tieBreak, order: 'asc' },
    generator: null,
    customized: true,
    entry: { ...ENTRY_DEFAULTS },
    segments: [],
    maxLoad: { lifts, order: ml.order, scoring: ml.scoring, loadStepKg: step },
    scoreDisplay: null
  });
};

/** Etapas, lista de conferência e a estrutura gerada para o formato escolhido. */
export const analyzeDraft = (draft: SheetDraft): DraftAnalysis => {
  if (draft.format === 'amrap') return analyzeAmrap(draft);
  if (draft.format === 'max_load') return analyzeMaxLoad(draft);
  return analyzeForTime(draft);
};

// ---------------------------------------------------------------------------
// Textos a partir da estrutura
// ---------------------------------------------------------------------------

/** Primeira mensagem de validação em português, ou `null` quando a estrutura é válida. */
export const describeStructureProblem = (structure: WorkoutStructure): string | null => {
  const result = validateWorkoutStructure(structure);
  return result.ok ? null : result.error;
};

export type RulePart = { text: string; strong?: boolean };

const plain = (text: string): RulePart => ({ text });
const strong = (text: string): RulePart => ({ text, strong: true });

const segmentLabel = (segment: WorkoutSegment, withRound: boolean) => (
  `${segment.reps} ${segment.unit === 'reps' ? '' : `${UNIT_WORDS[segment.unit].short} de `}${segment.name}${withRound ? ` do round ${segment.round}` : ''}`
);

/** A regra da prova em uma frase, para o gestor conferir (partes em destaque marcadas). */
export const describeStructureRule = (structure: WorkoutStructure): RulePart[] => {
  if (structure.format === 'max_load' && structure.maxLoad) {
    const ml = structure.maxLoad;
    const limits = ml.lifts.map((lift) => lift.maxAttempts);
    const attempts = limits.every((value) => value === null)
      ? 'tentativas ilimitadas'
      : limits.every((value) => value === limits[0])
        ? `até ${limits[0]} ${limits[0] === 1 ? 'tentativa' : 'tentativas'} por movimento`
        : 'o número de tentativas de cada movimento';
    const parts: RulePart[] = [plain('Cada atleta tem '), strong(attempts), plain(', na ordem '), strong(ml.order === 'fixed' ? 'fixa' : 'livre')];
    if (structure.timeCapSeconds !== null) {
      parts.push(plain(', dentro de '), strong(formatTimeInput(structure.timeCapSeconds)), plain(' (levantamento concluído depois da janela não conta)'));
    }
    parts.push(plain('. Vale a '), strong(ml.scoring === 'sum' ? 'maior carga válida de cada movimento, somadas' : 'maior carga válida entre os movimentos'), plain('.'));
    const tie = structure.tieBreak?.kind;
    parts.push(plain(tie === 'finish_time'
      ? ' Em caso de empate, vence quem terminou o último movimento em menos tempo.'
      : tie === 'fewest_attempts' ? ' Em caso de empate, vence quem usou menos tentativas.' : ' Sem desempate: empates dividem a posição.'));
    return parts;
  }

  const units = structure.segments.map((segment) => segment.unit);
  const cap = formatTimeInput(structure.timeCapSeconds ?? 0);

  if (structure.format === 'amrap') {
    const per = structure.totalReps;
    const parts: RulePart[] = [
      plain('Vence quem somar mais '), plain(workWord(units, 2)), plain(' em '), strong(cap),
      plain('. Cada round tem '), strong(`${per} ${workWord(units, per)}`), plain('. O score aparece como '),
      strong(structure.scoreDisplay === 'total' ? 'o total' : '"7 rounds + 12"'),
      plain(' e, no ranking, vale '), strong(`7 × ${per} + 12 = ${7 * per + 12}`), plain('.')
    ];
    const tie = structure.tieBreak;
    if (tie?.kind === 'last_round') parts.push(plain(' Em caso de empate, vence quem fechou o último round completo em menos tempo.'));
    else if (tie?.kind === 'split_time') {
      const segment = structure.segments.find((item) => item.id === tie.at);
      parts.push(plain(' Em caso de empate, vence o menor tempo ao concluir '), strong(segment ? segmentLabel(segment, false) : 'o marco'), plain(' no 1º round.'));
    } else parts.push(plain(' Sem desempate: empates dividem a posição.'));
    return parts;
  }

  const total = structure.totalReps;
  const penalty = structure.incomplete?.secondsPerRep ?? 0;
  const example = Math.max(1, Math.min(8, total - 1));
  const unitOne = workWord(units, 1);
  const parts: RulePart[] = [
    plain('Quem terminar as '), strong(`${total} ${workWord(units, total)}`), plain(' antes de '), strong(cap),
    plain(' fica com o tempo real. Quem não terminar fica com '), strong(cap), plain(' mais '), strong(`${penalty} s`),
    plain(` por ${unitOne} que faltou`)
  ];
  if (total > 1) parts.push(plain(` (ex.: ${total - example} de ${total} vira ${formatTimeInput((structure.timeCapSeconds ?? 0) + example * penalty)})`));
  parts.push(plain('.'));
  if (penalty === 0) parts.push(plain(' Com 0 s, quem não terminou empata com quem terminou no cap.'));
  const tie = structure.tieBreak;
  const rounds = new Set(structure.segments.map((segment) => segment.round)).size;
  if (tie?.kind === 'split_time') {
    const segment = structure.segments.find((item) => item.id === tie.at);
    parts.push(plain(' Em caso de empate, vence o menor tempo ao concluir '), strong(segment ? segmentLabel(segment, rounds > 1) : 'o marco'), plain('.'));
  } else if (tie?.kind === 'last_split') {
    parts.push(plain(' Em caso de empate, vence o menor tempo no '), strong(`último marco concluído (${tie.at.length} ${tie.at.length === 1 ? 'marco' : 'marcos'})`), plain('.'));
  } else {
    parts.push(plain(' Sem desempate: empates dividem a posição.'));
  }
  return parts;
};

/** "For Time · 6 etapas · 90 repetições · cap 10:00" (selo da lista e resumo do formulário). */
export const summarizeStructure = (structure: WorkoutStructure) => {
  if (structure.format === 'max_load') {
    const count = structure.maxLoad?.lifts.length ?? 0;
    const window = structure.timeCapSeconds === null ? 'sem janela' : `janela ${formatTimeInput(structure.timeCapSeconds)}`;
    return `Carga máxima · ${count} ${count === 1 ? 'movimento' : 'movimentos'} · ${structure.maxLoad?.scoring === 'best' ? 'maior carga' : 'soma das cargas'} · ${window}`;
  }
  const units = structure.segments.map((segment) => segment.unit);
  const total = structure.totalReps;
  if (structure.format === 'amrap') {
    return `AMRAP · ${structure.segments.length} ${structure.segments.length === 1 ? 'movimento' : 'movimentos'} · ${total} ${workWord(units, total)} por round · ${formatTimeInput(structure.timeCapSeconds ?? 0)}`;
  }
  const count = structure.segments.length;
  return `For Time · ${count} ${count === 1 ? 'etapa' : 'etapas'} · ${total} ${workWord(units, total)} · cap ${formatTimeInput(structure.timeCapSeconds ?? 0)}`;
};
