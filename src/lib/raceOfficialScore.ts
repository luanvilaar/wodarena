import { secondsToTime } from '@/lib/scoring';

// Tempo oficial publicado do Fitness Race. Módulo puro (sem `node:crypto` nem
// Supabase), para o motor do telão (Story 1.111) rodar no navegador com a mesma
// conta que a publicação no leaderboard (Story 1.99). `serverRacePublication.ts`
// reexporta os dois símbolos, então quem já importava de lá não muda.

/** "Sem resultado" do leaderboard de Fitness Race (computeDivisionStandings): fica atrás de todos e sem posição. */
export const RACE_NO_RESULT_VALUE = 999999;

/** Tempo publicado: arredonda uma vez (segundo mais próximo) e formata o mesmo inteiro. */
export const raceOfficialScore = (officialSeconds: number) => {
  const value = Math.max(0, Math.round(officialSeconds));
  return { value, result: secondsToTime(value) };
};
