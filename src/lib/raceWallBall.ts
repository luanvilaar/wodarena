import type { RaceEvent, RaceRuleset, RaceStationResult } from '@/lib/raceRules';

// Tela do Wall Ball da súmula Fitness Race (Story 1.97). Regras puras, sem
// React e sem rede: tempo exibido do atleta (D21, só exibição; o oficial vem
// do servidor), textos da tela, qual registro o "Desfazer último" atinge e
// como o gancho useRaceSync trata cada resposta do servidor. O estado da
// estação (reps, trava, saída, penalidades) vem do próprio motor
// (evaluateRaceStation), rodado no aparelho sobre a fila local.

/** Registro na fila do aparelho: o id do aparelho (reenvio sem duplicar), o evento e o horário do toque. */
export type RaceQueuedEvent = { id: string; event: RaceEvent; deviceAt: number | null };

// ---------------------------------------------------------------------------
// Tempo exibido (AC16, D21)
// ---------------------------------------------------------------------------

/**
 * Segundos desde a largada da onda pelo relógio do aparelho, corrigido pelo
 * desvio conhecido (servidor - aparelho), se houver. Sem largada ou com
 * horário inválido, null (a tela mostra "—" em vez de inventar).
 */
export const raceElapsedSeconds = (startedAt: string | null | undefined, nowMs: number, clockOffsetMs: number | null = null): number | null => {
  const start = startedAt ? Date.parse(startedAt) : Number.NaN;
  if (!Number.isFinite(start) || !Number.isFinite(nowMs)) return null;
  const now = nowMs + (typeof clockOffsetMs === 'number' && Number.isFinite(clockOffsetMs) ? clockOffsetMs : 0);
  return Math.max(0, Math.floor((now - start) / 1000));
};

/** "1:12:34" (com hora) ou "12:34"; "—" sem tempo. Sem casas decimais. */
export const formatRaceElapsed = (seconds: number | null | undefined) => {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
};

/**
 * Tempo congelado na liberação (AC16): largada até o toque do "Liberar"
 * (horário do aparelho guardado no próprio registro), não até a resposta do
 * servidor. null sem largada, sem liberação efetiva ou sem horário do toque.
 */
export const releasedElapsedSeconds = (
  startedAt: string | null | undefined,
  events: readonly RaceQueuedEvent[],
  result: Pick<RaceStationResult, 'state' | 'voided' | 'rejected'>,
  clockOffsetMs: number | null = null
) => {
  if (result.state !== 'released') return null;
  const voided = new Set(result.voided);
  const rejected = new Set(result.rejected.map((item) => item.seq));
  const release = events.find((item, seq) => item.event.t === 'release' && !voided.has(seq) && !rejected.has(seq));
  if (!release || typeof release.deviceAt !== 'number') return null;
  return raceElapsedSeconds(startedAt, release.deviceAt, clockOffsetMs);
};

export const RACE_PROVISIONAL_TIME_LABEL = 'Provisório, pelo relógio deste aparelho, sem penalidades. O tempo oficial é calculado pelo servidor.';

// ---------------------------------------------------------------------------
// Textos da tela
// ---------------------------------------------------------------------------

/** Total de penalidades: "Sem penalidade", "+2 min", "+1 min 30 s", "+45 s". */
export const formatRacePenalty = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Sem penalidade';
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `+${[minutes ? `${minutes} min` : '', rest ? `${rest} s` : ''].filter(Boolean).join(' ')}`;
};

/** Itens do menu "Infração geral" (AC9): o magnésio do Wall Ball primeiro, depois as gerais do regulamento. */
export const wallBallInfractionItems = (rules: Pick<RaceRuleset, 'wallBall' | 'general'>) => [
  { key: 'chalk', label: rules.wallBall.chalkLabel, seconds: rules.wallBall.chalkSeconds, event: { t: 'chalk' } as RaceEvent },
  ...rules.general.map((item) => ({ key: item.code, label: item.label, seconds: item.seconds, event: { t: 'infraction', code: item.code } as RaceEvent }))
];

/** Texto de um registro para a linha "Último: …" e para o desfazer. */
export const describeWallBallEvent = (event: RaceEvent, rules: Pick<RaceRuleset, 'wallBall' | 'general'>): string => {
  switch (event.t) {
    case 'rep': return 'REP';
    case 'norep': return `NO REP · ${rules.wallBall.noRepReasons.find((item) => item.code === event.reason)?.label ?? event.reason}`;
    case 'chalk': return rules.wallBall.chalkLabel;
    case 'infraction': return rules.general.find((item) => item.code === event.code)?.label ?? 'Infração';
    case 'abandon': return 'saída registrada';
    case 'release': return 'liberado';
    case 'start': return 'início';
    default: return 'registro';
  }
};

/**
 * Posição que o "Desfazer último" atinge (AC5): o último registro aceito e
 * ainda não desfeito, sem contar desfazer, o início da estação e a liberação
 * (o árbitro não reabre a tentativa, AC10). null quando não há o que desfazer.
 */
export const lastUndoableSeq = (events: readonly { event: RaceEvent }[], result: Pick<RaceStationResult, 'voided' | 'rejected'>) => {
  const voided = new Set(result.voided);
  const rejected = new Set(result.rejected.map((item) => item.seq));
  for (let seq = events.length - 1; seq >= 0; seq -= 1) {
    const type = events[seq].event.t;
    if (voided.has(seq) || rejected.has(seq) || type === 'undo' || type === 'start' || type === 'release') continue;
    return seq;
  }
  return null;
};

/** Texto da última ação da tela, com o desfazer citando o registro atingido. */
export const describeLastWallBallAction = (
  events: readonly { event: RaceEvent }[],
  rules: Pick<RaceRuleset, 'wallBall' | 'general'>,
  validReps: number,
  targetReps: number | null
) => {
  const last = events[events.length - 1]?.event;
  if (!last || last.t === 'start') return '';
  if (last.t === 'undo') {
    const target = events[last.of]?.event;
    return `desfeito (${target ? describeWallBallEvent(target, rules) : 'registro'}). O registro continua no histórico`;
  }
  if (last.t === 'rep' && targetReps !== null && validReps >= targetReps) return `REP · contador travado em ${targetReps}`;
  return describeWallBallEvent(last, rules);
};

/** Carga da categoria a partir do percurso: a do naipe, ou as duas quando a categoria é mista. */
export const wallBallLoad = (stage: { maleWeight?: string; femaleWeight?: string } | null, category?: string | null) => {
  if (!stage) return '';
  if (category === 'female') return stage.femaleWeight || '';
  if (category === 'male') return stage.maleWeight || '';
  const both = [stage.maleWeight && `M ${stage.maleWeight}`, stage.femaleWeight && `F ${stage.femaleWeight}`].filter(Boolean);
  return both.join(' · ');
};

// ---------------------------------------------------------------------------
// Fila do aparelho (AC13)
// ---------------------------------------------------------------------------

export type RaceSyncOutcome = 'ok' | 'conflict' | 'session' | 'rejected' | 'retry';

/**
 * O que o gancho faz com cada resposta do envio: 2xx sai da fila; 409
 * (divergência ou tentativa encerrada) para e pede para recarregar; 401 para
 * e leva ao login sem perder a fila; 400 e 403 param com a mensagem do
 * servidor; o resto (sem conexão, 5xx) tenta de novo.
 */
export const classifyRaceSyncResponse = (status: number): RaceSyncOutcome => {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 409) return 'conflict';
  if (status === 401) return 'session';
  if (status === 400 || status === 403) return 'rejected';
  return 'retry';
};

export const RACE_SESSION_EXPIRED_MESSAGE = 'Sua sessão expirou. Entre de novo: os registros continuam guardados neste aparelho.';

/** Corpo do lote enviado a /api/race-sheets: horário do aparelho no envio (desvio) e o de cada toque. */
export const buildRaceAppendBody = (attemptId: string, fromSeq: number, batch: readonly RaceQueuedEvent[], clientNow: number) => ({
  action: 'append',
  attemptId,
  fromSeq,
  clientNow,
  events: batch.map((item) => ({ id: item.id, event: item.event, ...(typeof item.deviceAt === 'number' ? { deviceAt: item.deviceAt } : {}) }))
});

// ---------------------------------------------------------------------------
// Lista da onda (AC1, AC12)
// ---------------------------------------------------------------------------

/** Faixa do CourtShell nas telas do Wall Ball (D26). */
export const WALL_BALL_EYEBROW = 'Fitness Race · Wall Ball';

export type WallBallBoardAthlete = {
  athleteId: string;
  name: string;
  box: string;
  divisionName: string;
  team: boolean;
  runStatus: string;
  stationId: string | null;
  attempt: { id: string; status: string; judgeUserId: string | null; judgeName: string; validReps: number; targetReps: number | null; abandoned: boolean } | null;
};

const DONE_LABEL: Record<string, string> = { finished: 'Liberado', dnf: 'DNF' };

/** Estado da linha: concluído (liberado, DNF), com outro árbitro, sem Wall Ball no percurso ou disponível. */
export const describeWallBallRow = (athlete: WallBallBoardAthlete, viewerId: string) => {
  if (athlete.attempt?.status === 'released' || DONE_LABEL[athlete.runStatus]) {
    return { done: true, disabled: true, chip: DONE_LABEL[athlete.runStatus] ?? 'Liberado' };
  }
  if (!athlete.stationId) return { done: false, disabled: true, chip: 'Sem Wall Ball no percurso' };
  const attempt = athlete.attempt;
  if (attempt?.judgeUserId && attempt.judgeUserId !== viewerId) return { done: false, disabled: true, chip: `Com ${attempt.judgeName}` };
  if (attempt?.abandoned) {
    const missing = Math.max(0, (attempt.targetReps ?? 0) - attempt.validReps);
    return { done: false, disabled: false, chip: `Saiu · faltam ${missing}` };
  }
  if (attempt && attempt.validReps > 0) return { done: false, disabled: false, chip: `${attempt.validReps} de ${attempt.targetReps ?? '—'}` };
  return { done: false, disabled: false, chip: 'Em corrida' };
};
