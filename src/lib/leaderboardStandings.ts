import { hasEventDatePassed } from '@/lib/eventStatus';
import { FIRST_WORKOUT_TIEBREAK_CUTOFF, getTiebreakFirstWorkout } from '@/lib/workoutOrder';
import type { Athlete, AthleteOverall, Event, Score } from '@/types';

// Classificação geral de uma categoria (Story 1.55). Pura: recebe os atletas
// elegíveis da categoria (quem decide a elegibilidade é quem chama) e os scores,
// e devolve a lista ordenada com o rank. É a mesma regra no leaderboard do site
// (getLeaderboard no AppContext) e no telão (src/lib/serverBroadcast.ts).

export type DivisionStandingsInput = {
  event: Pick<Event, 'date' | 'eventType' | 'workouts'>;
  divisionId: string;
  divisionAthletes: Athlete[];
  scores: Score[];
  nowMs?: number;
  /**
   * Qualifier: pares atleta/prova (ver `qualifierReviewKey`) com envio já feito e ainda
   * sem revisão do judge. Prova sem score nesse conjunto é "Em análise", não ausência.
   */
  awaitingReview?: ReadonlySet<string>;
};

export const qualifierReviewKey = (athleteId: string, workoutId: string) => `${athleteId}::${workoutId}`;

export const computeDivisionStandings = ({
  event,
  divisionId,
  divisionAthletes,
  scores,
  nowMs = Date.now(),
  awaitingReview
}: DivisionStandingsInput): AthleteOverall[] => {
  // Se for Fitness Racing, o leaderboard é baseado estritamente no tempo do workout TOTAL (Percurso Completo)
  if (event.eventType === 'fitness_racing') {
    const totalWorkout = event.workouts.find(w => w.divisionId === divisionId && w.code === 'TOTAL');
    const workoutId = totalWorkout?.id || `wod-${divisionId}-total`;

    const list: AthleteOverall[] = divisionAthletes.map(athlete => {
      const athleteScores: Record<string, Score> = {};
      const score = scores.find(s => s.athleteId === athlete.id && s.workoutId === workoutId);

      if (score) {
        athleteScores[workoutId] = score;
      } else {
        athleteScores[workoutId] = {
          athleteId: athlete.id,
          workoutId,
          result: '-',
          value: 999999, // Alto valor para ordenação
          rank: 0,
          points: 0,
          splits: {}
        };
      }

      return {
        athlete,
        scores: athleteScores,
        totalPoints: athleteScores[workoutId].value, // totalPoints serve temporariamente como o tempo em segundos para ordenação
        rank: 0
      };
    });

    // Ordenar: tempos válidos (menor valor) primeiro, seguidos pelos inválidos (999999)
    const sortedList = [...list].sort((a, b) => a.totalPoints - b.totalPoints);

    let currentRank = 1;
    return sortedList.map((item, index) => {
      const hasResult = item.totalPoints < 999999;
      let rankVal = 0;
      if (hasResult) {
        if (index > 0 && item.totalPoints > sortedList[index - 1].totalPoints) {
          currentRank = index + 1;
        }
        rankVal = currentRank;
      }
      return {
        ...item,
        rank: rankVal
      };
    });
  }

  // 2. Mapear workouts do evento (Functional Fitness) filtrados pela divisão
  const divisionWorkouts = event.workouts.filter(w => !w.divisionId || w.divisionId === divisionId);
  const workoutIds = divisionWorkouts.map(w => w.id);

  // Prova do desempate "Colocação no WOD 1": a primeira prova da categoria, calculada
  // uma única vez e usada tanto na ordenação quanto na atribuição do rank. Eventos
  // encerrados antes da correção mantêm o critério antigo (primeira prova do evento
  // inteiro) para não alterar rankings já publicados.
  const usesLegacyFirstWorkoutTiebreak = hasEventDatePassed(event.date, FIRST_WORKOUT_TIEBREAK_CUTOFF);
  const firstWorkout = getTiebreakFirstWorkout(event.workouts, divisionWorkouts, usesLegacyFirstWorkoutTiebreak);

  const isQualifier = event.eventType === 'functional_fitness_qualifier';
  // Maior pontuação em jogo na divisão: a última colocação possível.
  const qualifierAbsencePoints = divisionAthletes.length;
  // Qualifier: provas sem resultado com a janela ainda aberta, por atleta.
  const qualifierPendingCount = new Map<string, number>();
  // Qualifier: provas com a janela encerrada e o envio ainda em análise, por atleta.
  const qualifierUnderReviewCount = new Map<string, number>();

  // 3. Compilar scores para cada atleta da divisão somando apenas as provas já lançadas.
  //    Provas ainda sem resultado NÃO geram penalidade automática nem score falso: o evento
  //    segue em andamento. Em caso de ausência real, o organizador lança manualmente a
  //    pontuação máxima, que já entra como score normal e atua como penalidade.
  const list: AthleteOverall[] = divisionAthletes.map(athlete => {
    const athleteScores: Record<string, Score> = {};
    let totalPoints = 0;
    let pendingCount = 0;
    let underReviewCount = 0;

    workoutIds.forEach(wId => {
      const score = scores.find(s => s.athleteId === athlete.id && s.workoutId === wId);
      if (score && score.result !== '-' && score.result !== '') {
        athleteScores[wId] = score;
        totalPoints += score.points || 0;
      } else {
        const workout = divisionWorkouts.find(item => item.id === wId);
        const closed = Boolean(workout?.submissionClosesAt)
          && new Date(workout?.submissionClosesAt as string).getTime() < nowMs;
        // Envio feito e ainda sem revisão do judge (a linha em scores só nasce na
        // revisão): não é ausência, em nenhum momento.
        const underReview = isQualifier && Boolean(awaitingReview?.has(qualifierReviewKey(athlete.id, wId)));
        const absencePoints = isQualifier && closed && !underReview ? qualifierAbsencePoints : 0;
        // Para qualifier encerrado, ausência recebe a maior pontuação em jogo
        // (última colocação da divisão). Antes do encerramento a prova pendente
        // mostra 0 pontos, mas conta como o pior resultado possível na ordenação.
        if (isQualifier && !closed) pendingCount += 1;
        // Encerrado e em análise: também mostra 0 pontos e conta como o pior resultado
        // possível, mas só na ordenação (total provisório), até a revisão.
        if (underReview && closed) underReviewCount += 1;
        athleteScores[wId] = {
          athleteId: athlete.id,
          workoutId: wId,
          result: '-',
          value: 0,
          rank: 0,
          points: absencePoints,
          resultStatus: absencePoints ? 'absent' : undefined,
          awaitingReview: underReview ? true : undefined
        };
        totalPoints += absencePoints;
      }
    });

    qualifierPendingCount.set(athlete.id, pendingCount);
    qualifierUnderReviewCount.set(athlete.id, underReviewCount);
    return {
      athlete,
      scores: athleteScores,
      totalPoints,
      rank: 0 // Será calculado após ordenação global
    };
  });

  // Função auxiliar para resolver empates no confronto direto
  const getDirectWins = (a: AthleteOverall, b: AthleteOverall) => {
    let aWins = 0;
    let bWins = 0;
    workoutIds.forEach(wId => {
      const scoreA = a.scores[wId];
      const scoreB = b.scores[wId];
      const aPending = !scoreA || scoreA.result === '-' || scoreA.result === '';
      const bPending = !scoreB || scoreB.result === '-' || scoreB.result === '';

      if (!aPending && !bPending) {
        // Rank menor (melhor colocação na prova) é vitória
        const rA = scoreA.rank || 999999;
        const rB = scoreB.rank || 999999;
        if (rA < rB) aWins++;
        else if (rB < rA) bWins++;
      } else if (!aPending && bPending) {
        aWins++;
      } else if (aPending && !bPending) {
        bWins++;
      }
    });
    return { aWins, bWins };
  };

  // Qualifier com janela aberta: prova sem resultado é o pior resultado possível,
  // então quem tem menos provas pendentes fica sempre à frente, antes dos pontos.
  const getPendingDiff = (a: AthleteOverall, b: AthleteOverall) =>
    (qualifierPendingCount.get(a.athlete.id) || 0) - (qualifierPendingCount.get(b.athlete.id) || 0);

  // Qualifier com janela encerrada: prova em análise não soma pontos no total exibido,
  // mas na ordenação vale a pior colocação até ser revisada. Sem isso, quem aguarda
  // revisão apareceria à frente de todos com 0 ponto. Fora do Qualifier é o próprio total.
  const getProvisionalTotal = (item: AthleteOverall) =>
    item.totalPoints + qualifierAbsencePoints * (qualifierUnderReviewCount.get(item.athlete.id) || 0);

  // 4. Ordenar os atletas pelo total de pontos crescente (Low-Point) e aplicar critérios de desempate
  const sortedList = [...list].sort((a, b) => {
    const pendingDiff = getPendingDiff(a, b);
    if (pendingDiff !== 0) return pendingDiff;

    const provisionalDiff = getProvisionalTotal(a) - getProvisionalTotal(b);
    if (provisionalDiff !== 0) return provisionalDiff;

    if (a.totalPoints !== b.totalPoints) {
      return a.totalPoints - b.totalPoints; // Menos pontos é melhor
    }

    // Empate: Critério 1 - Confronto Direto
    const { aWins, bWins } = getDirectWins(a, b);
    if (aWins !== bWins) {
      return bWins - aWins; // Quem venceu mais provas contra o oponente fica na frente (menor index)
    }

    // Empate persistiu: Critério 2 - Colocação no WOD 1
    if (firstWorkout) {
      const rA = a.scores[firstWorkout.id]?.rank || 999999;
      const rB = b.scores[firstWorkout.id]?.rank || 999999;
      return rA - rB; // Menor rank (melhor colocação) na primeira prova vence
    }

    return 0;
  });

  // 5. Aplicar o Rank geral final consolidado lidando com empates absolutos
  let currentRank = 1;
  return sortedList.map((item, index) => {
    if (index > 0) {
      const prevItem = sortedList[index - 1];
      let isEqual = getPendingDiff(item, prevItem) === 0
        && getProvisionalTotal(item) === getProvisionalTotal(prevItem)
        && item.totalPoints === prevItem.totalPoints;

      if (isEqual) {
        // Confronto direto
        const { aWins, bWins } = getDirectWins(item, prevItem);
        if (aWins === bWins) {
          // WOD 1
          if (firstWorkout) {
            const rA = item.scores[firstWorkout.id]?.rank || 999999;
            const rB = prevItem.scores[firstWorkout.id]?.rank || 999999;
            if (rA !== rB) {
              isEqual = false;
            }
          }
        } else {
          isEqual = false;
        }
      }

      if (!isEqual) {
        currentRank = index + 1;
      }
    }
    return {
      ...item,
      rank: currentRank
    };
  });
};
