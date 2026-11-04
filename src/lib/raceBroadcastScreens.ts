import { RACE_CLASS_STEP_MS, RACE_PAGE_SIZE, raceStepIndex } from '@/lib/raceBroadcast';
import type {
  RaceBroadcastPayload,
  RaceClassPayload,
  RaceStandbyPayload,
  RaceWaveBrief
} from '@/lib/raceBroadcastPayload';
import { raceClassGridFrame } from '@/lib/raceBroadcastMoments';
import { describeRaceWhere, formatRaceTime, raceClosingStationId, raceLiveFrame, raceRowPosition } from '@/lib/raceBroadcastView';

// Telas de classificação e de espera do telão do Fitness Race e a prévia da mesa do
// gestor (Story 1.115). Puro: sem React, sem rede e sem relógio próprio (a hora do
// servidor entra por `nowMs`). Desenho aprovado em docs/design/telao-fitness-race/
// (telas "Classificação" e "Espera"). A classificação é o mesmo resultado do
// leaderboard do site (a 1.112 entrega a posição e o tempo publicados): a tela não
// faz conta de ranking, só formata. Tempos e diferenças pela função única da 1.113.

const joinNames = (names: readonly string[]) => names.join(' e ');
const peopleText = (count: number) => `${count} ${count === 1 ? 'atleta' : 'atletas'}`;

// ---------------------------------------------------------------------------
// Classificação (D6; Regra 6)
// ---------------------------------------------------------------------------

export const RACE_CLASS_EMPTY_TEXT = 'Nenhum resultado publicado ainda';
export const RACE_CLASS_BESTS_EMPTY = 'Nenhuma estação com tempo ainda';
export const RACE_CLASS_BESTS_NOTE = 'Só estação com judge tem tempo. Somando as ondas do dia.';
/** Rodapé da classificação: a faixa diz que o resultado é o do leaderboard do site. */
export const RACE_CLASS_FOOTER = { label: 'Resultados', text: 'Mesmo resultado do leaderboard do site · tempo final com penalidades' };

export type RaceClassRowFrame = {
  key: string;
  /** "1", "1" nos empates; "–" no DNF. */
  position: string;
  name: string;
  box: string;
  /** "Onda 3". */
  wave: string;
  /** "1:06:22" ou "DNF". */
  time: string;
  /** "+0:33" para quem não é o 1º; vazio no 1º e no DNF. */
  gap: string;
  /** Selo NOVO: atleta da onda que terminou por último (T5-2). */
  fresh: boolean;
  dnf: boolean;
};

export type RaceClassBestFrame = { key: string; station: string; time: string; who: string };

export type RaceClassFrame = {
  divisionKey: string;
  divisionName: string;
  /** "Classificação · Open Masculino". */
  title: string;
  /** "9 com tempo · 1 DNF" (o DNF só quando há); vazio sem resultado. */
  meta: string;
  pageIndex: number;
  pageCount: number;
  /** As linhas da página no ar (até 10), com o DNF no fim. */
  rows: RaceClassRowFrame[];
  /** Categoria sem resultado publicado (fixada na mesa): a tabela diz isto, nunca fica em branco. */
  emptyText: string;
  /** Melhores por estação da categoria, só das estações com tempo (T5-3). */
  bests: RaceClassBestFrame[];
  bestsEmpty: string;
  bestsNote: string;
  /** Rodapé "Próxima largada"; null sem próxima onda. */
  next: { label: string; wave: string; detail: string } | null;
};

/** O rodapé "Próxima largada" da classificação e da espera: onda, horário previsto, categorias e atletas. */
const describeNext = (next: RaceWaveBrief | null): RaceClassFrame['next'] => (next
  ? {
    label: 'Próxima largada',
    wave: [next.title, next.time].filter(Boolean).join(' · '),
    detail: [joinNames(next.divisionNames), peopleText(next.athleteCount)].filter(Boolean).join(' · ')
  }
  : null);

/**
 * A classificação no ar agora (AC2): categoria × página de 10 linhas, 12 s cada (T5-1), pela hora
 * do servidor, para duas TVs mostrarem a mesma. Null quando o passo de 12 s do momento é do grid
 * (a alternância com a próxima onda; ver `raceClassGridFrame`) ou o payload não tem passos.
 */
export const raceClassFrame = (cls: Pick<RaceClassPayload, 'steps' | 'divisions'>, next: RaceWaveBrief | null, nowMs: number): RaceClassFrame | null => {
  if (cls.steps.length === 0) return null;
  const step = cls.steps[raceStepIndex(nowMs, RACE_CLASS_STEP_MS, cls.steps.length)];
  if (step.kind !== 'class') return null;
  const division = cls.divisions.find((item) => item.key === step.divisionKey);
  if (!division) return null;
  // Quem tem tempo na ordem do resultado e o DNF no fim; a ordenação é estável.
  const ordered = [...division.rows].sort((a, b) => Number(a.dnf) - Number(b.dnf));
  const pageCount = Math.max(1, step.pageCount);
  const pageIndex = Math.min(pageCount - 1, Math.max(0, step.page));
  const withTime = ordered.filter((row) => row.finalSeconds !== null).length;
  const dnf = ordered.filter((row) => row.dnf).length;
  return {
    divisionKey: division.key,
    divisionName: division.name,
    title: `Classificação · ${division.name}`,
    meta: ordered.length === 0 ? '' : `${withTime} com tempo${dnf > 0 ? ` · ${dnf} DNF` : ''}`,
    pageIndex,
    pageCount,
    rows: ordered.slice(pageIndex * RACE_PAGE_SIZE, (pageIndex + 1) * RACE_PAGE_SIZE).map((row) => ({
      key: row.key,
      position: row.position === null ? '–' : String(row.position),
      name: row.name,
      box: row.box,
      wave: row.waveTitle,
      time: row.finalSeconds === null ? 'DNF' : formatRaceTime(row.finalSeconds),
      gap: row.finalSeconds === null || row.gapSeconds === null ? '' : `+${formatRaceTime(row.gapSeconds)}`,
      fresh: row.fresh,
      dnf: row.dnf
    })),
    emptyText: ordered.length === 0 ? RACE_CLASS_EMPTY_TEXT : '',
    bests: division.bests.map((best) => ({
      key: `${best.stationId}-${best.athleteKey}`,
      station: best.stationName,
      time: formatRaceTime(best.seconds),
      who: [best.name, best.waveTitle].filter(Boolean).join(' · ')
    })),
    bestsEmpty: division.bests.length === 0 ? RACE_CLASS_BESTS_EMPTY : '',
    bestsNote: RACE_CLASS_BESTS_NOTE,
    next: describeNext(next)
  };
};

// ---------------------------------------------------------------------------
// Espera
// ---------------------------------------------------------------------------

export const RACE_STANDBY_EMPTY_TEXT = 'Acompanhe o placar ao vivo neste telão.';
/** A espera lista até quatro ondas por largar. */
export const RACE_STANDBY_MAX = 4;

export type RaceStandbyWaveFrame = { key: string; time: string; title: string; detail: string };

export type RaceStandbyFrame = {
  name: string;
  /** "Sábado, 14 de novembro"; vazio quando o evento não tem data válida. */
  dateText: string;
  /** As próximas ondas sem largada, na ordem do cronograma: o horário é o previsto, só informação (D45). */
  waves: RaceStandbyWaveFrame[];
  /** Sem próxima onda: só a marca e esta frase, sem rodapé de próxima largada. */
  emptyText: string;
  footer: { label: string; text: string } | null;
};

/** "2026-11-14" → "Sábado, 14 de novembro" (a data do evento não tem hora: lida em UTC para não andar um dia). */
export const describeRaceEventDate = (date: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? '');
  if (!match) return '';
  const at = new Date(`${match[1]}-${match[2]}-${match[3]}T12:00:00Z`);
  if (Number.isNaN(at.getTime())) return '';
  const text = at.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** A tela de espera (AC3): a marca do evento, a data e as próximas ondas por largar. */
export const describeRaceStandby = (standby: Pick<RaceStandbyPayload, 'upcoming'>, event: { name: string; date: string }): RaceStandbyFrame => {
  const upcoming = standby.upcoming.slice(0, RACE_STANDBY_MAX);
  const first = upcoming[0];
  return {
    name: event.name || 'WODArena',
    dateText: describeRaceEventDate(event.date),
    waves: upcoming.map((wave) => ({
      key: wave.key,
      time: wave.time || '–',
      title: wave.title,
      detail: [joinNames(wave.divisionNames), peopleText(wave.athleteCount)].filter(Boolean).join(' · ')
    })),
    emptyText: upcoming.length === 0 ? RACE_STANDBY_EMPTY_TEXT : '',
    footer: first
      ? { label: 'Próxima largada', text: [first.title, first.time, joinNames(first.divisionNames)].filter(Boolean).join(' · ') }
      : null
  };
};

// ---------------------------------------------------------------------------
// Prévia da mesa do gestor (aba Telão)
// ---------------------------------------------------------------------------

export type RacePanelPreview = {
  /** "Ao vivo", "Grid de largada", "Classificação" ou "Espera". */
  screenLabel: string;
  /** O passo no ar: "Open Masculino · ranking da prova" (torre da categoria) ou "Onda 3 · Open Masculino" (onda fixada); vazio na espera. */
  context: string;
  /** Ao vivo: a torre em lista (posição, nome, onde está), no máximo 10, e quantos ficaram de fora. */
  rows: { key: string; position: string; name: string; where: string }[];
  hiddenCount: number;
};

export const RACE_PANEL_PREVIEW_ROWS = 10;

/** O que o gestor vê em "No ar agora": a tela, o passo e a torre, pela hora do servidor da própria prévia. */
export const describeRacePanelPreview = (payload: RaceBroadcastPayload): RacePanelPreview => {
  const nowMs = Date.parse(payload.serverTime);
  const at = Number.isFinite(nowMs) ? nowMs : 0;
  if (payload.screen === 'live' && payload.live) {
    const frame = raceLiveFrame(payload.live, at);
    if (!frame) return { screenLabel: 'Ao vivo', context: '', rows: [], hiddenCount: 0 };
    const closing = raceClosingStationId(frame.board);
    const rows = frame.board.rows.slice(0, RACE_PANEL_PREVIEW_ROWS).map((row) => {
      const where = describeRaceWhere(row, closing, at);
      return { key: row.athleteKey, position: raceRowPosition(row), name: row.name, where: `${where.main} · ${where.sub}` };
    });
    return {
      screenLabel: 'Ao vivo',
      context: frame.board.scope === 'division' ? `${frame.board.divisionName} · ranking da prova` : `${frame.board.waveTitle ?? ''} · ${frame.board.divisionName}`,
      rows,
      hiddenCount: Math.max(0, frame.board.rows.length - rows.length)
    };
  }
  if (payload.screen === 'grid' && payload.grid) {
    const wave = payload.grid.wave;
    return { screenLabel: 'Grid de largada', context: [wave.title, joinNames(wave.divisionNames)].filter(Boolean).join(' · '), rows: [], hiddenCount: 0 };
  }
  if (payload.screen === 'class' && payload.class) {
    const frame = raceClassFrame(payload.class, payload.next, at);
    if (frame) return { screenLabel: 'Classificação', context: frame.divisionName, rows: [], hiddenCount: 0 };
    const grid = raceClassGridFrame(payload.class, at);
    if (grid) return { screenLabel: 'Grid de largada', context: grid.heading, rows: [], hiddenCount: 0 };
    return { screenLabel: 'Classificação', context: '', rows: [], hiddenCount: 0 };
  }
  return { screenLabel: 'Espera', context: '', rows: [], hiddenCount: 0 };
};
