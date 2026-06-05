const athletes = [
  { id: 'ath-1780496313638', name: 'luan vilar', divisionId: 'div-cf-bull-rx-masculino' },
  { id: 'ath-1780496494544', name: 'diego nascimento', divisionId: 'div-cf-bull-rx-masculino' }
];

const scores = [
  { athleteId: 'ath-1780496494544', workoutId: 'wod-cf-bull-prova-1', result: '30', value: 30 },
  { athleteId: 'ath-1780496313638', workoutId: 'wod-cf-bull-prova-1', result: '25', value: 25 }
];

const events = [
  {
    id: 'cf-bull',
    workouts: [
      { id: 'wod-cf-bull-prova-1', type: 'fortime' }
    ]
  }
];

const recalculateWorkoutScores = (workoutId, divisionId, currentScores) => {
  const divisionAthletes = athletes.filter(a => a.divisionId === divisionId);
  const athleteIds = divisionAthletes.map(a => a.id);

  let workoutType = 'fortime';
  for (const e of events) {
    const w = e.workouts.find(work => work.id === workoutId);
    if (w) {
      workoutType = w.type;
      break;
    }
  }

  const workoutScores = currentScores.filter(
    s => s.workoutId === workoutId && athleteIds.includes(s.athleteId)
  );

  const sortedScores = [...workoutScores].sort((a, b) => {
    const aPending = !a.result || a.result === '-' || a.result === '';
    const bPending = !b.result || b.result === '-' || b.result === '';
    if (aPending && !bPending) return 1;
    if (!aPending && bPending) return -1;
    if (aPending && bPending) return 0;

    if (workoutType === 'fortime') {
      return a.value - b.value;
    } else {
      return b.value - a.value;
    }
  });

  const updatedScoresMap = new Map();
  
  sortedScores.forEach((score, index) => {
    const isPending = !score.result || score.result === '-' || score.result === '';
    let rank = 0;
    let points = 0;

    if (!isPending) {
      if (index > 0) {
        const prevScore = sortedScores[index - 1];
        const prevPending = !prevScore.result || prevScore.result === '-' || prevScore.result === '';
        if (!prevPending && score.value === prevScore.value) {
          rank = updatedScoresMap.get(prevScore.athleteId)?.rank || (index + 1);
        } else {
          rank = index + 1;
        }
      } else {
        rank = 1;
      }
      points = rank;
    } else {
      rank = 0;
      points = athleteIds.length + 1;
    }

    updatedScoresMap.set(score.athleteId, {
      ...score,
      rank,
      points
    });
  });

  return currentScores.map(score => {
    if (score.workoutId === workoutId && athleteIds.includes(score.athleteId)) {
      return updatedScoresMap.get(score.athleteId) || score;
    }
    return score;
  });
};

const result = recalculateWorkoutScores('wod-cf-bull-prova-1', 'div-cf-bull-rx-masculino', scores);
console.log("Resultado do recálculo:");
console.log(JSON.stringify(result, null, 2));
