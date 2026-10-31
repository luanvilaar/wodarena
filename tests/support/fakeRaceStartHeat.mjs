// Emulação, no banco em memória (fakeSupabase.mjs), da função race_start_heat
// da migration 20261030140000_race_start_heat.sql (Story 1.96), na mesma
// ordem: evento Fitness Race, regulamento do evento, marca da onda (uma por
// onda; a segunda devolve started = false com o horário que vale), trava do
// regulamento com o snapshot do primeiro uso e uma corrida `racing` por atleta
// de categoria do evento, sem duplicar quem já tem corrida ativa. Num arquivo
// próprio para não mexer no fakeSupabase.mjs, no fakeRaceSupabase.mjs (Story
// 1.94) nem no serverModuleHarness.mjs; as Stories 1.97 em diante podem largar
// a onda pela rota com ele.

const fail = (message, code = 'P0001') => ({ data: null, error: { code, message } });

export const emulateRaceStartHeat = (database, args) => {
  const event = database.rows('events').find((row) => row.id === args.p_event_id && row.event_type === 'fitness_racing');
  if (!event) return fail('race_event_required');
  const ruleset = database.rows('race_rulesets').find((row) => row.id === args.p_ruleset_id && row.event_id === args.p_event_id);
  if (!ruleset) return fail('race_ruleset_not_found');

  const marks = database.rows('race_heat_marks');
  const existing = marks.find((row) => row.event_id === args.p_event_id && row.heat_id === args.p_heat_id);
  if (existing) return { data: { started: false, started_at: existing.started_at, runs_created: 0 }, error: null };
  const now = new Date().toISOString();
  marks.push({
    event_id: args.p_event_id,
    heat_id: args.p_heat_id,
    started_at: args.p_started_at,
    started_by_user_id: args.p_actor_id,
    started_by_name: args.p_actor_name,
    device_at: args.p_device_at,
    clock_offset_ms: args.p_clock_offset_ms,
    created_at: now,
    updated_at: now
  });

  if (!ruleset.locked_at) {
    ruleset.locked_at = now;
    if (args.p_course && typeof args.p_course === 'object' && !Array.isArray(args.p_course)) ruleset.course = structuredClone(args.p_course);
  }

  const runs = database.rows('race_runs');
  let created = 0;
  for (const item of Array.isArray(args.p_runs) ? args.p_runs : []) {
    if (!item?.id) continue;
    const athlete = database.rows('athletes').find((row) => row.id === item.athlete_id);
    const division = athlete && database.rows('divisions').find((row) => row.id === athlete.division_id && row.event_id === args.p_event_id);
    if (!division) continue;
    if (runs.some((row) => row.event_id === args.p_event_id && row.athlete_id === athlete.id && row.status !== 'cancelled')) continue;
    runs.push({
      id: item.id, event_id: args.p_event_id, division_id: athlete.division_id, athlete_id: athlete.id, heat_id: args.p_heat_id,
      ruleset_id: ruleset.id, status: 'racing', started_at: args.p_started_at, finish_at: null, gross_seconds: null,
      penalty_seconds: 0, official_seconds: null, time_source: null, created_at: now, updated_at: now
    });
    created += 1;
  }
  return { data: { started: true, started_at: args.p_started_at, runs_created: created }, error: null };
};

/**
 * Cliente com race_start_heat emulada sobre o cliente do harness
 * (createRaceClient). `state.missingStartHeat = true` simula o banco sem a
 * migration da largada (a função não existe).
 */
export const withRaceStartHeat = (client, getDatabase, state = {}) => ({
  ...client,
  rpc: async (name, args) => {
    if (name !== 'race_start_heat') return client.rpc(name, args);
    const database = getDatabase();
    database.rpcCalls.push({ name, args: structuredClone(args) });
    if (state.missingStartHeat) return fail('Could not find the function public.race_start_heat', 'PGRST202');
    return emulateRaceStartHeat(database, args);
  }
});
