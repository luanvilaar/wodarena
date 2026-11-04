// Dados de exemplo do ranking único do telão Fitness Race (Story 1.116): o cenário do
// telão simulado da proposta aprovada em 2026-11-04
// (docs/design/telao-fitness-race/ranking-unico-aprovado.html). Uma categoria (Open
// Masculino), três ondas de 5 atletas largando às 10:00, 10:12 e 10:24, judge em 6 das 8
// estações (Burpee Broad Jump e Farmers Carry sem judge), +15 s para o Thiago no Sled Push,
// +30 s para o Caio no Sandbag Lunges e o DNF do Gustavo no Row. As durações saem da mesma
// conta da maquete (base da etapa × fator de corrida ou de estação × um ruído fixo), então os
// momentos que a maquete mostra são os mesmos aqui: Bruno passa Rafael às 10:20:28, Diego
// entra em 1º às 10:28:14 e cai na saída do Ski Erg, e Diego fecha 1 s à frente do Rafael.
// Sem dependência do código do app: só datas e dados.

import { stageList } from './raceBroadcastScenario.mjs';

/** 14/11/2026, 10:00:00 em Fortaleza: a largada da Onda 1. */
export const RANKING_BASE_MS = Date.parse('2026-11-14T10:00:00-03:00');

/** Instante `seconds` depois das 10:00:00, em ISO. */
export const at = (seconds) => new Date(RANKING_BASE_MS + seconds * 1000).toISOString();

/** "10:42:00" para `seconds` depois das 10:00:00. */
export const clockOf = (seconds) => {
  const total = Math.round(36000 + seconds);
  const pad = (n) => String(n).padStart(2, '0');
  return `${Math.floor(total / 3600)}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
};

const BASE_DURATIONS = [280, 280, 290, 210, 300, 270, 310, 300, 310, 290, 320, 150, 320, 270, 330, 360];
const RUN_STAGE = (index) => index % 2 === 0;
/** Etapas com judge (índice no percurso): Ski Erg, Sled Push, Sled Pull, Row, Sandbag Lunges, Wall Balls. */
export const RANKING_COVERED = [1, 3, 5, 9, 13, 15];

export const RANKING_WAVES = [
  { key: 'o1', title: 'Onda 1', heatNumber: 1, time: '10:00', start: 0 },
  { key: 'o2', title: 'Onda 2', heatNumber: 2, time: '10:12', start: 720 },
  { key: 'o3', title: 'Onda 3', heatNumber: 3, time: '10:24', start: 1440 }
];

const RAW = [
  ['rafael', 'Rafael Tavares', 'Box Aldeota', 0, 0.92, 0.95],
  ['thiago', 'Thiago Bezerra', 'Box Iracema', 0, 1.0, 0.98],
  ['mateus', 'Mateus Ribeiro', 'CT Benfica', 0, 1.05, 1.02],
  ['pedro', 'Pedro Albuquerque', 'Arena Parquelândia', 0, 1.1, 1.08],
  ['gustavo', 'Gustavo Lima', 'CT Fátima', 0, 1.18, 1.12],
  ['bruno', 'Bruno Sampaio', 'CT Meireles', 1, 0.95, 0.86],
  ['caio', 'Caio Fernandes', 'Box Messejana', 1, 0.98, 1.04],
  ['andre', 'André Moreira', 'Box Dunas', 1, 1.03, 0.97],
  ['lucas', 'Lucas Holanda', 'Team Cumbuco', 1, 1.08, 1.1],
  ['felipe', 'Felipe Castro', 'Arena Cocó', 1, 1.15, 1.05],
  ['diego', 'Diego Martins', 'Arena Sul', 2, 0.88, 1.0],
  ['igor', 'Igor Nogueira', 'CT Papicu', 2, 0.97, 0.94],
  ['renan', 'Renan Cavalcante', 'Box Varjota', 2, 1.01, 1.06],
  ['vitor', 'Vitor Barros', 'Team Porto', 2, 1.06, 1.0],
  ['henrique', 'Henrique Paiva', 'CT Montese', 2, 1.12, 1.15]
];

/** Os 15 atletas com o início e o fim de cada etapa, em segundos desde a largada da onda deles. */
export const RANKING_ATHLETES = RAW.map(([key, name, box, waveIndex, runFactor, stationFactor], index) => {
  const begin = [];
  const end = [];
  let total = 0;
  BASE_DURATIONS.forEach((base, stage) => {
    const noise = 1 + 0.035 * Math.sin((index + 1) * 12.9898 + (stage + 1) * 78.233);
    const duration = Math.round(base * (RUN_STAGE(stage) ? runFactor : stationFactor) * noise);
    begin.push(total);
    total += duration;
    end.push(total);
  });
  const wave = RANKING_WAVES[waveIndex];
  return { key, name, box, wave, start: wave.start, begin, end };
});

const byKey = (key) => RANKING_ATHLETES.find((athlete) => athlete.key === key);

/** Penalidades vigentes: lançadas durante a estação (segundos desde as 10:00:00). */
export const RANKING_PENALTIES = [
  { athleteKey: 'thiago', seconds: 15, stage: 3, atSeconds: byKey('thiago').start + byKey('thiago').end[3] - 20 },
  { athleteKey: 'caio', seconds: 30, stage: 13, atSeconds: byKey('caio').start + byKey('caio').end[13] - 30 }
];

/** O organizador marca o DNF do Gustavo 50 s depois de ele entrar no Row; ele não tem leitura depois disso. */
export const RANKING_DNF = { athleteKey: 'gustavo', atSeconds: byKey('gustavo').start + byKey('gustavo').begin[9] + 50 };

/** Fim do Wall Balls (o tempo fechado), em segundos desde as 10:00:00. */
export const rankingFinishAt = (key) => byKey(key).start + byKey(key).end[15];
/** Tempo oficial: o bruto mais as penalidades vigentes. */
export const rankingOfficial = (key) => byKey(key).end[15] + RANKING_PENALTIES.filter((item) => item.athleteKey === key).reduce((sum, item) => sum + item.seconds, 0);
/** Início de uma etapa, em segundos desde as 10:00:00. */
export const rankingStageStart = (key, stage) => byKey(key).start + byKey(key).begin[stage];

const stages = stageList();

/**
 * Entrada do motor `seconds` depois das 10:00:00. `coverage` é a escala de judges (vazia: evento sem
 * escala); `withPenalties: false` tira as penalidades (para comparar com a torre de uma onda).
 */
export const buildRankingInput = ({ seconds, coverage = [], withPenalties = true } = {}) => {
  const attempts = [];
  const runs = [];
  const penalties = [];
  for (const athlete of RANKING_ATHLETES) {
    if (athlete.start > seconds) continue;
    const stopAt = athlete.key === RANKING_DNF.athleteKey ? RANKING_DNF.atSeconds : Infinity;
    for (const stage of RANKING_COVERED) {
      const begins = athlete.start + athlete.begin[stage];
      const ends = athlete.start + athlete.end[stage];
      if (begins > seconds || begins > stopAt) continue;
      const released = ends <= seconds && ends <= stopAt;
      const fraction = released ? 1 : (seconds - begins) / (ends - begins);
      const stationId = stages[stage].id;
      const sled = stationId === 'sled-push' || stationId === 'sled-pull' || stationId === 'sandbag-lunges';
      const wallBall = stationId === 'wall-balls';
      attempts.push({
        athleteKey: athlete.key,
        stationId,
        status: released ? 'released' : 'running',
        startedAt: at(begins),
        endedAt: released ? at(ends) : null,
        units: sled ? (released ? 4 : Math.min(3, Math.floor(fraction * 4))) : null,
        expectedUnits: sled ? 4 : null,
        validReps: wallBall ? (released ? 100 : Math.min(99, Math.floor(fraction * 100))) : null,
        targetReps: wallBall ? 100 : null
      });
    }
    if (withPenalties) {
      for (const penalty of RANKING_PENALTIES) {
        if (penalty.athleteKey === athlete.key && penalty.atSeconds <= seconds) {
          penalties.push({ athleteKey: athlete.key, seconds: penalty.seconds, stationId: stages[penalty.stage].id, at: at(penalty.atSeconds) });
        }
      }
    }
    const finishAt = rankingFinishAt(athlete.key);
    const base = { athleteKey: athlete.key, waveKey: athlete.wave.key, startedAt: at(athlete.start) };
    if (athlete.key === RANKING_DNF.athleteKey && seconds >= RANKING_DNF.atSeconds) {
      runs.push({ ...base, status: 'dnf', officialSeconds: null, timeSource: null, finishAt: null, dnfAt: at(RANKING_DNF.atSeconds) });
    } else if (finishAt <= seconds && finishAt <= stopAt) {
      const official = withPenalties ? rankingOfficial(athlete.key) : athlete.end[15];
      runs.push({ ...base, status: 'finished', officialSeconds: official, timeSource: 'sheet', finishAt: at(finishAt), dnfAt: null });
    } else {
      runs.push({ ...base, status: 'racing', officialSeconds: null, timeSource: null, finishAt: null, dnfAt: null });
    }
  }
  return {
    divisions: [{ key: 'open-m', name: 'Open Masculino', orderIndex: 1, stages }],
    athletes: RANKING_ATHLETES.map((athlete) => ({ key: athlete.key, name: athlete.name, box: athlete.box, divisionKey: 'open-m' })),
    waves: RANKING_WAVES.map((wave) => ({
      key: wave.key,
      title: wave.title,
      date: '2026-11-14',
      time: wave.time,
      heatNumber: wave.heatNumber,
      athleteKeys: RANKING_ATHLETES.filter((athlete) => athlete.wave.key === wave.key).map((athlete) => athlete.key),
      startedAt: wave.start <= seconds ? at(wave.start) : null
    })),
    runs,
    attempts,
    penalties,
    results: [],
    coverage,
    nowMs: RANKING_BASE_MS + seconds * 1000
  };
};
