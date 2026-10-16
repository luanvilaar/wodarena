import type { createSupabaseAdmin } from '@/lib/serverSecurity';

// Estrutura da prova no bootstrap autenticado (Story 1.45). Só gestor e dono a
// recebem (o editor da aba Provas é o primeiro consumidor); atleta, judge e o
// bootstrap público seguem sem a coluna. A leitura é separada do select das
// provas (PUBLIC_WORKOUT_SELECT não muda) e tolerante a banco sem a migration:
// coluna ausente (42703 ou PGRST204 citando structure) vira "nenhuma prova tem
// estrutura", sem derrubar o bootstrap.

type DbClient = ReturnType<typeof createSupabaseAdmin>;

const isMissingStructureColumnError = (error: { code?: string; message?: string }) => (
  (error.code === '42703' || error.code === 'PGRST204') && String(error.message || '').includes('structure')
);

/**
 * `eventIds`: provas dos eventos do gestor; `null`: todas as provas (dono).
 * Devolve id da prova → estrutura, só das provas que têm estrutura.
 */
export const readWorkoutStructures = async (supabaseAdmin: DbClient, eventIds: string[] | null) => {
  const structures = new Map<string, unknown>();
  if (eventIds && eventIds.length === 0) return structures;

  const base = supabaseAdmin.from('workouts').select('id, structure');
  const { data, error } = await (eventIds ? base.in('event_id', eventIds) : base);

  if (error) {
    if (isMissingStructureColumnError(error)) {
      console.warn('[Bootstrap Query] Coluna structure ausente em workouts; provas seguem sem estrutura.');
      return structures;
    }
    console.error('[Bootstrap Query] Falha:', JSON.stringify({ label: 'estruturas das provas', code: error.code, message: error.message }));
    throw new Error('Falha ao carregar estruturas das provas.');
  }

  for (const row of (data || []) as { id: unknown; structure: unknown }[]) {
    if (row.structure !== null && row.structure !== undefined) structures.set(String(row.id), row.structure);
  }
  return structures;
};

/** Junta a estrutura às linhas de prova; prova sem estrutura fica como veio. */
export const attachWorkoutStructures = <T extends { id?: unknown }>(workouts: T[], structures: Map<string, unknown>) => (
  structures.size === 0
    ? workouts
    : workouts.map((workout) => (structures.has(String(workout.id)) ? { ...workout, structure: structures.get(String(workout.id)) } : workout))
);
