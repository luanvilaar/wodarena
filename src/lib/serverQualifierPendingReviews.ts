import type { SupabaseClient } from '@supabase/supabase-js';
import { readBootstrapQuery } from '@/lib/bootstrapPayload';

export const QUALIFIER_EVENT_TYPE = 'functional_fitness_qualifier';

// Limite de linhas por resposta do PostgREST: acima disso a leitura precisa de páginas.
const PAGE_SIZE = 1000;
const MAX_PAGES = 100;

/** Envios do Qualifier já feitos e ainda sem revisão do judge, agrupados por prova. */
export type QualifierPendingReviewGroup = { workout_id: string; athlete_ids: string[] };

export const groupQualifierPendingReviews = (rows: Record<string, unknown>[]): QualifierPendingReviewGroup[] => {
  const byWorkout = new Map<string, Set<string>>();
  for (const row of rows) {
    const workoutId = typeof row.workout_id === 'string' ? row.workout_id : '';
    const athleteId = typeof row.athlete_id === 'string' ? row.athlete_id : '';
    if (!workoutId || !athleteId) continue;
    const athletes = byWorkout.get(workoutId) ?? new Set<string>();
    athletes.add(athleteId);
    byWorkout.set(workoutId, athletes);
  }
  return [...byWorkout.entries()].map(([workout_id, athletes]) => ({ workout_id, athlete_ids: [...athletes] }));
};

// O ranking do Qualifier só ganha linha em scores depois da revisão do judge. Para não
// tratar como ausente quem enviou no prazo, o bootstrap leva só QUEM tem envio em análise
// em cada prova (ids de atleta e de prova): nenhum resultado, vídeo ou nota. Leitura
// incompleta ou com falha NUNCA vira "lista vazia": o erro sobe e o bootstrap falha, senão o
// ranking puniria como ausente quem enviou no prazo sem nenhum sinal.
export const readQualifierPendingReviews = async (
  supabaseAdmin: SupabaseClient,
  eventIds: string[]
): Promise<QualifierPendingReviewGroup[]> => {
  if (eventIds.length === 0) return [];
  const rows: Record<string, unknown>[] = [];

  for (let page = 0; ; page += 1) {
    if (page >= MAX_PAGES) {
      console.error('[Bootstrap Query] Envios em análise acima do limite de páginas:', JSON.stringify({ pages: MAX_PAGES, pageSize: PAGE_SIZE }));
      throw new Error('Falha ao carregar envios do qualifier em análise.');
    }
    const from = page * PAGE_SIZE;
    const pageRows = await readBootstrapQuery('envios do qualifier em análise', supabaseAdmin
      .from('score_submissions')
      .select('workout_id, athlete_id')
      .in('event_id', eventIds)
      .eq('status', 'pending_review')
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1));
    rows.push(...(pageRows || []));
    if (!pageRows || pageRows.length < PAGE_SIZE) break;
  }

  return groupQualifierPendingReviews(rows);
};
