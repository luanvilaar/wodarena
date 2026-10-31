// Regras puras do painel do organizador da súmula Fitness Race (Story 1.98):
// filtro, busca e agrupamento das penalidades, selo "Alterada" (D19, derivado
// das decisões, sem status próprio), linha do motivo de "Sem tempo fechado"
// pela estação que fecha o tempo (D22, D24, D34, D44), ações possíveis por situação da corrida e formatação de tempo.
// Sem React e sem banco: o componente e os testes usam as mesmas funções.

export type RacePenaltyStatus = 'confirmed' | 'pending' | 'revoked' | 'cancelled';
export type RacePenaltyKind = 'warning' | 'penalty' | 'redo';
export type RaceManageRunStatus = 'racing' | 'finished' | 'dnf' | 'cancelled';

/** Situações da lista (AC1), na ordem dos filtros. "Alterada" não é situação (D19). */
export const RACE_PENALTY_STATUSES: readonly RacePenaltyStatus[] = ['confirmed', 'pending', 'revoked', 'cancelled'];

export const RACE_PENALTY_STATUS_LABELS: Record<RacePenaltyStatus, string> = {
  confirmed: 'Em vigor',
  pending: 'Pendentes',
  revoked: 'Revogadas',
  cancelled: 'Canceladas'
};

export type RaceManagePenalty = {
  id: string;
  runId: string;
  athleteName: string;
  divisionId: string | null;
  divisionName: string;
  stationName: string;
  label: string;
  note: string | null;
  kind: RacePenaltyKind;
  seconds: number;
  status: RacePenaltyStatus;
  origin: 'engine' | 'judge' | 'manager';
  createdByName: string | null;
  createdAt: string;
  altered: boolean;
  originalSeconds: number | null;
};

export type RaceManageDecision = {
  id: string;
  runId: string | null;
  infractionId: string | null;
  heatId: string | null;
  action: string;
  actorName: string;
  reason: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
};

/** Busca por nome sem diferenciar maiúsculas nem acentos. */
export const normalizeRaceSearch = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export const matchesRaceAthlete = (name: string, query: string) => {
  const needle = normalizeRaceSearch(query);
  return !needle || normalizeRaceSearch(name).includes(needle);
};

export type RacePenaltyFilter = { status: RacePenaltyStatus; query: string; divisionId: string };

/** Penalidades da situação escolhida (padrão: em vigor), da categoria e com o nome buscado, mais novas primeiro. */
export const filterRacePenalties = <T extends Pick<RaceManagePenalty, 'status' | 'athleteName' | 'divisionId' | 'createdAt'>>(items: readonly T[], filter: RacePenaltyFilter) => items
  .filter((item) => item.status === filter.status)
  .filter((item) => !filter.divisionId || item.divisionId === filter.divisionId)
  .filter((item) => matchesRaceAthlete(item.athleteName, filter.query))
  .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

/** Quantas há em cada situação, já com a busca e a categoria aplicadas. */
export const countRacePenaltiesByStatus = (items: readonly Pick<RaceManagePenalty, 'status' | 'athleteName' | 'divisionId'>[], query: string, divisionId: string) => {
  const counts = Object.fromEntries(RACE_PENALTY_STATUSES.map((status) => [status, 0])) as Record<RacePenaltyStatus, number>;
  for (const item of items) {
    if (divisionId && item.divisionId !== divisionId) continue;
    if (!matchesRaceAthlete(item.athleteName, query)) continue;
    counts[item.status] += 1;
  }
  return counts;
};

/** Selo "Alterada" (D19): existe decisão `adjust_infraction` para a infração. */
export const isRaceInfractionAltered = (infractionId: string, decisions: readonly Pick<RaceManageDecision, 'action' | 'infractionId'>[]) => (
  decisions.some((decision) => decision.action === 'adjust_infraction' && decision.infractionId === infractionId)
);

/** Segundos de antes da primeira alteração (aparecem riscados), ou null sem alteração. */
export const originalRaceInfractionSeconds = (
  infractionId: string,
  decisions: readonly Pick<RaceManageDecision, 'action' | 'infractionId' | 'before' | 'createdAt'>[]
) => {
  const first = decisions
    .filter((decision) => decision.action === 'adjust_infraction' && decision.infractionId === infractionId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  const seconds = first?.before?.seconds;
  return typeof seconds === 'number' ? seconds : null;
};

// ---------------------------------------------------------------------------
// Corridas
// ---------------------------------------------------------------------------

/**
 * A estação que fecha o tempo da corrida (Story 1.101, D34: a última do
 * percurso da categoria) e a tentativa dela, para a linha de "Sem tempo
 * fechado". `kind` é o tipo do motor (`wall_ball` = reps). `status` null: sem
 * súmula aberta na estação.
 */
export type RaceClosingStationSnapshot = {
  stationName: string;
  kind: string;
  status: string | null;
  validReps: number;
  targetReps: number | null;
  /** Trechos ou voltas registrados (trenó e seções) e a meta. */
  units: number;
  expectedUnits: number | null;
  /** Saída registrada no tipo reps (D24), ainda ativa. */
  abandoned: boolean;
  /** Horário do `abandon` ativo, corrigido pelo desvio (ISO). */
  abandonAt: string | null;
  /** Horário da saída incompleta de trenó ou seções (D44, ISO). */
  exitAt: string | null;
  judgeName: string;
} | null;

/** "do Wall Ball" para a estação de Wall Ball; "de {estação}" para as outras. */
const stationRef = (name: string) => (/^wall\s*balls?$/i.test(name.trim()) ? 'do Wall Ball' : `de ${name}`);

/**
 * Linha do motivo de uma corrida sem tempo fechado (Story 1.98, AC9; Story
 * 1.101, AC7): descreve a estação que fecha o tempo. A saída registrada pelo
 * árbitro tem prioridade (`abandon` no tipo reps, D24; saída incompleta de
 * trenó ou seções, D44); depois, a liberação que não fechou o tempo (horário
 * inválido), a estação completa sem liberação e a falta de liberação.
 */
export const describeRaceNoTimeReason = (closing: RaceClosingStationSnapshot, formatClock: (iso: string) => string) => {
  if (!closing) return 'Sem liberação da última estação (nenhuma súmula aberta na estação).';
  const ref = stationRef(closing.stationName);
  const judge = closing.judgeName ? ` (árbitro ${closing.judgeName})` : '';
  if (!closing.status) return `Sem liberação ${ref} (nenhuma súmula aberta na estação).`;
  if (closing.kind === 'wall_ball' && closing.abandoned) {
    const at = closing.abandonAt ? formatClock(closing.abandonAt) : '';
    return `Atleta saiu ${ref}${at ? ` às ${at}` : ''} com ${closing.validReps} de ${closing.targetReps ?? '?'} reps${judge}.`;
  }
  if (closing.status === 'exited_incomplete') {
    const at = closing.exitAt ? formatClock(closing.exitAt) : '';
    return `Atleta saiu ${ref}${at ? ` às ${at}` : ''} com ${closing.units} de ${closing.expectedUnits ?? '?'} trechos${judge}.`;
  }
  if (closing.status === 'released') return 'Liberação registrada com horário inválido (antes da largada ou sem largada).';
  if (closing.status === 'done_pending_release') {
    return closing.kind === 'wall_ball' ? 'Reps completas, mas o árbitro não liberou o atleta.' : `Estação completa, mas o árbitro não liberou o atleta${judge}.`;
  }
  return `Sem liberação ${ref} (árbitro não liberou).`;
};

/** Corridas da lista "Sem tempo fechado" (AC9): em corrida e sem tempo oficial. */
export const listNoTimeRuns = <T extends { status: RaceManageRunStatus; officialSeconds: number | null }>(runs: readonly T[]) => (
  runs.filter((run) => run.status === 'racing' && run.officialSeconds === null)
);

/** Ações do cartão da corrida por situação (maquete; AC8). */
export const raceRunActions = (status: RaceManageRunStatus) => ({
  adjustTime: status === 'racing' || status === 'finished',
  markDnf: status === 'racing' || status === 'finished',
  undoDnf: status === 'dnf'
});

export const RACE_RUN_STATUS_LABELS: Record<RaceManageRunStatus, string> = {
  racing: 'Em corrida',
  finished: 'Finalizada',
  dnf: 'DNF',
  cancelled: 'Cancelada'
};

// ---------------------------------------------------------------------------
// Tempo
// ---------------------------------------------------------------------------

/** H:MM:SS (frações de segundo aparecem com uma casa). "—" sem tempo. */
export const formatRaceDuration = (seconds: number | null | undefined) => {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '—';
  const whole = Math.floor(seconds);
  const fraction = Math.round((seconds - whole) * 10);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${fraction > 0 ? `,${fraction}` : ''}`;
};

/** Lê H:MM:SS ou MM:SS digitado. null se não for um tempo. */
export const parseRaceDuration = (value: string) => {
  const match = value.trim().match(/^(?:(\d{1,2}):)?([0-5]?\d):([0-5]\d)$/);
  if (!match) return null;
  const total = Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return total > 0 ? total : null;
};

/** Penalidade por extenso curto: "2 min", "15 s", "1 min 30 s", "0 s". */
export const formatRacePenalty = (seconds: number) => {
  if (!seconds) return '0 s';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return [m ? `${m} min` : '', s ? `${s} s` : ''].filter(Boolean).join(' ');
};

/** Tempo oficial previsto (bruto + penalidades vigentes), para a prévia dos modais. */
export const previewRaceOfficial = (grossSeconds: number | null, penaltySeconds: number) => (
  grossSeconds === null ? null : grossSeconds + penaltySeconds
);

/** Motivo da decisão: obrigatório, pelo menos 3 caracteres (o servidor confere de novo). */
export const RACE_DECISION_REASON_MIN = 3;
export const isRaceDecisionReasonValid = (reason: string) => reason.trim().length >= RACE_DECISION_REASON_MIN;

export const RACE_DECISION_LABELS: Record<string, string> = {
  revoke: 'Revogou',
  adjust_infraction: 'Alterou',
  adjust_time: 'Ajustou o tempo',
  mark_dnf: 'Marcou DNF',
  unmark_dnf: 'Desfez DNF',
  adjust_heat_start: 'Corrigiu a largada',
  reset_heat: 'Zerou a largada'
};
