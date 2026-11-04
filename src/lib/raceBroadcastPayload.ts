import type { BroadcastMode } from '@/lib/broadcastMode';
import type {
  RaceBattle,
  RaceBoardRow,
  RaceClassStep,
  RaceFinalist,
  RaceLiveStep,
  RacePointRef,
  RaceStationBest,
  RaceStationRecord
} from '@/lib/raceBroadcast';
import type { RaceStationKind } from '@/lib/raceRules';

// O que o telão do Fitness Race recebe de GET /api/telao/[token] (Story 1.112).
// Só tipos: o payload é montado em `serverRaceBroadcast.ts` e consumido pelas
// telas das Stories 1.113 a 1.115. Distinto do payload de Functional Fitness
// (`broadcastPayload.ts`): leva `eventType: 'fitness_racing'`.
//
// Regras de conteúdo (README do telão, Regra 7 e D2): nome sanitizado e box;
// equipe pelo nome da equipe; `key` opaca e estável por atleta; penalidade só em
// segundos (sem motivo, código, nota nem autor); nenhum id de atleta, corrida,
// cartão, usuário ou inscrição; nenhum e-mail, telefone, nascimento nem foto.
// Instantes são ISO absolutos (o relógio e o rodízio são do cliente) e os
// horários do dia já vêm no fuso do evento, em texto.

export type RaceBroadcastScreen = 'live' | 'grid' | 'class' | 'standby';

/** Etapa do percurso como o telão mostra: nome, tipo, meta e carga da categoria, se fecha o tempo e se está sem judge. */
export type RaceStageView = {
  id: string;
  key: string | null;
  name: string;
  type: 'run' | 'station';
  kind: RaceStationKind | null;
  /** Meta e distância: "4 trechos · 50m", "100 reps", "1000m". Vazio quando não há. */
  target: string;
  /** Carga da categoria ("152kg"); vazio quando não há. */
  load: string;
  closesTime: boolean;
  /** Só na torre ao vivo: ninguém da onda e categoria teve cartão aqui e alguém já tem mais adiante. */
  semJudge: boolean;
};

/** Onda do cronograma em poucas palavras (faixa "próxima largada", espera e grid). */
export type RaceWaveBrief = {
  key: string;
  title: string;
  heatNumber: number | null;
  date: string;
  /** Horário previsto do cronograma ("10:40"); a largada só vale no gesto do gestor. */
  time: string;
  divisionNames: string[];
  athleteCount: number;
};

export type RaceLiveWaveView = {
  key: string;
  title: string;
  heatNumber: number | null;
  time: string;
  startedAt: string;
  /** Hora da largada no fuso do evento ("10:12:05"). */
  startedClock: string;
  /** Instante da última leitura da onda (início ou saída de cartão); o aviso "sem leitura há N min" é do cliente. */
  lastReadingAt: string | null;
  divisionKeys: string[];
  athleteCount: number;
  racingCount: number;
};

export type RaceLiveBoardView = {
  /** `division`: a torre da categoria com todas as ondas largadas (ranking único, Story 1.116); `wave`: a torre de uma onda (mesa). */
  scope: 'division' | 'wave';
  /** Só na torre de uma onda. */
  waveKey: string | null;
  waveTitle: string | null;
  divisionKey: string;
  divisionName: string;
  startedAt: string | null;
  stages: RaceStageView[];
  /**
   * Linhas da torre. Na diferença "contando" (`gapCounting`), `gapSeconds` vem nulo: a tela conta com
   * `startedAt`, `penaltySeconds` e `gapBaseSeconds`, para a `version` não mudar a cada segundo.
   */
  rows: RaceBoardRow[];
  battle: RaceBattle | null;
  finalists: RaceFinalist[];
  /** Há líder com leitura; senão a tela mostra "aguardando a primeira leitura". */
  hasLeaderReading: boolean;
};

/** Chegada fechada pela súmula, para a bandeirada (a janela de exibição é do cliente, pela hora do servidor). */
export type RaceArrivalView = {
  athleteKey: string;
  name: string;
  box: string;
  divisionKey: string;
  divisionName: string;
  waveKey: string | null;
  finishAt: string;
  finishClock: string;
  finalSeconds: number;
  finalText: string;
  /** Posição na categoria até agora (1, 1, 3 nos empates); null só se a categoria não tem como contar. */
  position: number | null;
  /** Total de segundos de penalidade vigente, já incluído no tempo final. */
  penaltySeconds: number;
  /** Melhores da categoria que este atleta detém agora. */
  holds: { stationName: string; seconds: number }[];
};

/** Faixa da direção de prova: largada, entrada no ranking, penalidade (só segundos), DNF e chegada. */
export type RaceTickerEvent = {
  kind: 'start' | 'enter' | 'penalty' | 'dnf' | 'finish';
  at: string;
  /** Hora do dia no fuso do evento ("10:26:29"). */
  clock: string;
  /** Onda do evento: na torre de uma onda, a faixa mostra o último evento dela. */
  waveKey: string | null;
  waveTitle: string;
  /** Categorias do evento: na torre da categoria, a faixa mostra o último evento dela (a largada vale para as categorias da onda). */
  divisionKeys: string[];
  name: string | null;
  /** Só na entrada no ranking: a posição na torre da categoria naquele instante e o ponto da primeira leitura. */
  position: number | null;
  point: RacePointRef | null;
  /** Só na penalidade: os segundos (o motivo nunca vai). */
  seconds: number | null;
  stationName: string | null;
  /** Só na chegada: o tempo final em segundos, para a tela formatar pela função única. */
  finalSeconds: number | null;
};

export type RaceLivePayload = {
  /** `division`: torres das categorias (ranking único); `wave`: a torre da onda fixada na mesa. */
  scope: 'division' | 'wave';
  /** Passos do rodízio: a categoria (torre da categoria) ou onda × categoria (onda fixada), na ordem das torres. */
  steps: RaceLiveStep[];
  /** Ondas na pista (relógios do cabeçalho); com a onda fixada, só ela. */
  waves: RaceLiveWaveView[];
  boards: RaceLiveBoardView[];
  /** Melhor tempo da categoria por estação, só das categorias que estão no ar. */
  bests: RaceStationBest[];
  /** Recordes batidos (com instante), do mais antigo ao mais novo, só das categorias que estão no ar. */
  records: RaceStationRecord[];
  arrivals: RaceArrivalView[];
  ticker: RaceTickerEvent[];
};

export type RaceGridAthleteView = { key: string; name: string; box: string; divisionKey: string; divisionName: string };

export type RaceGridPayload = {
  wave: RaceWaveBrief;
  /** Na ordem do cronograma; só atletas que existem no evento. */
  athletes: RaceGridAthleteView[];
  /** Percurso de cada categoria da onda, com meta e carga. */
  courses: { divisionKey: string; divisionName: string; stages: RaceStageView[] }[];
};

export type RaceClassRowView = {
  key: string;
  /** 1, 1, 3 nos empates; null no DNF. */
  position: number | null;
  name: string;
  box: string;
  waveTitle: string;
  finalSeconds: number | null;
  /** "1:06:22"; null no DNF. */
  timeText: string | null;
  /** Segundos para o 1º da categoria; null no 1º e no DNF. */
  gapSeconds: number | null;
  dnf: boolean;
  /** Selo NOVO: atleta da onda que terminou por último. */
  fresh: boolean;
};

export type RaceClassDivisionView = {
  key: string;
  name: string;
  rows: RaceClassRowView[];
  bests: RaceStationBest[];
};

export type RaceClassPayload = {
  /** Categoria × página de 10 linhas e, quando alterna, o grid da próxima onda. */
  steps: RaceClassStep[];
  divisions: RaceClassDivisionView[];
  /** A onda que terminou por último (de onde vem o selo NOVO). */
  lastWave: { key: string; title: string } | null;
  /** O grid da próxima onda, quando a classificação alterna com ele. */
  grid: RaceGridPayload | null;
};

export type RaceStandbyPayload = { upcoming: RaceWaveBrief[] };

export type RaceBroadcastPayload = {
  eventType: 'fitness_racing';
  version: string;
  appVersion: string;
  serverTime: string;
  event: { name: string; logoUrl: string; date: string; timeZone: string };
  mode: BroadcastMode;
  screen: RaceBroadcastScreen;
  /** Próxima onda sem largada (grid e luzes); null quando não há. */
  next: RaceWaveBrief | null;
  live: RaceLivePayload | null;
  grid: RaceGridPayload | null;
  class: RaceClassPayload | null;
  standby: RaceStandbyPayload | null;
};
