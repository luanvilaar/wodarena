// Dados de exemplo do telão Fitness Race (Story 1.111): o cenário da maquete
// aprovada (docs/design/telao-fitness-race/telao-fitness-race-aprovado.html),
// montado à mão. Onda 3, Open Masculino, 10 atletas; percurso de 8 corridas e 8
// estações com judge só em Ski Erg, Sled Push, Sled Pull, Row, Sandbag Lunges e
// Wall Balls (Burpee Broad Jump e Farmers Carry ficam sem judge); duas penalidades
// de 15 s; um DNF. As durações são as da maquete, em segundos inteiros.
//
// Serve aos testes do motor (tests/race-broadcast-engine.test.mjs) e, como dado
// de exemplo, à conferência visual das Stories 1.113 a 1.115: `buildReferenceInput`
// devolve a entrada do motor (RaceBroadcastInput) para qualquer instante da onda.
// Sem dependência do código do app: só datas e dados.

/** Largada da onda 3: 14/11/2026, 10:12:05 em Fortaleza. */
export const BASE_MS = Date.parse('2026-11-14T10:12:05-03:00');

/** Instante `seconds` depois da largada da onda 3, em ISO. */
export const iso = (seconds) => new Date(BASE_MS + seconds * 1000).toISOString();

/** Instante `ms` milissegundos depois da largada da onda 3, em ISO. */
export const isoMs = (ms) => new Date(BASE_MS + ms).toISOString();

/** Segundos em "MM:SS" ou "H:MM:SS", como `secondsToTime` grava os splits publicados. */
export const mmss = (seconds) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};

/** Percurso da categoria (snapshot do regulamento): 8 corridas e 8 estações, os ids do preset. */
export const stageList = () => [
  { id: 'run-1', name: 'Corrida 1', type: 'run', orderIndex: 1, distance: '1000m' },
  { id: 'ski-erg', name: 'Ski Erg', type: 'station', orderIndex: 2, distance: '1000m', conferenceKind: 'ergometer' },
  { id: 'run-2', name: 'Corrida 2', type: 'run', orderIndex: 3, distance: '1000m' },
  { id: 'sled-push', name: 'Sled Push', type: 'station', orderIndex: 4, distance: '50m', conferenceKind: 'sled' },
  { id: 'run-3', name: 'Corrida 3', type: 'run', orderIndex: 5, distance: '1000m' },
  { id: 'sled-pull', name: 'Sled Pull', type: 'station', orderIndex: 6, distance: '50m', conferenceKind: 'sled' },
  { id: 'run-4', name: 'Corrida 4', type: 'run', orderIndex: 7, distance: '1000m' },
  { id: 'burpee-broad-jump', name: 'Burpee Broad Jump', type: 'station', orderIndex: 8, distance: '80m', conferenceKind: 'sections' },
  { id: 'run-5', name: 'Corrida 5', type: 'run', orderIndex: 9, distance: '1000m' },
  { id: 'row', name: 'Row', type: 'station', orderIndex: 10, distance: '1000m', conferenceKind: 'ergometer' },
  { id: 'run-6', name: 'Corrida 6', type: 'run', orderIndex: 11, distance: '1000m' },
  { id: 'farmers-carry', name: 'Farmers Carry', type: 'station', orderIndex: 12, distance: '200m', conferenceKind: 'sections' },
  { id: 'run-7', name: 'Corrida 7', type: 'run', orderIndex: 13, distance: '1000m' },
  { id: 'sandbag-lunges', name: 'Sandbag Lunges', type: 'station', orderIndex: 14, distance: '100m', conferenceKind: 'sections', units: 4 },
  { id: 'run-8', name: 'Corrida 8', type: 'run', orderIndex: 15, distance: '1000m' },
  { id: 'wall-balls', name: 'Wall Balls', type: 'station', orderIndex: 16, reps: 100, conferenceKind: 'reps' }
];

/** Etapas (índice no percurso) com judge nesta onda; as outras estações não geram leitura. */
export const COVERED_STAGE_INDEXES = [1, 3, 5, 9, 13, 15];

/** Duração de cada uma das 16 etapas, em segundos: corridas, estações com judge e sem judge. */
export const WAVE3_ATHLETES = [
  { key: 'rafael', name: 'Rafael Tavares', box: 'Box Aldeota', dur: [234, 218, 248, 197, 245, 274, 238, 310, 250, 225, 263, 118, 255, 282, 253, 372] },
  { key: 'bruno', name: 'Bruno Sampaio', box: 'CT Meireles', dur: [253, 235, 265, 171, 267, 227, 276, 272, 269, 227, 275, 114, 286, 261, 272, 345] },
  { key: 'diego', name: 'Diego Martins', box: 'Arena Sul', dur: [236, 256, 246, 251, 232, 322, 252, 347, 251, 271, 238, 139, 260, 306, 248, 325] },
  { key: 'thiago', name: 'Thiago Bezerra', box: 'Box Iracema', dur: [277, 238, 274, 203, 279, 269, 267, 310, 276, 249, 289, 125, 278, 253, 279, 354] },
  { key: 'lucas', name: 'Lucas Holanda', box: 'Team Cumbuco', dur: [280, 256, 280, 200, 278, 281, 301, 323, 297, 258, 284, 135, 304, 299, 302, 387] },
  { key: 'mateus', name: 'Mateus Ribeiro', box: 'CT Benfica', dur: [296, 252, 297, 201, 303, 287, 294, 326, 317, 270, 308, 128, 298, 297, 316, 394] },
  { key: 'caio', name: 'Caio Fernandes', box: 'Box Messejana', dur: [289, 271, 310, 212, 306, 294, 315, 339, 315, 285, 313, 139, 326, 292, 326, 390] },
  { key: 'pedro', name: 'Pedro Albuquerque', box: 'Arena Parquelândia', dur: [307, 284, 324, 226, 335, 298, 329, 372, 324, 289, 318, 151, 348, 323, 326, 428] },
  { key: 'gustavo', name: 'Gustavo Lima', box: 'CT Fátima', dur: [329, 292, 324, 240, 325, 319, 332, 370, 342, 292, 357, 145, 347, 347, 343, 460] },
  { key: 'andre', name: 'André Moreira', box: 'Box Dunas', dur: [350, 291, 356, 240, 337, 343, 350, 386, 366, 307, 351, 159, 363, 356, 359, 448] }
];

/** Penalidades vigentes (só segundos, estação e instante em segundos desde a largada). */
export const WAVE3_PENALTIES = [
  { athleteKey: 'thiago', at: 864, seconds: 15, stationId: 'sled-push' },
  { athleteKey: 'caio', at: 3824, seconds: 15, stationId: 'sandbag-lunges' }
];

/** André solta o Row aos 3326 s, para de correr e o organizador marca o DNF aos 3626 s. */
export const WAVE3_DNF = { athleteKey: 'andre', stopAt: 3326, decidedAt: 3626 };

/** Atletas de ondas já terminadas, com o resultado publicado e os splits que viram os melhores anteriores. */
export const PRIOR_ATHLETES = [
  { key: 'felipe', name: 'Felipe Arruda', box: 'Box Aldeota', waveKey: 'w1', value: 4012, splits: { 'ski-erg': '03:52', 'sled-pull': '04:06' } },
  { key: 'renan', name: 'Renan Pinheiro', box: 'Arena Sul', waveKey: 'w1', value: 4301, splits: { row: '04:00' } },
  { key: 'joao', name: 'João Victor Castro', box: 'CT Meireles', waveKey: 'w2', value: 4188, splits: { 'sled-push': '03:02', 'wall-balls': '05:56' } },
  { key: 'samuel', name: 'Samuel Rocha', box: 'Box Iracema', waveKey: 'w2', value: 4377, splits: { 'sandbag-lunges': '04:22' } },
  { key: 'otavio', name: 'Otávio Campos', box: 'Arena Parquelândia', waveKey: 'w2', value: 999999, splits: {}, resultStatus: 'dnf' }
];

const cumulative = (durations) => {
  const start = [];
  const end = [];
  let total = 0;
  for (const duration of durations) {
    start.push(total);
    total += duration;
    end.push(total);
  }
  return { start, end };
};

/** Quando cada atleta da onda 3 fecha o tempo (fim do Wall Balls, em segundos desde a largada). */
export const wave3FinishSeconds = (athleteKey) => {
  const athlete = WAVE3_ATHLETES.find((item) => item.key === athleteKey);
  return cumulative(athlete.dur).end[15];
};

/** Tempo oficial de quem fecha: fim do Wall Balls mais as penalidades vigentes. */
export const wave3OfficialSeconds = (athleteKey) => (
  wave3FinishSeconds(athleteKey) + WAVE3_PENALTIES.filter((item) => item.athleteKey === athleteKey).reduce((sum, item) => sum + item.seconds, 0)
);

/**
 * Entrada do motor `seconds` depois da largada da onda 3. `nowSeconds` (padrão: o mesmo
 * instante) é o relógio do servidor; `withResults: false` tira os resultados publicados dos
 * atletas da onda 3 (os das ondas 1 e 2 ficam).
 */
export const buildReferenceInput = ({ seconds, nowSeconds = seconds, withResults = true } = {}) => {
  const attempts = [];
  const runs = [];
  const penalties = [];
  const results = [];

  for (const athlete of WAVE3_ATHLETES) {
    const { start, end } = cumulative(athlete.dur);
    const stopAt = athlete.key === WAVE3_DNF.athleteKey ? WAVE3_DNF.stopAt : Infinity;
    for (const stage of COVERED_STAGE_INDEXES) {
      const begins = start[stage];
      const ends = end[stage];
      if (begins > seconds || begins > stopAt) continue;
      const stageId = stageList()[stage].id;
      const released = ends <= seconds && ends <= stopAt;
      const fraction = released ? 1 : (seconds - begins) / athlete.dur[stage];
      const isSled = stageId === 'sled-push' || stageId === 'sled-pull';
      const isLunges = stageId === 'sandbag-lunges';
      const isWallBall = stageId === 'wall-balls';
      attempts.push({
        athleteKey: athlete.key,
        stationId: stageId,
        status: released ? 'released' : 'running',
        startedAt: iso(begins),
        endedAt: released ? iso(ends) : null,
        units: isSled || isLunges ? (released ? 4 : Math.min(3, Math.floor(fraction * 4))) : null,
        expectedUnits: isSled || isLunges ? 4 : null,
        validReps: isWallBall ? (released ? 100 : Math.min(99, Math.floor(fraction * 100))) : null,
        targetReps: isWallBall ? 100 : null
      });
    }
    for (const penalty of WAVE3_PENALTIES) {
      if (penalty.athleteKey === athlete.key && penalty.at <= seconds) {
        penalties.push({ athleteKey: athlete.key, seconds: penalty.seconds, stationId: penalty.stationId, at: iso(penalty.at) });
      }
    }
    const finishedAt = end[15];
    if (finishedAt <= seconds && finishedAt <= stopAt) {
      const official = wave3OfficialSeconds(athlete.key);
      runs.push({ athleteKey: athlete.key, waveKey: 'w3', status: 'finished', officialSeconds: official, timeSource: 'sheet', finishAt: iso(finishedAt), dnfAt: null });
      if (withResults) {
        const splits = {};
        for (const stage of COVERED_STAGE_INDEXES) splits[stageList()[stage].id] = mmss(athlete.dur[stage]);
        results.push({ athleteKey: athlete.key, divisionKey: 'open-m', value: official, resultStatus: null, splits, at: iso(finishedAt) });
      }
    } else if (athlete.key === WAVE3_DNF.athleteKey && seconds >= WAVE3_DNF.decidedAt) {
      runs.push({ athleteKey: athlete.key, waveKey: 'w3', status: 'dnf', officialSeconds: null, timeSource: null, finishAt: null, dnfAt: iso(WAVE3_DNF.decidedAt) });
      if (withResults) results.push({ athleteKey: athlete.key, divisionKey: 'open-m', value: 999999, resultStatus: 'dnf', splits: {}, at: iso(WAVE3_DNF.decidedAt) });
    } else {
      runs.push({ athleteKey: athlete.key, waveKey: 'w3', status: 'racing', officialSeconds: null, timeSource: null, finishAt: null, dnfAt: null });
    }
  }

  for (const prior of PRIOR_ATHLETES) {
    results.push({ athleteKey: prior.key, divisionKey: 'open-m', value: prior.value, resultStatus: prior.resultStatus ?? null, splits: prior.splits, at: null });
  }

  return {
    divisions: [
      { key: 'open-m', name: 'Open Masculino', orderIndex: 1, stages: stageList() },
      { key: 'open-f', name: 'Open Feminino', orderIndex: 2, stages: stageList() }
    ],
    athletes: [
      ...WAVE3_ATHLETES.map((athlete) => ({ key: athlete.key, name: athlete.name, box: athlete.box, divisionKey: 'open-m' })),
      ...PRIOR_ATHLETES.map((athlete) => ({ key: athlete.key, name: athlete.name, box: athlete.box, divisionKey: 'open-m' })),
      { key: 'ana', name: 'Ana Paula Lima', box: 'Box Aldeota', divisionKey: 'open-f' },
      { key: 'bia', name: 'Beatriz Nogueira', box: 'CT Meireles', divisionKey: 'open-f' },
      { key: 'davi', name: 'Davi Lacerda', box: 'Box Dunas', divisionKey: 'open-m' }
    ],
    waves: [
      { key: 'w1', title: 'Onda 1', date: '2026-11-14', time: '08:30', heatNumber: 1, athleteKeys: ['felipe', 'renan'], startedAt: iso(-7200) },
      { key: 'w2', title: 'Onda 2', date: '2026-11-14', time: '09:20', heatNumber: 2, athleteKeys: ['joao', 'samuel', 'otavio'], startedAt: iso(-3600) },
      { key: 'w3', title: 'Onda 3', date: '2026-11-14', time: '10:12', heatNumber: 3, athleteKeys: WAVE3_ATHLETES.map((athlete) => athlete.key), startedAt: iso(0) },
      { key: 'w4', title: 'Onda 4', date: '2026-11-14', time: '10:40', heatNumber: 4, athleteKeys: ['ana', 'bia', 'davi'], startedAt: null }
    ],
    runs,
    attempts,
    penalties,
    results,
    nowMs: BASE_MS + nowSeconds * 1000
  };
};

/** Linhas da classificação por categoria, como `computeDivisionStandings` as entrega (aqui, só a contagem). */
export const standingsOf = (input) => {
  const counts = new Map();
  for (const result of input.results) counts.set(result.divisionKey, (counts.get(result.divisionKey) ?? 0) + 1);
  return input.divisions.map((division) => ({ divisionKey: division.key, rows: counts.get(division.key) ?? 0 }));
};

/** Visão da mesa do gestor e da classificação; o automático por padrão. */
export const referenceView = (input, overrides = {}) => ({
  mode: 'auto',
  pinnedWaveKey: null,
  pinnedDivisionKey: null,
  standings: standingsOf(input),
  ...overrides
});
