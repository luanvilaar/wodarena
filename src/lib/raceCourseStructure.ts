import { resolveRaceStationKind, type RaceStationKind } from '@/lib/raceRules';
import type { CourseStage, RaceConferenceKind } from '@/types';

// Estrutura da prova Fitness Race (Story 1.100, D33 em
// docs/design/fitness-race-sumula/DECISOES.md). Puro: sem React, sem Supabase e
// sem fetch. O organizador monta o percurso por categoria; cada estação tem um
// tipo de conferência (sugerido pelo nome, ajustável) e uma meta (trechos,
// voltas ou reps). O editor do percurso e o snapshot da súmula
// (toRaceSnapshotStages) leem o tipo e a meta por aqui, para os dois mostrarem
// a mesma coisa.

/** Os cinco tipos, na ordem do seletor do editor. */
export const RACE_CONFERENCE_KINDS: readonly RaceConferenceKind[] = ['ergometer', 'sled', 'sections', 'reps', 'generic'];

export const RACE_CONFERENCE_KIND_LABELS: Record<RaceConferenceKind, string> = {
  ergometer: 'Ergômetro',
  sled: 'Trenó',
  sections: 'Seções',
  reps: 'Reps',
  generic: 'Genérica'
};

/** Faixa de `units` (AUTO-DECISION da Story 1.100: larga o bastante para voltas por mapa do local, só barra lixo). */
export const RACE_STAGE_UNITS_MIN = 1;
export const RACE_STAGE_UNITS_MAX = 200;

/** Trecho do trenó: sem `units`, a meta do trenó é a distância dividida por este valor (gate da 1.93, REL-001). */
export const RACE_SLED_SECTION_METERS = 12.5;

const KIND_SET = new Set<string>(RACE_CONFERENCE_KINDS);

export const isRaceConferenceKind = (value: unknown): value is RaceConferenceKind => typeof value === 'string' && KIND_SET.has(value);

/** Tipos em que a meta é um número de trechos, voltas ou seções (`units`). */
export const conferenceKindUsesUnits = (kind: RaceConferenceKind | RaceStationKind) => kind === 'sled' || kind === 'sections';

/** `reps` do organizador é a contagem do motor (`wall_ball`); os outros tipos têm o mesmo nome dos dois lados. */
export const toEngineStationKind = (kind: RaceConferenceKind): RaceStationKind => (kind === 'reps' ? 'wall_ball' : kind);

/** Tradução de volta: `wall_ball` do motor é `reps` para o organizador. */
export const toRaceConferenceKind = (kind: RaceStationKind): RaceConferenceKind => (kind === 'wall_ball' ? 'reps' : kind);

/** `units` válido (inteiro de 1 a 200) ou undefined. Nunca lança. */
export const parseRaceStageUnits = (value: unknown): number | undefined => (
  typeof value === 'number' && Number.isInteger(value) && value >= RACE_STAGE_UNITS_MIN && value <= RACE_STAGE_UNITS_MAX ? value : undefined
);

/**
 * Tipo sugerido pelo nome (ou pelo id da biblioteca): só os 8 nomes de
 * FITNESS_RACING_STATION_LIBRARY são reconhecidos (Wall Balls vira `reps`); o
 * resto vira `generic`. Corrida não tem tipo de conferência (null).
 */
export const suggestRaceConferenceKind = (stage: Pick<CourseStage, 'id' | 'name' | 'type'>): RaceConferenceKind | null => {
  if (stage.type === 'run') return null;
  return toRaceConferenceKind(resolveRaceStationKind({ id: stage.id || '', name: stage.name || '', type: stage.type }));
};

/** Metros de uma distância do percurso ("50m", "50 m", "1km"). null se não der para ler. */
const metersOf = (distance: unknown) => {
  if (typeof distance !== 'string') return null;
  const match = distance.trim().toLowerCase().match(/^(\d+(?:[.,]\d+)?)\s*(m|km)$/);
  if (!match) return null;
  const value = Number(match[1].replace(',', '.')) * (match[2] === 'km' ? 1000 : 1);
  return Number.isFinite(value) && value > 0 ? value : null;
};

/** Meta do trenó sem `units`: distância / 12,5 m, só quando a conta fecha num número inteiro. */
const sledUnitsOfDistance = (distance: unknown) => {
  const meters = metersOf(distance);
  if (meters === null) return undefined;
  const units = meters / RACE_SLED_SECTION_METERS;
  return Number.isInteger(units) && units > 0 ? units : undefined;
};

type StageLike = {
  id: string;
  name: string;
  type: CourseStage['type'];
  distance?: unknown;
  conferenceKind?: unknown;
  units?: unknown;
};

export type RaceStageConference = { kind: RaceStationKind; expectedUnits?: number };

/**
 * Tipo do motor e meta de uma etapa do percurso (AC5): `conferenceKind` válido
 * do organizador (reps vira wall_ball) ou, sem ele, a sugestão pelo nome. A
 * meta sai de `units` no trenó e nas seções; sem `units` válido, o trenó usa a
 * distância e as seções ficam sem meta. Corrida é sempre `generic` e ignora os
 * campos. Valor inválido é ignorado, nunca lança.
 */
export const resolveRaceStageConference = (stage: StageLike): RaceStageConference => {
  if (stage.type === 'run') return { kind: 'generic' };
  const conference = isRaceConferenceKind(stage.conferenceKind)
    ? stage.conferenceKind
    : suggestRaceConferenceKind({ id: stage.id, name: stage.name, type: stage.type }) ?? 'generic';
  const kind = toEngineStationKind(conference);
  if (!conferenceKindUsesUnits(kind)) return { kind };
  const units = parseRaceStageUnits(stage.units);
  const expectedUnits = units ?? (kind === 'sled' ? sledUnitsOfDistance(stage.distance) : undefined);
  return expectedUnits !== undefined ? { kind, expectedUnits } : { kind };
};

const unitNoun = (kind: RaceStationKind, count: number) => {
  if (kind === 'sled') return count === 1 ? 'trecho' : 'trechos';
  return count === 1 ? 'volta' : 'voltas';
};

/**
 * Rótulo do tipo e da meta para a lista de etapas do editor (AC4): "Trenó · 4
 * trechos", "Seções · 8 voltas", "Reps · 100", "Ergômetro", "Genérica". O
 * mesmo tipo e a mesma meta que a súmula vai usar. Corrida: null.
 */
export const describeRaceStageConference = (stage: Pick<CourseStage, 'id' | 'name' | 'type' | 'distance' | 'reps' | 'conferenceKind' | 'units'>): string | null => {
  if (stage.type === 'run') return null;
  const { kind, expectedUnits } = resolveRaceStageConference(stage);
  const label = RACE_CONFERENCE_KIND_LABELS[toRaceConferenceKind(kind)];
  if (conferenceKindUsesUnits(kind) && expectedUnits !== undefined) return `${label} · ${expectedUnits} ${unitNoun(kind, expectedUnits)}`;
  if (kind === 'wall_ball' && typeof stage.reps === 'number' && Number.isInteger(stage.reps) && stage.reps > 0) return `${label} · ${stage.reps}`;
  return label;
};

/**
 * Validação do editor (AC3): tipo `reps` exige repetições; `units`, quando
 * informado no trenó ou nas seções, é inteiro de 1 a 200. Mensagem em
 * português ou null. Corrida não tem o que validar.
 */
export const validateRaceStageConference = (input: {
  type: CourseStage['type'];
  conferenceKind: RaceConferenceKind;
  units?: number;
  reps?: number;
}): string | null => {
  if (input.type === 'run') return null;
  if (input.conferenceKind === 'reps' && !(typeof input.reps === 'number' && Number.isInteger(input.reps) && input.reps > 0)) {
    return 'Informe as repetições: o tipo de conferência Reps precisa da meta de repetições.';
  }
  if (conferenceKindUsesUnits(input.conferenceKind) && input.units !== undefined && parseRaceStageUnits(input.units) === undefined) {
    return `Trechos / voltas: informe um número inteiro de ${RACE_STAGE_UNITS_MIN} a ${RACE_STAGE_UNITS_MAX}.`;
  }
  return null;
};

/**
 * Etapa pronta para gravar com o tipo e a meta do editor: estação leva o
 * `conferenceKind` e, no trenó e nas seções, `units` válido; corrida e os
 * outros tipos saem sem os campos.
 */
export const withRaceStageConference = (
  stage: CourseStage,
  conference: { conferenceKind: RaceConferenceKind; units?: number }
): CourseStage => {
  const rest: CourseStage = { ...stage };
  delete rest.conferenceKind;
  delete rest.units;
  if (stage.type === 'run') return rest;
  const units = conferenceKindUsesUnits(conference.conferenceKind) ? parseRaceStageUnits(conference.units) : undefined;
  return { ...rest, conferenceKind: conference.conferenceKind, ...(units !== undefined ? { units } : {}) };
};

type OrderedStage = { id: string; type: CourseStage['type']; orderIndex?: unknown };

/**
 * A estação que fecha o tempo da prova (Story 1.101, D34): a última etapa
 * `type: 'station'` do percurso, pela ordem `orderIndex` (sem ele, a posição na
 * lista). Corridas depois dela, como a corrida final até a linha, não contam
 * (D1: a corrida final é protocolo). Lê só `id`, `type` e `orderIndex`, então
 * snapshot antigo, sem os campos da 1.100, funciona. null sem estação.
 */
export const lastRaceStation = <T extends OrderedStage>(stages: readonly T[]): T | null => {
  const ordered = stages
    .map((stage, index) => ({ stage, order: typeof stage.orderIndex === 'number' && Number.isFinite(stage.orderIndex) ? stage.orderIndex : index, index }))
    .sort((a, b) => a.order - b.order || a.index - b.index);
  for (let position = ordered.length - 1; position >= 0; position -= 1) {
    if (ordered[position].stage.type === 'station') return ordered[position].stage;
  }
  return null;
};

// Mesmo slug que o motor usa para reconhecer a estação pelo nome (slugify em
// raceRules.ts, que não é exportado: o motor fica intocado, D29/D36).
const slugifyStationName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/** Forma aceita de uma chave de estação (na URL e na leitura `station_board`). */
const STATION_KEY_PATTERN = /^[a-z0-9-]{1,120}$/;

export const isRaceStationKey = (value: unknown): value is string => typeof value === 'string' && STATION_KEY_PATTERN.test(value);

/**
 * Identidade da estação entre categorias (Story 1.102, AC2; D33, D35): o nome
 * normalizado pelo mesmo slug do motor ("Sled Push" vira `sled-push` em
 * qualquer categoria, embora o id de estação personalizada mude por
 * categoria). `occurrence` é a vez em que o nome aparece no percurso da mesma
 * categoria: a 2ª vira `-2`, a 3ª `-3`. Nome sem letra nem número vira
 * `estacao`. Puro.
 */
export const raceStationKey = (name: string, occurrence = 1) => {
  const base = slugifyStationName(typeof name === 'string' ? name : '') || 'estacao';
  return Number.isInteger(occurrence) && occurrence > 1 ? `${base}-${occurrence}` : base;
};

type KeyedStage = OrderedStage & { name: string };

/**
 * Chave de cada estação de um percurso ({ id da estação: chave }), pela ordem
 * do percurso, com o sufixo do nome repetido (raceStationKey). Corridas ficam
 * de fora.
 */
export const raceStationKeysOf = (stages: readonly KeyedStage[]): Map<string, string> => {
  const ordered = stages
    .map((stage, index) => ({ stage, order: typeof stage.orderIndex === 'number' && Number.isFinite(stage.orderIndex) ? stage.orderIndex : index, index }))
    .sort((a, b) => a.order - b.order || a.index - b.index);
  const seen = new Map<string, number>();
  const keys = new Map<string, string>();
  for (const { stage } of ordered) {
    if (stage.type !== 'station') continue;
    const base = raceStationKey(stage.name);
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    keys.set(stage.id, raceStationKey(stage.name, occurrence));
  }
  return keys;
};

/** A estação fecha o tempo da prova (D34) e, por isso, é conferida com 1 atleta por judge (D39). */
export const closesRaceTime = (stages: readonly OrderedStage[], stationId: string | null | undefined) => (
  Boolean(stationId) && lastRaceStation(stages)?.id === stationId
);
